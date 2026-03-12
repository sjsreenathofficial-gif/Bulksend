// controllers/chat.controller.js
const admin = require('firebase-admin');
const { sendTextMessage, getOrgCredentials } = require('../services/whatsapp.service');

// ─── Helpers ──────────────────────────────────────────────────────
function orgRef(orgId) {
  return global.db.collection('organizations').doc(orgId);
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/chat/conversations
// List all conversations sorted by latest message
// ══════════════════════════════════════════════════════════════════
async function listConversations(req, res) {
  try {
    const { status, limit = '50' } = req.query;

    let query = orgRef(req.orgId)
      .collection('conversations')
      .orderBy('lastMessageAt', 'desc')
      .limit(parseInt(limit));

    if (status) query = orgRef(req.orgId)
      .collection('conversations')
      .where('status', '==', status)
      .orderBy('lastMessageAt', 'desc')
      .limit(parseInt(limit));

    const snapshot = await query.get();

    const conversations = snapshot.docs.map(doc => ({
      id:  doc.id,
      ...doc.data(),
    }));

    // Count unread total
    const unreadSnap = await orgRef(req.orgId)
      .collection('conversations')
      .where('unreadCount', '>', 0)
      .count()
      .get();

    res.json({
      conversations,
      total:  conversations.length,
      unread: unreadSnap.data().count,
    });

  } catch (err) {
    console.error('listConversations error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/chat/conversations/:contactId/messages
// Get all messages for a conversation
// ══════════════════════════════════════════════════════════════════
async function getMessages(req, res) {
  try {
    const { contactId } = req.params;
    const { limit = '100' } = req.query;

    const snapshot = await orgRef(req.orgId)
      .collection('chatMessages')
      .where('contactId', '==', contactId)
      .orderBy('createdAt', 'asc')
      .limit(parseInt(limit))
      .get();

    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Mark conversation as read
    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .update({
        unreadCount: 0,
        updatedAt:   new Date().toISOString(),
      })
      .catch(() => {}); // Ignore if conversation doesn't exist yet

    res.json({ messages, total: messages.length });

  } catch (err) {
    console.error('getMessages error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/chat/conversations/:contactId/send
// Agent sends a manual WhatsApp message
// Body: { text }
// ══════════════════════════════════════════════════════════════════
async function sendMessage(req, res) {
  try {
    const { contactId }  = req.params;
    const { text }       = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    // Get org WhatsApp credentials
    const creds = await getOrgCredentials(req.orgId);

    // Send via WhatsApp Cloud API
    const result = await sendTextMessage({
      accessToken:   creds.accessToken,
      phoneNumberId: creds.phoneNumberId,
      toPhone:       contactId, // contactId is the phone number
      text:          text.trim(),
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send message' });
    }

    const now    = new Date().toISOString();
    const db     = global.db;

    // Save outbound message to Firestore
    const msgRef = orgRef(req.orgId).collection('chatMessages').doc();
    await msgRef.set({
      id:          msgRef.id,
      orgId:       req.orgId,
      contactId,
      waMessageId: result.messageId,
      direction:   'outbound',
      messageType: 'text',
      content:     text.trim(),
      agentId:     req.userId,
      aiHandled:   false,
      createdAt:   now,
    });

    // Update conversation
    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .set({
        contactId,
        orgId:          req.orgId,
        lastMessage:    text.trim(),
        lastMessageAt:  now,
        status:         'assigned',
        assignedTo:     req.userId,
        updatedAt:      now,
      }, { merge: true });

    res.json({
      success:   true,
      messageId: result.messageId,
      message:   { id: msgRef.id, content: text, direction: 'outbound', createdAt: now },
    });

  } catch (err) {
    console.error('sendMessage error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/chat/conversations/:contactId/assign
// Assign conversation to an agent
// Body: { agentId } — pass null to unassign
// ══════════════════════════════════════════════════════════════════
async function assignConversation(req, res) {
  try {
    const { contactId } = req.params;
    const { agentId }   = req.body;

    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .update({
        assignedTo: agentId || null,
        status:     agentId ? 'assigned' : 'open',
        updatedAt:  new Date().toISOString(),
      });

    res.json({ message: agentId ? 'Conversation assigned' : 'Conversation unassigned', contactId });

  } catch (err) {
    console.error('assignConversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/chat/conversations/:contactId/close
// Close a conversation
// ══════════════════════════════════════════════════════════════════
async function closeConversation(req, res) {
  try {
    const { contactId } = req.params;

    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .update({
        status:     'closed',
        closedAt:   new Date().toISOString(),
        unreadCount: 0,
        updatedAt:  new Date().toISOString(),
      });

    res.json({ message: 'Conversation closed', contactId });

  } catch (err) {
    console.error('closeConversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/chat/conversations/:contactId/reopen
// Reopen a closed conversation
// ══════════════════════════════════════════════════════════════════
async function reopenConversation(req, res) {
  try {
    const { contactId } = req.params;

    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .update({
        status:    'open',
        updatedAt: new Date().toISOString(),
      });

    res.json({ message: 'Conversation reopened', contactId });

  } catch (err) {
    console.error('reopenConversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/chat/conversations/:contactId/bot
// Toggle bot on/off for a conversation
// Body: { enabled: true/false }
// ══════════════════════════════════════════════════════════════════
async function toggleBot(req, res) {
  try {
    const { contactId }      = req.params;
    const { enabled = true } = req.body;

    await orgRef(req.orgId)
      .collection('conversations')
      .doc(contactId)
      .update({
        status:    enabled ? 'bot' : 'open',
        updatedAt: new Date().toISOString(),
      });

    res.json({
      message:   enabled ? '🤖 Bot enabled for this conversation' : 'Bot disabled — human mode',
      contactId,
      botActive: enabled,
    });

  } catch (err) {
    console.error('toggleBot error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/chat/conversations/:contactId
// Get single conversation with contact info
// ══════════════════════════════════════════════════════════════════
async function getConversation(req, res) {
  try {
    const { contactId } = req.params;
    const db = global.db;

    const [convDoc, contactDoc] = await Promise.all([
      orgRef(req.orgId).collection('conversations').doc(contactId).get(),
      orgRef(req.orgId).collection('contacts').doc(contactId).get(),
    ]);

    if (!convDoc.exists) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = { id: convDoc.id, ...convDoc.data() };
    if (contactDoc.exists) {
      conversation.contact = contactDoc.data();
    }

    // Get lead score if exists
    const leadDoc = await orgRef(req.orgId)
      .collection('leads')
      .doc(contactId)
      .get();

    if (leadDoc.exists) {
      conversation.lead = leadDoc.data();
    }

    res.json(conversation);

  } catch (err) {
    console.error('getConversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
  assignConversation,
  closeConversation,
  reopenConversation,
  toggleBot,
};
