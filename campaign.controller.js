// controllers/campaign.controller.js
const admin = require('firebase-admin');
const { sendTemplateMessage } = require('../services/whatsapp.service');

// ─── Helpers ──────────────────────────────────────────────────────
function campaignsRef(orgId) {
  return global.db.collection('organizations').doc(orgId).collection('campaigns');
}

function contactsRef(orgId) {
  return global.db.collection('organizations').doc(orgId).collection('contacts');
}

function messagesRef(orgId) {
  return global.db.collection('organizations').doc(orgId).collection('messages');
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/campaigns
// List all campaigns for the org
// ══════════════════════════════════════════════════════════════════
async function listCampaigns(req, res) {
  try {
    const snapshot = await campaignsRef(req.orgId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const campaigns = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ campaigns, total: campaigns.length });

  } catch (err) {
    console.error('listCampaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/campaigns/:id
// Get single campaign
// ══════════════════════════════════════════════════════════════════
async function getCampaign(req, res) {
  try {
    const doc = await campaignsRef(req.orgId).doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ id: doc.id, ...doc.data() });

  } catch (err) {
    console.error('getCampaign error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/campaigns
// Create a new campaign
// Body: {
//   name, templateName, templateLanguage,
//   segmentFilters: { tags[], city, industry, optIn },
//   scheduledAt, goal, variables: { '1': 'value' }
// }
// ══════════════════════════════════════════════════════════════════
async function createCampaign(req, res) {
  try {
    const {
      name,
      templateName,
      templateLanguage = 'en',
      segmentFilters = {},
      scheduledAt,
      goal,
      variables = {},
    } = req.body;

    // Validate required fields
    if (!name)         return res.status(400).json({ error: 'Campaign name is required' });
    if (!templateName) return res.status(400).json({ error: 'Template name is required' });

    // Count matching contacts
    const contacts = await getSegmentContacts(req.orgId, segmentFilters);

    if (contacts.length === 0) {
      return res.status(400).json({
        error: 'No contacts found matching your filters',
        tip: 'Try removing some filters or import more contacts',
      });
    }

    // Check org message limit
    const orgDoc = await global.db.collection('organizations').doc(req.orgId).get();
    const org = orgDoc.data();
    const remaining = org.messageLimit - org.messagesUsed;

    if (contacts.length > remaining) {
      return res.status(402).json({
        error: `Not enough messages remaining`,
        remaining,
        required: contacts.length,
        tip: 'Upgrade your plan to send more messages',
      });
    }

    // Create campaign document
    const campaignRef = campaignsRef(req.orgId).doc();
    const now = new Date().toISOString();

    const campaign = {
      id: campaignRef.id,
      orgId: req.orgId,
      createdBy: req.userId,
      name,
      templateName,
      templateLanguage,
      segmentFilters,
      scheduledAt: scheduledAt || null,
      goal: goal || '',
      variables,
      status: scheduledAt ? 'scheduled' : 'draft',
      totalContacts: contacts.length,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      replyCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await campaignRef.set(campaign);

    res.status(201).json({
      ...campaign,
      estimatedContacts: contacts.length,
      message: `Campaign created! Ready to send to ${contacts.length} contacts.`,
    });

  } catch (err) {
    console.error('createCampaign error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/campaigns/:id/launch
// Launch a campaign — sends messages to all matching contacts
// ══════════════════════════════════════════════════════════════════
async function launchCampaign(req, res) {
  try {
    const campaignDoc = await campaignsRef(req.orgId).doc(req.params.id).get();

    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = { id: campaignDoc.id, ...campaignDoc.data() };

    // Check campaign status
    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
      return res.status(400).json({
        error: `Cannot launch campaign with status: ${campaign.status}`,
      });
    }

    // Get org WhatsApp config
    const orgDoc = await global.db.collection('organizations').doc(req.orgId).get();
    const org = orgDoc.data();

    if (!org.phoneNumberId || !org.accessToken) {
      return res.status(400).json({
        error: 'WhatsApp not connected',
        tip: 'Go to Settings and connect your WhatsApp Business account',
      });
    }

    // Get matching contacts
    const contacts = await getSegmentContacts(req.orgId, campaign.segmentFilters);

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts found for this campaign' });
    }

    // Update campaign to running
    await campaignsRef(req.orgId).doc(campaign.id).update({
      status: 'running',
      startedAt: new Date().toISOString(),
      totalContacts: contacts.length,
      updatedAt: new Date().toISOString(),
    });

    // Send response immediately — don't make user wait
    res.json({
      message: `Campaign launched! Sending to ${contacts.length} contacts...`,
      campaignId: campaign.id,
      totalContacts: contacts.length,
    });

    // ── Send messages in background ───────────────────────────────
    sendCampaignMessages(campaign, contacts, org).catch(err => {
      console.error('Background send error:', err.message);
    });

  } catch (err) {
    console.error('launchCampaign error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// Background function: send messages with rate limiting
// ══════════════════════════════════════════════════════════════════
async function sendCampaignMessages(campaign, contacts, org) {
  const db = global.db;
  const DELAY_MS = 1000; // 1 second between messages (safe rate)
  let sentCount = 0;
  let failedCount = 0;

  console.log(`Starting campaign ${campaign.id}: ${contacts.length} contacts`);

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Check if campaign was paused
    const freshDoc = await campaignsRef(campaign.orgId).doc(campaign.id).get();
    if (freshDoc.data().status === 'paused') {
      console.log(`Campaign ${campaign.id} paused at contact ${i}`);
      break;
    }

    try {
      // Build personalized variables
      const resolvedVars = resolveVariables(contact, campaign.variables);

      // Send via WhatsApp Cloud API
      const result = await sendTemplateMessage({
        accessToken: org.accessToken,
        phoneNumberId: org.phoneNumberId,
        toPhone: contact.phone,
        templateName: campaign.templateName,
        languageCode: campaign.templateLanguage || 'en',
        variables: resolvedVars,
      });

      // Save message record to Firestore
      const msgRef = messagesRef(campaign.orgId).doc();
      await msgRef.set({
        id: msgRef.id,
        campaignId: campaign.id,
        contactId: contact.id,
        contactPhone: contact.phone,
        contactName: contact.name || '',
        orgId: campaign.orgId,
        waMessageId: result.success ? result.messageId : null,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.success ? null : result.error,
        variables: resolvedVars,
        sentAt: result.success ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
      });

      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
        console.warn(`Failed to send to ${contact.phone}: ${result.error}`);
      }

      // Update campaign counters every 10 messages
      if (i % 10 === 0 || i === contacts.length - 1) {
        await campaignsRef(campaign.orgId).doc(campaign.id).update({
          sentCount,
          failedCount,
          updatedAt: new Date().toISOString(),
        });

        // Update org message usage
        await db.collection('organizations').doc(campaign.orgId).update({
          messagesUsed: admin.firestore.FieldValue.increment(
            result.success ? 1 : 0
          ),
        });
      }

    } catch (err) {
      failedCount++;
      console.error(`Error sending to ${contact.phone}:`, err.message);
    }

    // Rate limiting — wait between messages
    if (i < contacts.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Mark campaign as completed
  await campaignsRef(campaign.orgId).doc(campaign.id).update({
    status: 'completed',
    completedAt: new Date().toISOString(),
    sentCount,
    failedCount,
    updatedAt: new Date().toISOString(),
  });

  console.log(`Campaign ${campaign.id} completed: sent=${sentCount} failed=${failedCount}`);
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/campaigns/:id/pause
// ══════════════════════════════════════════════════════════════════
async function pauseCampaign(req, res) {
  try {
    const doc = await campaignsRef(req.orgId).doc(req.params.id).get();

    if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });
    if (doc.data().status !== 'running') {
      return res.status(400).json({ error: 'Only running campaigns can be paused' });
    }

    await campaignsRef(req.orgId).doc(req.params.id).update({
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: 'Campaign paused successfully' });

  } catch (err) {
    console.error('pauseCampaign error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/v1/campaigns/:id
// Only draft/scheduled campaigns can be deleted
// ══════════════════════════════════════════════════════════════════
async function deleteCampaign(req, res) {
  try {
    const doc = await campaignsRef(req.orgId).doc(req.params.id).get();

    if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });

    if (['running', 'completed'].includes(doc.data().status)) {
      return res.status(400).json({
        error: 'Cannot delete a running or completed campaign',
      });
    }

    await campaignsRef(req.orgId).doc(req.params.id).delete();
    res.json({ message: 'Campaign deleted', id: req.params.id });

  } catch (err) {
    console.error('deleteCampaign error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/campaigns/:id/stats
// Get delivery stats for a campaign
// ══════════════════════════════════════════════════════════════════
async function getCampaignStats(req, res) {
  try {
    const doc = await campaignsRef(req.orgId).doc(req.params.id).get();

    if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });

    const campaign = { id: doc.id, ...doc.data() };

    // Get message breakdown from Firestore
    const msgsSnapshot = await messagesRef(req.orgId)
      .where('campaignId', '==', campaign.id)
      .get();

    const breakdown = { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, queued: 0 };
    msgsSnapshot.docs.forEach(d => {
      const status = d.data().status;
      breakdown[status] = (breakdown[status] || 0) + 1;
    });

    // Calculate rates
    const total = campaign.totalContacts || 1;
    const sent  = campaign.sentCount || 0;

    const rates = {
      deliveryRate: sent > 0
        ? ((campaign.deliveredCount / sent) * 100).toFixed(1) + '%'
        : '0%',
      readRate: campaign.deliveredCount > 0
        ? ((campaign.readCount / campaign.deliveredCount) * 100).toFixed(1) + '%'
        : '0%',
      replyRate: sent > 0
        ? ((campaign.replyCount / sent) * 100).toFixed(1) + '%'
        : '0%',
      failureRate: sent > 0
        ? ((campaign.failedCount / total) * 100).toFixed(1) + '%'
        : '0%',
    };

    res.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalContacts: campaign.totalContacts,
        createdAt: campaign.createdAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
      },
      counts: {
        sent: campaign.sentCount,
        delivered: campaign.deliveredCount,
        read: campaign.readCount,
        replied: campaign.replyCount,
        failed: campaign.failedCount,
      },
      rates,
      breakdown,
    });

  } catch (err) {
    console.error('getCampaignStats error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// Helper: get contacts matching segment filters
// ══════════════════════════════════════════════════════════════════
async function getSegmentContacts(orgId, filters = {}) {
  let query = contactsRef(orgId).where('optIn', '==', true);

  // Apply Firestore filters
  if (filters.city)     query = query.where('city', '==', filters.city);
  if (filters.industry) query = query.where('industry', '==', filters.industry);
  if (filters.tag)      query = query.where('tags', 'array-contains', filters.tag);

  const snapshot = await query.get();
  let contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Filter by multiple tags client-side (Firestore only supports one array-contains)
  if (filters.tags && filters.tags.length > 0) {
    contacts = contacts.filter(c =>
      filters.tags.some(tag => c.tags?.includes(tag))
    );
  }

  return contacts;
}

// ══════════════════════════════════════════════════════════════════
// Helper: resolve message variables for a contact
// variables: { '1': 'name', '2': 'city' } → { '1': 'Ravi', '2': 'Hyderabad' }
// ══════════════════════════════════════════════════════════════════
function resolveVariables(contact, variableMapping = {}) {
  const defaults = {
    '1': contact.name || 'there',
    name: contact.name || 'there',
    phone: contact.phone,
    city: contact.city || '',
    industry: contact.industry || '',
  };

  // Replace variable keys with contact data
  const resolved = {};
  Object.entries(variableMapping).forEach(([key, field]) => {
    resolved[key] = contact[field] || defaults[field] || field;
  });

  return Object.keys(resolved).length > 0 ? resolved : defaults;
}

// ══════════════════════════════════════════════════════════════════
// Helper: sleep for rate limiting
// ══════════════════════════════════════════════════════════════════
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  launchCampaign,
  pauseCampaign,
  deleteCampaign,
  getCampaignStats,
};
