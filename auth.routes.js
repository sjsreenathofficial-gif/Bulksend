// routes/auth.routes.js
const router = require('express').Router();
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/auth/signup
// Body: { email, password, fullName, orgName, phone, industry }
// Note: Frontend signs up with Firebase Auth SDK directly.
//       This endpoint creates the Firestore user + org records.
// ══════════════════════════════════════════════════════════════════
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, orgName, phone, industry } = req.body;

    if (!email || !password || !fullName || !orgName) {
      return res.status(400).json({ error: 'email, password, fullName, orgName are required' });
    }

    // Create Firebase Auth user
    const firebaseUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });

    const userId = firebaseUser.uid;
    const orgId  = uuidv4();
    const now    = new Date().toISOString();

    const db = global.db;
    const batch = db.batch();

    // Create organization document
    batch.set(db.collection('organizations').doc(orgId), {
      id: orgId,
      name: orgName,
      slug: orgName.toLowerCase().replace(/\s+/g, '-') + '-' + orgId.slice(0, 6),
      industry: industry || '',
      plan: 'trial',
      planStatus: 'trial',
      messageLimit: 500,
      messagesUsed: 0,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    // Create user document
    batch.set(db.collection('users').doc(userId), {
      id: userId,
      orgId,
      email,
      fullName,
      phone: phone || '',
      role: 'owner',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await batch.commit();

    // Create custom token for immediate login
    const customToken = await admin.auth().createCustomToken(userId, { orgId, role: 'owner' });

    res.status(201).json({
      message: 'Account created successfully',
      customToken, // Frontend uses this to sign in
      userId,
      orgId,
      orgName,
      plan: 'trial',
    });

  } catch (err) {
    console.error('signup error:', err.message);

    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    if (err.code === 'auth/invalid-password') {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/v1/auth/me
// Get current user info from Firestore
// Header: Authorization: Bearer <Firebase ID Token>
// ══════════════════════════════════════════════════════════════════
router.post('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    const db = global.db;
    const [userDoc, ] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
    ]);

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userDoc.data();
    const orgDoc = await db.collection('organizations').doc(user.orgId).get();
    const org = orgDoc.data();

    res.json({
      user: {
        id: decoded.uid,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      org: {
        id: user.orgId,
        name: org.name,
        plan: org.plan,
        planStatus: org.planStatus,
        messageLimit: org.messageLimit,
        messagesUsed: org.messagesUsed,
        trialEndsAt: org.trialEndsAt,
        remaining: org.messageLimit - org.messagesUsed,
      },
    });

  } catch (err) {
    console.error('me error:', err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DELETE /api/v1/auth/account
// Delete user account (owner only)
// ══════════════════════════════════════════════════════════════════
router.delete('/account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    await admin.auth().deleteUser(decoded.uid);

    res.json({ message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
