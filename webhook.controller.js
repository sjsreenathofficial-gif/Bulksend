// controllers/webhook.controller.js
const crypto  = require('crypto');
const admin   = require('firebase-admin');
const { sendTextMessage, markAsRead, getOrgCredentials } = require('../services/whatsapp.service');

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/webhooks/whatsapp
// Meta sends a verification challenge when you first set up the webhook
// ══════════════════════════════════════════════════════════════════
async function verifyWebhook(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  console.warn('❌ Webhook verification failed');
  res.status(403).json({ error: 'Forbidden' });
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/webhooks/whatsapp
// Receives all WhatsApp events:
// - Delivery receipts (sent, delivered, read, failed)
// - Incoming messages from contacts
// ══════════════════════════════════════════════════════════════════
async function receiveWebhook(req, res) {
  // Always respond 200 immediately — Meta retries if you don't
  res.status(200).json({ status: 'ok' });

  try {
    // Verify the request is genuinely from Meta
    const signature = req.headers['x-hub-signature-256'];
    if (!verifySignature(req.body, signature)) {
      console.warn('Invalid webhook signature — ignoring');
      return;
    }

    const body    = JSON.parse(req.body);
    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value) return;

    // Find which org this webhook belongs to
    const phoneNumberId = value.metadata?.phone_number_id;
    const org = await findOrgByPhoneNumberId(phoneNumberId);

    if (!org) {
      console.warn(`No org found for phoneNumberId: ${phoneNumberId}`);
      return;
    }

    // ── Process delivery status updates ───────────────────────────
    if (value.statuses && value.statuses.length > 0) {
      for (const status of value.statuses) {
        await processStatusUpdate(org.id, status);
      }
    }

    // ── Process incoming messages ──────────────────────────────────
    if (value.messages && value.messages.length > 0) {
      for (const message of value.messages) {
        const contactInfo = value.contacts?.[0];
        await processIncomingMessage(org, message, contactInfo);
      }
    }

  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// Process delivery status updates
// Updates message status in Firestore
// ══════════════════════════════════════════════════════════════════
async function processStatusUpdate(orgId, status) {
  const { id: waMessageId, status: newStatus, timestamp } = status;
  const db = global.db;

  // Map Meta status to our status
  const statusMap = {
    sent:      { status: 'sent' },
    delivered: { status: 'delivered', deliveredAt: new Date(parseInt(timestamp) * 1000).toISOString() },
    read:      { status: 'read',      readAt:       new Date(parseInt(timestamp) * 1000).toISOString() },
    failed:    { status: 'failed',    errorMessage: status.errors?.[0]?.title || 'Unknown error' },
  };

  const update = statusMap[newStatus];
  if (!update) return;

  // Find the message by waMessageId
  const msgQuery = await db.collection('organizations').doc(orgId)
    .collection('messages')
    .where('waMessageId', '==', waMessageId)
    .limit(1)
    .get();

  if (msgQuery.empty) return;

  const msgDoc  = msgQuery.docs[0];
  const msgData = msgDoc.data();

  // Update message document
  await msgDoc.ref.update({ ...update, updatedAt: new Date().toISOString() });

  // Update campaign counters
  if (msgData.campaignId) {
    const campaignRef = db.collection('organizations').doc(orgId)
      .collection('campaigns').doc(msgData.campaignId);

    const counterField = {
      delivered: 'deliveredCount',
      read:      'readCount',
      failed:    'failedCount',
    }[newStatus];

    if (counterField) {
      await campaignRef.update({
        [counterField]: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// Process incoming messages from contacts
// ══════════════════════════════════════════════════════════════════
async function processIncomingMessage(org, waMessage, waContact) {
  const db          = global.db;
  const phone       = waMessage.from;
  const messageText = waMessage.text?.body || '';
  const messageType = waMessage.type;
  const now         = new Date().toISOString();

  // 1. Upsert contact
  const contactRef = db.collection('organizations').doc(org.id)
    .collection('contacts').doc(phone);

  const contactDoc = await contactRef.get();

  if (!contactDoc.exists) {
    await contactRef.set({
      phone,
      name: waContact?.profile?.name || '',
      orgId: org.id,
      optIn: true,
      optInAt: now,
      source: 'inbound',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await contactRef.update({ lastMessageAt: now, updatedAt: now });
  }

  // 2. Save inbound message
  const msgRef = db.collection('organizations').doc(org.id)
    .collection('chatMessages').doc();

  await msgRef.set({
    id: msgRef.id,
    orgId: org.id,
    contactId: phone,
    waMessageId: waMessage.id,
    direction: 'inbound',
    messageType,
    content: messageText,
    mediaId: waMessage.image?.id || waMessage.audio?.id || null,
    createdAt: now,
  });

  // 3. Upsert conversation
  const convRef = db.collection('organizations').doc(org.id)
    .collection('conversations').doc(phone);

  const convDoc = await convRef.get();

  await convRef.set({
    contactId: phone,
    contactName: waContact?.profile?.name || '',
    orgId: org.id,
    lastMessage: messageText,
    lastMessageAt: now,
    unreadCount: admin.firestore.FieldValue.increment(1),
    status: convDoc.exists ? convDoc.data().status : 'open',
    updatedAt: now,
    createdAt: convDoc.exists ? convDoc.data().createdAt : now,
  }, { merge: true });

  // 4. Update campaign reply count if this contact got a campaign message
  const campaignMsgQuery = await db.collection('organizations').doc(org.id)
    .collection('messages')
    .where('contactPhone', '==', phone)
    .where('status', 'in', ['sent', 'delivered', 'read'])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (!campaignMsgQuery.empty) {
    const lastCampaignMsg = campaignMsgQuery.docs[0].data();
    if (lastCampaignMsg.campaignId) {
      await db.collection('organizations').doc(org.id)
        .collection('campaigns').doc(lastCampaignMsg.campaignId)
        .update({
          replyCount: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
    }
  }

  // 5. Mark as read (optional — shows blue ticks on sender's side)
  try {
    const creds = await getOrgCredentials(org.id);
    await markAsRead({
      accessToken: creds.accessToken,
      phoneNumberId: creds.phoneNumberId,
      messageId: waMessage.id,
    });
  } catch (e) {
    // Non-critical
  }

  // 6. Auto-reply if chatbot is enabled
  if (org.aiChatbotEnabled && messageText) {
    await triggerChatbotReply(org, phone, messageText);
  }

  console.log(`📩 New message from ${phone}: "${messageText.slice(0, 50)}"`);
}

// ══════════════════════════════════════════════════════════════════
// Trigger chatbot auto-reply
// ══════════════════════════════════════════════════════════════════
async function triggerChatbotReply(org, phone, messageText) {
  try {
    const { generateChatbotReply } = require('../ai/aiEngine');
    const db = global.db;

    // Get recent conversation history
    const historySnap = await db.collection('organizations').doc(org.id)
      .collection('chatMessages')
      .where('contactId', '==', phone)
      .orderBy('createdAt', 'desc')
      .limit(8)
      .get();

    const history = historySnap.docs
      .map(d => d.data())
      .reverse();

    const { reply, shouldEscalate } = await generateChatbotReply({
      orgName: org.name,
      industry: org.industry,
      incomingMessage: messageText,
      conversationHistory: history,
    });

    if (reply) {
      const creds = await getOrgCredentials(org.id);
      const result = await sendTextMessage({
        accessToken: creds.accessToken,
        phoneNumberId: creds.phoneNumberId,
        toPhone: phone,
        text: reply,
      });

      if (result.success) {
        // Save bot reply to Firestore
        const replyRef = db.collection('organizations').doc(org.id)
          .collection('chatMessages').doc();

        await replyRef.set({
          id: replyRef.id,
          orgId: org.id,
          contactId: phone,
          waMessageId: result.messageId,
          direction: 'outbound',
          messageType: 'text',
          content: reply,
          aiHandled: true,
          createdAt: new Date().toISOString(),
        });

        // Update conversation
        await db.collection('organizations').doc(org.id)
          .collection('conversations').doc(phone)
          .update({
            lastMessage: reply,
            lastMessageAt: new Date().toISOString(),
            status: shouldEscalate ? 'open' : 'bot',
          });
      }
    }
  } catch (err) {
    console.error('Chatbot reply error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
async function findOrgByPhoneNumberId(phoneNumberId) {
  const snap = await global.db.collection('organizations')
    .where('phoneNumberId', '==', phoneNumberId)
    .limit(1)
    .get();

  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

function verifySignature(rawBody, signature) {
  if (!signature || !process.env.WA_APP_SECRET) return true; // Skip in dev
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WA_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = { verifyWebhook, receiveWebhook };
