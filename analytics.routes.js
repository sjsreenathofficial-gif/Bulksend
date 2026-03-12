// routes/analytics.routes.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getDashboard,
  getCampaignAnalytics,
  getOverview,
  getContactStats,
} = require('../controllers/analytics.controller');

router.use(authenticate);

router.get('/dashboard',         getDashboard);          // GET /api/v1/analytics/dashboard
router.get('/overview',          getOverview);           // GET /api/v1/analytics/overview
router.get('/contacts',          getContactStats);       // GET /api/v1/analytics/contacts
router.get('/campaigns/:id',     getCampaignAnalytics);  // GET /api/v1/analytics/campaigns/:id

module.exports = router;
