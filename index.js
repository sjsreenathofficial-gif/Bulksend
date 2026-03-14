// index.js — Firebase Cloud Functions entry point
// This wraps your entire Express app as a single HTTPS function

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');

// ─── Firebase Admin Init ──────────────────────────────────────────
// When running on Firebase Functions, admin auto-initializes
// No serviceAccountKey.json needed!
if (!admin.apps.length) {
  admin.initializeApp();
}

global.db           = admin.firestore();
global.firebaseAuth = admin.auth();

console.log('✅ Firebase Admin initialized');

// ─── Route imports ────────────────────────────────────────────────
const authRoutes      = require('./auth.routes');
const contactRoutes   = require('./contact.routes');
const campaignRoutes  = require('./campaign.routes');
const webhookRoutes   = require('./webhook.routes');
const aiRoutes        = require('./ai.routes');
const analyticsRoutes = require('./analytics.routes');
const leadRoutes      = require('./lead.routes');
const chatRoutes      = require('./chat.routes');

// ─── Express App ──────────────────────────────────────────────────
const app = express();

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

// Raw body for WhatsApp webhook signature verification
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ─── Health Check ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    'ok',
    app:       'Bulksend — WA Growth Engine',
    version:   '1.0.0',
    database:  'Firebase Firestore',
    hosting:   'Firebase Functions',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────
const API = '/api/v1';

app.use(`${API}/auth`,      authRoutes);
app.use(`${API}/contacts`,  contactRoutes);
app.use(`${API}/campaigns`, campaignRoutes);
app.use(`${API}/webhooks`,  webhookRoutes);
app.use(`${API}/ai`,        aiRoutes);
app.use(`${API}/analytics`, analyticsRoutes);
app.use(`${API}/leads`,     leadRoutes);
app.use(`${API}/chat`,      chatRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Export as Firebase Function ──────────────────────────────────
// Your API will be available at:
// https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/api
exports.api = functions
  .runWith({
    timeoutSeconds: 300,      // 5 min max per request
    memory:         '512MB',  // enough for AI calls
  })
  .https.onRequest(app);
