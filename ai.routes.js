// routes/ai.routes.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  generateCampaign,
  scoreLead,
  analyzeLead,
  personalizeMessage,
} = require('../ai/aiEngine');

router.use(authenticate);

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/ai/generate-campaign
// Body: { goal, targetAudience, tone }
// Generates a full WhatsApp campaign from a plain English goal
// ══════════════════════════════════════════════════════════════════
router.post('/generate-campaign', async (req, res) => {
  try {
    const { goal, targetAudience, tone } = req.body;

    if (!goal) {
      return res.status(400).json({ error: 'Please describe your campaign goal' });
    }

    // Get org info for context
    const orgDoc = await global.db.collection('organizations').doc(req.orgId).get();
    const org = orgDoc.data();

    const result = await generateCampaign({
      goal,
      orgName: org.name,
      industry: org.industry,
      targetAudience,
      tone: tone || 'friendly',
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      ...result.campaign,
    });

  } catch (err) {
    console.error('generate-campaign route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/ai/score-lead
// Body: { contactId }
// Scores a lead based on their behavior in Firestore
// ══════════════════════════════════════════════════════════════════
router.post('/score-lead', async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const db = global.db;

    // Get contact data
    const contactDoc = await db.collection('organizations').doc(req.orgId)
      .collection('contacts').doc(contactId).get();

    if (!contactDoc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = contactDoc.data();

    // Get chat messages for this contact
    const msgsSnap = await db.collection('organizations').doc(req.orgId)
      .collection('chatMessages')
      .where('contactId', '==', contactId)
      .get();

    const messages = msgsSnap.docs.map(d => d.data());
    const inboundMessages = messages.filter(m => m.direction === 'inbound');

    // Get campaign messages (reads)
    const campaignMsgsSnap = await db.collection('organizations').doc(req.orgId)
      .collection('messages')
      .where('contactPhone', '==', contact.phone)
      .get();

    const campaignMessages = campaignMsgsSnap.docs.map(d => d.data());
    const readCount = campaignMessages.filter(m => m.status === 'read').length;

    // Get longest message length
    const longestMsg = inboundMessages.reduce((max, m) => {
      return (m.content?.length || 0) > max ? (m.content?.length || 0) : max;
    }, 0);

    // Check if budget was mentioned
    const allText = inboundMessages.map(m => m.content || '').join(' ');
    const mentionedBudget = /₹[\d,]+|lakh|crore|budget|price|cost/i.test(allText);

    // Calculate days since opt-in
    const optedInDate = contact.optInAt ? new Date(contact.optInAt) : new Date();
    const optedInDaysAgo = Math.floor((Date.now() - optedInDate.getTime()) / (1000 * 60 * 60 * 24));

    // Score the lead
    const scoreResult = await scoreLead({
      name: contact.name,
      email: contact.email,
      repliedToMessage: inboundMessages.length > 0,
      campaignsRead: readCount,
      longestMessageLength: longestMsg,
      totalMessages: inboundMessages.length,
      optedInDaysAgo,
      mentionedBudget,
    });

    // Save score to lead document in Firestore
    const leadRef = db.collection('organizations').doc(req.orgId)
      .collection('leads').doc(contactId);

    await leadRef.set({
      contactId,
      contactPhone: contact.phone,
      contactName: contact.name || '',
      orgId: req.orgId,
      score: scoreResult.score,
      scoreLabel: scoreResult.scoreLabel,
      scoreReasons: scoreResult.reasons,
      nextAction: scoreResult.nextAction,
      lastScoredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    res.json({
      success: true,
      contactId,
      contactName: contact.name,
      ...scoreResult,
    });

  } catch (err) {
    console.error('score-lead route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/ai/analyze-lead
// Body: { contactId }
// Deep AI analysis of conversation history
// ══════════════════════════════════════════════════════════════════
router.post('/analyze-lead', async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const db = global.db;

    // Get contact
    const contactDoc = await db.collection('organizations').doc(req.orgId)
      .collection('contacts').doc(contactId).get();

    if (!contactDoc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contact = contactDoc.data();

    // Get org industry
    const orgDoc = await db.collection('organizations').doc(req.orgId).get();
    const org = orgDoc.data();

    // Get conversation history
    const historySnap = await db.collection('organizations').doc(req.orgId)
      .collection('chatMessages')
      .where('contactId', '==', contactId)
      .orderBy('createdAt', 'asc')
      .limit(20)
      .get();

    const history = historySnap.docs.map(d => d.data());

    if (history.length === 0) {
      return res.status(400).json({
        error: 'No conversation history found for this contact',
        tip: 'AI analysis requires at least one message exchange',
      });
    }

    const result = await analyzeLead({
      leadName: contact.name,
      phone: contact.phone,
      conversationHistory: history,
      industry: org.industry,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Update lead score with AI analysis
    await db.collection('organizations').doc(req.orgId)
      .collection('leads').doc(contactId)
      .set({
        contactId,
        score: result.analysis.score,
        scoreLabel: result.analysis.label,
        aiAnalysis: result.analysis,
        lastAnalyzedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    res.json({
      success: true,
      contactId,
      contactName: contact.name,
      analysis: result.analysis,
    });

  } catch (err) {
    console.error('analyze-lead route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/ai/personalize-message
// Body: { template, contactId }
// Personalizes a message template for a specific contact
// ══════════════════════════════════════════════════════════════════
router.post('/personalize-message', async (req, res) => {
  try {
    const { template, contactId, campaignGoal } = req.body;

    if (!template)   return res.status(400).json({ error: 'template is required' });
    if (!contactId)  return res.status(400).json({ error: 'contactId is required' });

    const contactDoc = await global.db.collection('organizations').doc(req.orgId)
      .collection('contacts').doc(contactId).get();

    if (!contactDoc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = contactDoc.data();

    const result = await personalizeMessage({
      template,
      contactName: contact.name,
      contactCity: contact.city,
      contactIndustry: contact.industry,
      campaignGoal,
    });

    res.json({
      success: true,
      original: template,
      personalized: result.message,
      contactName: contact.name,
    });

  } catch (err) {
    console.error('personalize-message route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/ai/score-all-leads
// Scores all contacts in the org automatically
// ══════════════════════════════════════════════════════════════════
router.post('/score-all-leads', async (req, res) => {
  try {
    const db = global.db;

    // Get all contacts
    const contactsSnap = await db.collection('organizations').doc(req.orgId)
      .collection('contacts')
      .where('optIn', '==', true)
      .limit(500)
      .get();

    const total = contactsSnap.docs.length;

    // Respond immediately
    res.json({
      message: `Scoring ${total} contacts in background...`,
      total,
    });

    // Score in background
    let scored = 0;
    for (const doc of contactsSnap.docs) {
      try {
        const contact = doc.data();

        // Quick score based on available data
        const scoreResult = await scoreLead({
          name: contact.name,
          email: contact.email,
          repliedToMessage: false,
          campaignsRead: 0,
          longestMessageLength: 0,
          totalMessages: 0,
          optedInDaysAgo: 30,
          mentionedBudget: false,
        });

        await db.collection('organizations').doc(req.orgId)
          .collection('leads').doc(doc.id)
          .set({
            contactId: doc.id,
            contactPhone: contact.phone,
            contactName: contact.name || '',
            orgId: req.orgId,
            score: scoreResult.score,
            scoreLabel: scoreResult.scoreLabel,
            nextAction: scoreResult.nextAction,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          }, { merge: true });

        scored++;
      } catch (e) {
        console.error(`Score failed for ${doc.id}:`, e.message);
      }
    }

    console.log(`Scored ${scored}/${total} leads for org ${req.orgId}`);

  } catch (err) {
    console.error('score-all-leads error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
