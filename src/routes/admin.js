const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Public Login
router.post('/login', adminController.login);

// Protected Admin Routes
router.use(adminController.adminMiddleware);

// 1. Stats & Telemetry
router.get('/stats', adminController.getStats);

// 2. Merchants
router.get('/merchants', adminController.getMerchants);
router.post('/merchants/:id/toggle', adminController.toggleMerchantStatus);
router.put('/merchants/:id/plan', adminController.updateMerchantPlan);

// 3. Transactions & CSV Export
router.get('/orders', adminController.getOrders);
router.post('/orders/:orderId/verify', adminController.manualVerifyOrder);
router.get('/export-csv', adminController.exportTransactionsCsv);

// 4. Webhook Logs
router.get('/webhook-logs', adminController.getWebhookLogs);

// 5. Security & Profile
router.put('/profile', adminController.updateProfile);
router.put('/change-password', adminController.changePassword);

// 6. Multi-UPI VPA Pool
router.get('/upi-pool', adminController.getUpiPool);
router.post('/upi-pool', adminController.addUpiVpa);
router.post('/upi-pool/:id/toggle', adminController.toggleUpiVpa);
router.delete('/upi-pool/:id', adminController.deleteUpiVpa);

// 7. Subscription Plans
router.get('/plans', adminController.getPlans);
router.post('/plans', adminController.savePlan);

// 8. Fraud Blacklist
router.get('/blacklist', adminController.getBlacklist);
router.post('/blacklist', adminController.addBlacklistIp);
router.delete('/blacklist/:id', adminController.removeBlacklistIp);

// 9. System Settings & Telegram
router.get('/settings', adminController.getSettings);
router.post('/settings', adminController.updateSettings);
router.post('/test-telegram', adminController.testTelegramAlert);

// 10. Payouts
router.get('/payouts', adminController.getPayouts);
router.post('/payouts/:id/settle', adminController.settlePayout);

module.exports = router;
