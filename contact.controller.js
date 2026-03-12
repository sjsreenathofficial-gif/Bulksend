// controllers/contact.controller.js
const { parse } = require('csv-parse');
const { Readable } = require('stream');
const admin = require('firebase-admin');

// ─── Helper: normalize Indian phone numbers ────────────────────────
function normalizePhone(phone) {
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  if (cleaned.startsWith('0')) cleaned = '91' + cleaned.slice(1);
  return cleaned;
}

// ─── Helper: get contacts collection ref ──────────────────────────
function contactsRef(orgId) {
  return global.db.collection('organizations').doc(orgId).collection('contacts');
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/contacts
// Query params: search, tag, city, industry, optIn, page, limit
// ══════════════════════════════════════════════════════════════════
async function listContacts(req, res) {
  try {
    const { search, tag, city, industry, optIn, limit = '50' } = req.query;

    let query = contactsRef(req.orgId);

    // Firestore filters (only equality filters — no full-text search)
    if (city)     query = query.where('city', '==', city);
    if (industry) query = query.where('industry', '==', industry);
    if (tag)      query = query.where('tags', 'array-contains', tag);
    if (optIn !== undefined) query = query.where('optIn', '==', optIn === 'true');

    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit));

    const snapshot = await query.get();
    let contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side search (Firestore doesn't support LIKE queries)
    if (search) {
      const s = search.toLowerCase();
      contacts = contacts.filter(c =>
        c.name?.toLowerCase().includes(s) ||
        c.phone?.includes(s) ||
        c.email?.toLowerCase().includes(s)
      );
    }

    // Get total count
    const totalSnap = await contactsRef(req.orgId).count().get();
    const total = totalSnap.data().count;

    res.json({
      contacts,
      total,
      returned: contacts.length,
    });

  } catch (err) {
    console.error('listContacts error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/contacts
// Body: { phone, name, email, city, state, industry, tags[] }
// ══════════════════════════════════════════════════════════════════
async function createContact(req, res) {
  try {
    const { phone, name, email, city, state, industry, tags = [], notes } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const normalizedPhone = normalizePhone(phone);

    // Use phone as document ID — prevents duplicates automatically
    const docRef = contactsRef(req.orgId).doc(normalizedPhone);
    const existing = await docRef.get();

    const contactData = {
      phone: normalizedPhone,
      name: name || '',
      email: email || '',
      city: city || '',
      state: state || 'Telangana',
      industry: industry || '',
      tags: tags || [],
      notes: notes || '',
      optIn: true,
      optInAt: new Date().toISOString(),
      source: 'manual',
      orgId: req.orgId,
      updatedAt: new Date().toISOString(),
    };

    if (existing.exists) {
      // Update existing contact
      await docRef.update(contactData);
      return res.json({ id: normalizedPhone, ...contactData, updated: true });
    }

    // Create new contact
    contactData.createdAt = new Date().toISOString();
    await docRef.set(contactData);

    res.status(201).json({ id: normalizedPhone, ...contactData });

  } catch (err) {
    console.error('createContact error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PUT /api/v1/contacts/:id
// Body: any contact fields to update
// ══════════════════════════════════════════════════════════════════
async function updateContact(req, res) {
  try {
    const { id } = req.params;

    // Fields allowed to update
    const allowed = ['name', 'email', 'city', 'state', 'industry', 'notes', 'optIn', 'customFields'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    updates.updatedAt = new Date().toISOString();

    const docRef = contactsRef(req.orgId).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await docRef.update(updates);
    res.json({ id, ...doc.data(), ...updates });

  } catch (err) {
    console.error('updateContact error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/v1/contacts/:id
// ══════════════════════════════════════════════════════════════════
async function deleteContact(req, res) {
  try {
    const { id } = req.params;
    const docRef = contactsRef(req.orgId).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await docRef.delete();
    res.json({ message: 'Contact deleted', id });

  } catch (err) {
    console.error('deleteContact error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/contacts/import
// Body: multipart/form-data with CSV file
// CSV columns: phone, name, email, city, state, industry, tags
// ══════════════════════════════════════════════════════════════════
async function importContacts(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a CSV file' });
    }

    const results = [];
    const errors  = [];
    let rowIndex  = 0;

    // Parse CSV from buffer
    const csvText = req.file.buffer.toString('utf8');
    const stream  = Readable.from(csvText);
    const parser  = stream.pipe(parse({
      columns: true,           // use first row as headers
      skip_empty_lines: true,
      trim: true,
    }));

    for await (const row of parser) {
      rowIndex++;
      try {
        // Support multiple column name formats
        const phone = row.phone || row.Phone || row.mobile || row.Mobile || row.PHONE;

        if (!phone) {
          errors.push({ row: rowIndex, error: 'Missing phone number' });
          continue;
        }

        const normalizedPhone = normalizePhone(phone);

        // Parse tags (comma-separated string → array)
        const tagsRaw = row.tags || row.Tags || '';
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

        results.push({
          phone: normalizedPhone,
          name: row.name || row.Name || '',
          email: row.email || row.Email || '',
          city: row.city || row.City || '',
          state: row.state || row.State || 'Telangana',
          industry: row.industry || row.Industry || '',
          tags,
          optIn: true,
          optInAt: new Date().toISOString(),
          source: 'csv_import',
          orgId: req.orgId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

      } catch (e) {
        errors.push({ row: rowIndex, error: e.message });
      }
    }

    if (results.length === 0) {
      return res.status(400).json({
        error: 'No valid contacts found in CSV',
        errors,
        tip: 'Make sure your CSV has a "phone" column',
      });
    }

    // Batch write to Firestore (max 500 per batch)
    let imported = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const chunk = results.slice(i, i + BATCH_SIZE);
      const batch = global.db.batch();

      chunk.forEach(contact => {
        const ref = contactsRef(req.orgId).doc(contact.phone);
        batch.set(ref, contact, { merge: true }); // merge = update if exists
      });

      await batch.commit();
      imported += chunk.length;
    }

    console.log(`CSV import: org=${req.orgId} imported=${imported} errors=${errors.length}`);

    res.json({
      success: true,
      imported,
      skipped: errors.length,
      total: rowIndex,
      errors: errors.slice(0, 10), // Return first 10 errors only
    });

  } catch (err) {
    console.error('importContacts error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/contacts/:id/tags
// Body: { tag: "Hot Lead" }
// ══════════════════════════════════════════════════════════════════
async function addTag(req, res) {
  try {
    const { id } = req.params;
    const { tag } = req.body;

    if (!tag) return res.status(400).json({ error: 'Tag name required' });

    const docRef = contactsRef(req.orgId).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(404).json({ error: 'Contact not found' });

    // Use arrayUnion to add tag without duplicates
    await docRef.update({
      tags: admin.firestore.FieldValue.arrayUnion(tag),
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: 'Tag added', tag });

  } catch (err) {
    console.error('addTag error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/v1/contacts/:id/tags/:tag
// ══════════════════════════════════════════════════════════════════
async function removeTag(req, res) {
  try {
    const { id, tag } = req.params;

    const docRef = contactsRef(req.orgId).doc(id);

    await docRef.update({
      tags: admin.firestore.FieldValue.arrayRemove(tag),
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: 'Tag removed', tag });

  } catch (err) {
    console.error('removeTag error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  addTag,
  removeTag,
};
