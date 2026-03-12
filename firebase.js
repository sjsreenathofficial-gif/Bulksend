// services/firebase.js
// Helper functions for Firestore operations

const db = global.db;

// ─── CONTACTS ─────────────────────────────────────────────────────

async function getContacts(orgId, filters = {}) {
  let query = db.collection('organizations').doc(orgId).collection('contacts');

  if (filters.city) query = query.where('city', '==', filters.city);
  if (filters.optIn !== undefined) query = query.where('optIn', '==', filters.optIn);
  if (filters.tag) query = query.where('tags', 'array-contains', filters.tag);

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function createContact(orgId, data) {
  const phone = normalizePhone(data.phone);
  const ref = db.collection('organizations').doc(orgId)
    .collection('contacts').doc(phone); // Use phone as doc ID for uniqueness

  await ref.set({
    ...data,
    phone,
    orgId,
    optIn: data.optIn !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return { id: phone, ...data };
}

async function updateContact(orgId, contactId, data) {
  await db.collection('organizations').doc(orgId)
    .collection('contacts').doc(contactId)
    .update({ ...data, updatedAt: new Date().toISOString() });
}

async function deleteContact(orgId, contactId) {
  await db.collection('organizations').doc(orgId)
    .collection('contacts').doc(contactId).delete();
}

// ─── CAMPAIGNS ────────────────────────────────────────────────────

async function getCampaigns(orgId) {
  const snapshot = await db.collection('organizations').doc(orgId)
    .collection('campaigns')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function createCampaign(orgId, data) {
  const ref = db.collection('organizations').doc(orgId).collection('campaigns').doc();
  const campaign = {
    ...data,
    orgId,
    status: data.scheduledAt ? 'scheduled' : 'draft',
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    replyCount: 0,
    failedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await ref.set(campaign);
  return { id: ref.id, ...campaign };
}

async function updateCampaign(orgId, campaignId, data) {
  await db.collection('organizations').doc(orgId)
    .collection('campaigns').doc(campaignId)
    .update({ ...data, updatedAt: new Date().toISOString() });
}

// ─── MESSAGES ─────────────────────────────────────────────────────

async function createMessage(orgId, data) {
  const ref = db.collection('organizations').doc(orgId).collection('messages').doc();
  await ref.set({ ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

async function updateMessageByWaId(orgId, waMessageId, data) {
  const snapshot = await db.collection('organizations').doc(orgId)
    .collection('messages')
    .where('waMessageId', '==', waMessageId)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    await snapshot.docs[0].ref.update(data);
    return snapshot.docs[0].data();
  }
  return null;
}

// ─── LEADS ────────────────────────────────────────────────────────

async function getLeads(orgId, filters = {}) {
  let query = db.collection('organizations').doc(orgId).collection('leads');
  if (filters.scoreLabel) query = query.where('scoreLabel', '==', filters.scoreLabel);
  const snapshot = await query.orderBy('score', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function upsertLead(orgId, contactId, data) {
  const ref = db.collection('organizations').doc(orgId)
    .collection('leads').doc(contactId); // Use contactId as lead doc ID
  await ref.set({
    ...data,
    contactId,
    orgId,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { id: ref.id, ...data };
}

// ─── CONVERSATIONS ────────────────────────────────────────────────

async function getConversations(orgId) {
  const snapshot = await db.collection('organizations').doc(orgId)
    .collection('conversations')
    .orderBy('lastMessageAt', 'desc')
    .limit(50)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function upsertConversation(orgId, contactId, data) {
  const ref = db.collection('organizations').doc(orgId)
    .collection('conversations').doc(contactId);
  await ref.set({
    ...data,
    contactId,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

async function getChatMessages(orgId, contactId) {
  const snapshot = await db.collection('organizations').doc(orgId)
    .collection('chatMessages')
    .where('contactId', '==', contactId)
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function saveChatMessage(orgId, data) {
  const ref = db.collection('organizations').doc(orgId).collection('chatMessages').doc();
  await ref.set({ ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

// ─── ORGANIZATION ─────────────────────────────────────────────────

async function getOrg(orgId) {
  const doc = await db.collection('organizations').doc(orgId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function updateOrg(orgId, data) {
  await db.collection('organizations').doc(orgId)
    .update({ ...data, updatedAt: new Date().toISOString() });
}

async function incrementOrgMessages(orgId, count = 1) {
  const admin = require('firebase-admin');
  await db.collection('organizations').doc(orgId).update({
    messagesUsed: admin.firestore.FieldValue.increment(count),
  });
}

// ─── ANALYTICS ────────────────────────────────────────────────────

async function getDashboardStats(orgId) {
  const [contactsSnap, campaignsSnap, leadsSnap] = await Promise.all([
    db.collection('organizations').doc(orgId).collection('contacts').where('optIn', '==', true).count().get(),
    db.collection('organizations').doc(orgId).collection('campaigns').count().get(),
    db.collection('organizations').doc(orgId).collection('leads').get(),
  ]);

  const totalContacts = contactsSnap.data().count;
  const totalCampaigns = campaignsSnap.data().count;

  const leadBreakdown = { hot: 0, warm: 0, cold: 0 };
  leadsSnap.docs.forEach(doc => {
    const label = doc.data().scoreLabel || 'cold';
    leadBreakdown[label] = (leadBreakdown[label] || 0) + 1;
  });

  return { totalContacts, totalCampaigns, leads: leadBreakdown };
}

// ─── UTILS ────────────────────────────────────────────────────────

function normalizePhone(phone) {
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
}

module.exports = {
  getContacts, createContact, updateContact, deleteContact,
  getCampaigns, createCampaign, updateCampaign,
  createMessage, updateMessageByWaId,
  getLeads, upsertLead,
  getConversations, upsertConversation, getChatMessages, saveChatMessage,
  getOrg, updateOrg, incrementOrgMessages,
  getDashboardStats,
  normalizePhone,
};
