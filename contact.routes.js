// routes/contact.routes.js
const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  addTag,
  removeTag,
} = require('../controllers/contact.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files allowed'));
    }
  },
});

router.use(authenticate);

router.get('/',          listContacts);       // GET  /api/v1/contacts
router.post('/',         createContact);      // POST /api/v1/contacts
router.put('/:id',       updateContact);      // PUT  /api/v1/contacts/:id
router.delete('/:id',    deleteContact);      // DELETE /api/v1/contacts/:id
router.post('/import',   upload.single('file'), importContacts); // POST /api/v1/contacts/import
router.post('/:id/tags', addTag);             // POST /api/v1/contacts/:id/tags
router.delete('/:id/tags/:tag', removeTag);   // DELETE /api/v1/contacts/:id/tags/:tag

module.exports = router;
