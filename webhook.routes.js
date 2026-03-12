// routes/webhook.routes.js
const router = require('express').Router();
const { verifyWebhook, receiveWebhook } = require('../controllers/webhook.controller');

// No authentication on webhooks — Meta calls these directly
// Verification is done via WA_APP_SECRET signature check

router.get('/whatsapp',  verifyWebhook);  // GET  /api/v1/webhooks/whatsapp
router.post('/whatsapp', receiveWebhook); // POST /api/v1/webhooks/whatsapp

module.exports = router;
