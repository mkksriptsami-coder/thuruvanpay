const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/dashboard', authController.authMiddleware, authController.getDashboardData);
router.put('/settings', authController.authMiddleware, authController.updateSettings);
router.post('/regenerate-keys', authController.authMiddleware, authController.regenerateKeys);

module.exports = router;
