const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');

// 1. Create Order
router.post('/create-order', apiController.createOrder);

// 2. Check Order Status
router.post('/check-order-status', apiController.checkOrderStatus);
router.get('/order-status/:orderId', apiController.checkOrderStatus);

// 3. Public details for Checkout Page
router.get('/public-order/:orderId', apiController.getPublicOrderDetails);

// 4. Fallback Manual UTR Submit
router.post('/pay/verify-utr', apiController.submitManualUtr);

// 5. Automated Notification Receiver (Android Notifier / Bank webhook)
router.post('/webhook/notify', apiController.receiveNotificationWebhook);

module.exports = router;
