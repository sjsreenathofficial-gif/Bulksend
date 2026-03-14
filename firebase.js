// firebase.js
// When running on Firebase Functions, admin auto-initializes
// No serviceAccountKey.json needed!
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

global.db           = admin.firestore();
global.firebaseAuth = admin.auth();

console.log('✅ Firebase connected');

module.exports = { admin };
