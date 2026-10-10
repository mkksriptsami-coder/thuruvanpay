const crypto = require('crypto');
const db = require('../db');
const { getSecret } = require('../security/config');
const { submitOrderReview, respondToReview, verificationUnavailable } = require('../services/paymentReview');

// 1. Create Order (Merchant developer API)
async function createOrder(req, res) {
  // No trusted receipt verifier exists yet. Never initiate a collection we cannot verify.
  return verificationUnavailable(res);
}

// 2. Check Order Status (Developer API)
async function checkOrderStatus(req, res) {
  try {
    const apiKey = req.headers['x-api-key'] || req.body?.api_key;
    const apiSecret = req.headers['x-api-secret'] || req.body?.api_secret;
    const orderId = req.params.orderId || req.body?.order_id || req.query.order_id;

    if (!orderId) {
      return res.status(400).json({ status: false, message: 'Missing order_id' });
    }

    if (Boolean(apiKey) !== Boolean(apiSecret)) return res.status(401).json({ status: false, message: 'Both API credentials are required.' });
    let order = null;
    if (apiKey && apiSecret) {
      const stmt = db.prepare(`
        SELECT o.* FROM orders o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.order_id = ? AND m.api_key = ? AND m.api_secret = ? AND m.is_active = 1
      `);
      order = stmt.get(orderId, apiKey, apiSecret);
    } else {
      // Allow internal/public check only by order_id
      const stmt = db.prepare('SELECT order_id, amount, status, utr, payment_app, created_at, completed_at, redirect_url FROM orders WHERE order_id = ?');
      order = stmt.get(orderId);
    }

    if (!order) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    return res.status(200).json({
      status: true,
      data: {
        verification_available: false,
        order_id: order.order_id,
        amount: order.amount,
        status: order.status,
        utr: order.utr || null,
        payment_app: order.payment_app || null,
        redirect_url: order.redirect_url || null,
        created_at: order.created_at,
        completed_at: order.completed_at || null
      }
    });
  } catch (error) {
    console.error('[Check Status Error]:', error);
    return res.status(500).json({ status: false, message: 'Server error checking order status' });
  }
}

// 3. Public Order details for the Checkout Page
async function getPublicOrderDetails(req, res) {
  try {
    const { orderId } = req.params;
    const orderStmt = db.prepare(`
      SELECT o.order_id, o.amount, o.status, o.customer_name, o.redirect_url, 
             o.created_at, o.upi_vpa, m.upi_name
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.order_id = ?
    `);
    const order = orderStmt.get(orderId);

    if (!order) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    // Preserve historical status for reconciliation, but never expose a new QR/intent.
    return res.status(200).json({ status: true, data: {
      order_id: order.order_id, amount: order.amount, status: order.status,
      upi_name: order.upi_name, verification_available: false
    } });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Server error' });
  }
}

// 4. Manual UTR Submission fallback on Checkout Page
async function submitManualUtr(req, res) {
  return respondToReview(res, () => submitOrderReview(req.body));
}

// 5. Automated Notification Receiver (From Android Notifier / SMS forwarder)
async function receiveNotificationWebhook(req, res) {
  try {
    const expectedSecret = getSecret('NOTIFICATION_SECRET_KEY', { optional: true });
    if (!expectedSecret) return verificationUnavailable(res);
    const supplied = req.headers['x-notify-secret'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expectedSecret) ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedSecret))) {
      return res.status(403).json({ status: false, message: 'Unauthorized notification request.' });
    }
    // A shared-secret notification is not a bank receipt. No amount-only matching,
    // synthetic UTR, balance mutation or callback is allowed without a real verifier.
    return verificationUnavailable(res);
  } catch (error) {
    return verificationUnavailable(res);
  }
}

module.exports = {
  createOrder,
  checkOrderStatus,
  getPublicOrderDetails,
  submitManualUtr,
  receiveNotificationWebhook
};
