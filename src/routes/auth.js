const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/dashboard', authController.authMiddleware, authController.getDashboardData);
router.put('/settings', authController.authMiddleware, authController.updateSettings);
router.post('/regenerate-keys', authController.authMiddleware, authController.regenerateKeys);
router.post('/change-plan', authController.authMiddleware, authController.changeMerchantPlan);
router.put('/profile', authController.authMiddleware, authController.updateProfile);
router.post('/change-password', authController.authMiddleware, authController.changePassword);
router.get('/subscription-config', authController.authMiddleware, authController.getSubscriptionConfig);
router.post('/submit-subscription-payment', authController.authMiddleware, authController.submitSubscriptionPayment);

module.exports = router;
