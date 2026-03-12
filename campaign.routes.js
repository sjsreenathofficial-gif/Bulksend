// routes/campaign.routes.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listCampaigns,
  getCampaign,
  createCampaign,
  launchCampaign,
  pauseCampaign,
  deleteCampaign,
  getCampaignStats,
} = require('../controllers/campaign.controller');

router.use(authenticate);

router.get('/',              listCampaigns);    // GET    /api/v1/campaigns
router.get('/:id',           getCampaign);      // GET    /api/v1/campaigns/:id
router.post('/',             createCampaign);   // POST   /api/v1/campaigns
router.post('/:id/launch',   launchCampaign);   // POST   /api/v1/campaigns/:id/launch
router.post('/:id/pause',    pauseCampaign);    // POST   /api/v1/campaigns/:id/pause
router.delete('/:id',        deleteCampaign);   // DELETE /api/v1/campaigns/:id
router.get('/:id/stats',     getCampaignStats); // GET    /api/v1/campaigns/:id/stats

module.exports = router;
