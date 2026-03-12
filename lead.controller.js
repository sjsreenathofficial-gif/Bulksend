// controllers/lead.controller.js
const admin = require('firebase-admin');

// ─── Helper ────────────────────────────────────────────────────────
function leadsRef(orgId) {
  return global.db.collection('organizations').doc(orgId).collection('leads');
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/leads
// List all leads — filter by label, status
// ══════════════════════════════════════════════════════════════════
async function listLeads(req, res) {
  try {
    const { label, status, limit = '100' } = req.query;

    let query = leadsRef(req.orgId);
    if (label)  query = query.where('scoreLabel', '==', label);
    if (status) query = query.where('status', '==', status);

    const snapshot = await query
      .orderBy('score', 'desc')
      .limit(parseInt(limit))
      .get();

    const leads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Count by label
    const allSnap = await leadsRef(req.orgId).get();
    const counts = { hot: 0, warm: 0, cold: 0, total: allSnap.size };
    allSnap.docs.forEach(d => {
      const lbl = d.data().scoreLabel || 'cold';
      counts[lbl] = (counts[lbl] || 0) + 1;
    });

    res.json({ leads, counts });

  } catch (err) {
    console.error('listLeads error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/leads/:id
// Get single lead with contact info
// ══════════════════════════════════════════════════════════════════
async function getLead(req, res) {
  try {
    const doc = await leadsRef(req.orgId).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Lead not found' });

    const lead = { id: doc.id, ...doc.data() };

    // Get contact details
    if (lead.contactId) {
      const contactDoc = await global.db.collection('organizations').doc(req.orgId)
        .collection('contacts').doc(lead.contactId).get();
      if (contactDoc.exists) lead.contact = contactDoc.data();
    }

    // Get recent messages
    const msgsSnap = await global.db.collection('organizations').doc(req.orgId)
      .collection('chatMessages')
      .where('contactId', '==', lead.contactId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    lead.recentMessages = msgsSnap.docs.map(d => d.data());

    res.json(lead);

  } catch (err) {
    console.error('getLead error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/leads/:id
// Update lead status, assign agent, add notes
// ══════════════════════════════════════════════════════════════════
async function updateLead(req, res) {
  try {
    const allowed = ['status', 'assignedTo', 'notes', 'convertedAt'];
    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    updates.updatedAt = new Date().toISOString();

    // If marking as converted
    if (req.body.status === 'converted') {
      updates.convertedAt = new Date().toISOString();
    }

    const doc = await leadsRef(req.orgId).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Lead not found' });

    await leadsRef(req.orgId).doc(req.params.id).update(updates);
    res.json({ id: req.params.id, ...doc.data(), ...updates });

  } catch (err) {
    console.error('updateLead error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/v1/leads/:id
// ══════════════════════════════════════════════════════════════════
async function deleteLead(req, res) {
  try {
    const doc = await leadsRef(req.orgId).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Lead not found' });

    await leadsRef(req.orgId).doc(req.params.id).delete();
    res.json({ message: 'Lead deleted', id: req.params.id });

  } catch (err) {
    console.error('deleteLead error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/leads/:id/convert
// Mark lead as converted (won!)
// ══════════════════════════════════════════════════════════════════
async function convertLead(req, res) {
  try {
    const { dealValue } = req.body;

    await leadsRef(req.orgId).doc(req.params.id).update({
      status: 'converted',
      convertedAt: new Date().toISOString(),
      dealValue: dealValue || 0,
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: '🎉 Lead converted successfully!', id: req.params.id });

  } catch (err) {
    console.error('convertLead error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listLeads, getLead, updateLead, deleteLead, convertLead };
