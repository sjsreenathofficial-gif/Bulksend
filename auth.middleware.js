// middleware/auth.middleware.js
// Uses Firebase ID tokens instead of custom JWT

const admin = require('firebase-admin');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify Firebase ID token
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.userId = decoded.uid;
    req.userEmail = decoded.email;

    // Get orgId from Firestore user record
    const userDoc = await global.db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    req.orgId = userData.orgId;
    req.userRole = userData.role;

    next();
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
