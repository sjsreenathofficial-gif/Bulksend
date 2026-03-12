// routes/chat.routes.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
  assignConversation,
  closeConversation,
  reopenConversation,
  toggleBot,
} = require('../controllers/chat.controller');

router.use(authenticate);

// Conversations
router.get('/conversations',                       listConversations);  // GET  /api/v1/chat/conversations
router.get('/conversations/:contactId',            getConversation);    // GET  /api/v1/chat/conversations/:contactId
router.put('/conversations/:contactId/assign',     assignConversation); // PUT  /api/v1/chat/conversations/:contactId/assign
router.put('/conversations/:contactId/close',      closeConversation);  // PUT  /api/v1/chat/conversations/:contactId/close
router.put('/conversations/:contactId/reopen',     reopenConversation); // PUT  /api/v1/chat/conversations/:contactId/reopen
router.put('/conversations/:contactId/bot',        toggleBot);          // PUT  /api/v1/chat/conversations/:contactId/bot

// Messages
router.get('/conversations/:contactId/messages',   getMessages);        // GET  /api/v1/chat/conversations/:contactId/messages
router.post('/conversations/:contactId/send',      sendMessage);        // POST /api/v1/chat/conversations/:contactId/send

module.exports = router;
