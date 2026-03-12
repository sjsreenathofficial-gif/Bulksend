// routes/lead.routes.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listLeads,
  getLead,
  updateLead,
  deleteLead,
  convertLead,
} = require('../controllers/lead.controller');

router.use(authenticate);

router.get('/',           listLeads);   // GET    /api/v1/leads
router.get('/:id',        getLead);     // GET    /api/v1/leads/:id
router.put('/:id',        updateLead);  // PUT    /api/v1/leads/:id
router.delete('/:id',     deleteLead);  // DELETE /api/v1/leads/:id
router.post('/:id/convert', convertLead); // POST /api/v1/leads/:id/convert

module.exports = router;
