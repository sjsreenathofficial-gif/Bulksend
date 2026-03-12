require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { generalRateLimit } = require('./middleware/rateLimiter');

// Route imports
const authRoutes = require('./routes/auth.routes');
const orgRoutes = require('./routes/org.routes');
const contactRoutes = require('./routes/contact.routes');
const campaignRoutes = require('./routes/campaign.routes');
const templateRoutes = require('./routes/template.routes');
const messageRoutes = require('./routes/message.routes');
const webhookRoutes = require('./routes/webhook.routes');
const aiRoutes = require('./routes/ai.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const leadRoutes = require('./routes/lead.routes');
const chatRoutes = require('./routes/chat.routes');
const billingRoutes = require('./routes/billing.routes');
const chatbotRoutes = require('./routes/chatbot.routes');

// Queue workers (start consuming)
require('./queues/messageQueue');

const app = express();
const httpServer = createServer(app);

// ─── Security Middleware ───────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Raw body for webhook signature verification
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ─── Rate Limiting ─────────────────────────────────────────────────
app.use('/api/', generalRateLimit);

// ─── Health Check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── API Routes ────────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/org`, orgRoutes);
app.use(`${API}/contacts`, contactRoutes);
app.use(`${API}/campaigns`, campaignRoutes);
app.use(`${API}/templates`, templateRoutes);
app.use(`${API}/messages`, messageRoutes);
app.use(`${API}/webhooks`, webhookRoutes);
app.use(`${API}/ai`, aiRoutes);
app.use(`${API}/analytics`, analyticsRoutes);
app.use(`${API}/leads`, leadRoutes);
app.use(`${API}/chat`, chatRoutes);
app.use(`${API}/billing`, billingRoutes);
app.use(`${API}/chatbots`, chatbotRoutes);

// ─── Error Handler ─────────────────────────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  logger.info(`🚀 WA Growth Engine API running on port ${PORT}`);
});

module.exports = app;
