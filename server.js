require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Firebase Admin
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

// Make db globally available
global.db = db;
global.firebaseAuth = auth;

// Route imports
const authRoutes      = require('./auth.routes');
const contactRoutes   = require('./contact.routes');
const campaignRoutes  = require('./campaign.routes');
const webhookRoutes   = require('./webhook.routes');
const aiRoutes        = require('./ai.routes');
const analyticsRoutes = require('./analytics.routes');
const leadRoutes      = require('./lead.routes');
const chatRoutes      = require('./chat.routes');
const billingRoutes = require('./routes/billing.routes');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ─── Health Check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', db: 'firebase' });
});

// ─── Routes ────────────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/contacts`, contactRoutes);
app.use(`${API}/campaigns`, campaignRoutes);
app.use(`${API}/webhooks`, webhookRoutes);
app.use(`${API}/ai`, aiRoutes);
app.use(`${API}/analytics`, analyticsRoutes);
app.use(`${API}/leads`, leadRoutes);
app.use(`${API}/chat`, chatRoutes);
app.use(`${API}/billing`, billingRoutes);

// ─── Error Handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
module.exports = app;

module.exports = { app, db };
