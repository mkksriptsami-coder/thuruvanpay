const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Public
router.post('/login', adminController.login);

// Protected Admin Routes
router.get('/stats', adminController.adminMiddleware, adminController.getStats);
router.get('/merchants', adminController.adminMiddleware, adminController.getMerchants);
router.post('/merchants/:id/toggle', adminController.adminMiddleware, adminController.toggleMerchantStatus);
router.get('/orders', adminController.adminMiddleware, adminController.getOrders);
router.post('/orders/:orderId/verify', adminController.adminMiddleware, adminController.manualVerifyOrder);
router.get('/webhook-logs', adminController.adminMiddleware, adminController.getWebhookLogs);

module.exports = router;
