const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../db');
const { getSecret } = require('../security/config');
const { sendWebhook } = require('../utils/webhookDispatcher');

// 1. Create Order (Merchant developer API)
async function createOrder(req, res) {
  try {
    const apiKey = req.headers['x-api-key'] || req.body.api_key;
    const apiSecret = req.headers['x-api-secret'] || req.body.api_secret;

    if (!apiKey || !apiSecret) {
      return res.status(401).json({
        status: false,
        message: 'Authentication failed. Please provide x-api-key and x-api-secret headers.'
      });
    }

    const merchantStmt = db.prepare('SELECT * FROM merchants WHERE api_key = ? AND api_secret = ? AND is_active = 1');
    const merchant = merchantStmt.get(apiKey, apiSecret);

    if (!merchant) {
      return res.status(401).json({
        status: false,
        message: 'Invalid API credentials or merchant account deactivated.'
      });
    }

    const {
      amount,
      customer_name,
      customer_mobile,
      customer_email,
      redirect_url,
      webhook_url,
      custom_order_id
    } = req.body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        status: false,
        message: 'Invalid amount. Must be a positive number.'
      });
    }

    const orderId = custom_order_id || `ORD_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    // Check if custom order ID already exists
    const checkStmt = db.prepare('SELECT order_id FROM orders WHERE order_id = ?');
    if (checkStmt.get(orderId)) {
      return res.status(409).json({
        status: false,
        message: 'Order ID already exists. Please provide a unique order ID.'
      });
    }

    const upiVpa = merchant.upi_vpa || 'merchant@upi';
    const upiName = merchant.upi_name || merchant.name;

    // Build standard NPCI UPI Intent URI
    // Format: upi://pay?pa=VPA&pn=NAME&am=AMOUNT&cu=INR&tn=NOTE&tr=TRANSACTION_REF
    const encodedName = encodeURIComponent(upiName);
    const formattedAmount = parsedAmount.toFixed(2);
    const upiIntent = `upi://pay?pa=${upiVpa}&pn=${encodedName}&am=${formattedAmount}&cu=INR&tn=Pay%20Order%20${orderId}&tr=${orderId}`;

    // App-specific intents for mobile auto-open
    const gpayIntent = `gpay://upi/pay?pa=${upiVpa}&pn=${encodedName}&am=${formattedAmount}&cu=INR&tn=Pay%20Order%20${orderId}&tr=${orderId}`;
    const phonepeIntent = `phonepe://pay?pa=${upiVpa}&pn=${encodedName}&am=${formattedAmount}&cu=INR&tn=Pay%20Order%20${orderId}&tr=${orderId}`;
    const paytmIntent = `paytmmp://pay?pa=${upiVpa}&pn=${encodedName}&am=${formattedAmount}&cu=INR&tn=Pay%20Order%20${orderId}&tr=${orderId}`;

    // Generate dynamic QR Code Data URL
    const qrCodeDataUrl = await QRCode.toDataURL(upiIntent, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    const insertStmt = db.prepare(`
      INSERT INTO orders (
        order_id, merchant_id, amount, customer_name, customer_mobile, 
        customer_email, redirect_url, webhook_url, upi_vpa, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    insertStmt.run(
      orderId,
      merchant.id,
      parsedAmount,
      customer_name || 'Customer',
      customer_mobile || '',
      customer_email || '',
      redirect_url || '',
      webhook_url || merchant.webhook_url || '',
      upiVpa
    );

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const paymentUrl = `${baseUrl}/checkout.html?order_id=${orderId}`;

    return res.status(200).json({
      status: true,
      message: 'Order created successfully',
      data: {
        order_id: orderId,
        amount: parsedAmount,
        currency: 'INR',
        upi_vpa: upiVpa,
        upi_name: upiName,
        payment_url: paymentUrl,
        upi_intent: upiIntent,
        app_intents: {
          gpay: gpayIntent,
          phonepe: phonepeIntent,
          paytm: paytmIntent
        },
        qr_code: qrCodeDataUrl,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Create Order Error]:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while creating order'
    });
  }
}

// 2. Check Order Status (Developer API)
async function checkOrderStatus(req, res) {
  try {
    const apiKey = req.headers['x-api-key'] || req.body.api_key;
    const apiSecret = req.headers['x-api-secret'] || req.body.api_secret;
    const orderId = req.params.orderId || req.body.order_id || req.query.order_id;

    if (!orderId) {
      return res.status(400).json({ status: false, message: 'Missing order_id' });
    }

    let order = null;
    if (apiKey && apiSecret) {
      const stmt = db.prepare(`
        SELECT o.* FROM orders o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.order_id = ? AND m.api_key = ? AND m.api_secret = ?
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

    const upiName = order.upi_name || 'Merchant';
    const encodedName = encodeURIComponent(upiName);
    const formattedAmount = order.amount.toFixed(2);
    const upiIntent = `upi://pay?pa=${order.upi_vpa}&pn=${encodedName}&am=${formattedAmount}&cu=INR&tn=Pay%20Order%20${order.order_id}&tr=${order.order_id}`;

    const qrCodeDataUrl = await QRCode.toDataURL(upiIntent, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    return res.status(200).json({
      status: true,
      data: {
        ...order,
        upi_intent: upiIntent,
        qr_code: qrCodeDataUrl
      }
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Server error' });
  }
}

// 4. Manual UTR Submission fallback on Checkout Page
async function submitManualUtr(req, res) {
  try {
    const { order_id, utr, payment_app } = req.body;

    if (!order_id || !utr) {
      return res.status(400).json({ status: false, message: 'Order ID and 12-digit UTR are required.' });
    }

    const cleanUtr = utr.trim();
    if (cleanUtr.length < 10 || cleanUtr.length > 20) {
      return res.status(400).json({ status: false, message: 'Invalid UTR format. UPI Reference Number is 12 digits.' });
    }

    // Check if this UTR was already used for another completed order to prevent double-spending
    const checkDuplicate = db.prepare("SELECT order_id FROM orders WHERE utr = ? AND status = 'SUCCESS' AND order_id != ?");
    if (checkDuplicate.get(cleanUtr, order_id)) {
      return res.status(409).json({ status: false, message: 'This UTR has already been claimed for another payment.' });
    }

    const orderStmt = db.prepare('SELECT * FROM orders WHERE order_id = ?');
    const order = orderStmt.get(order_id);

    if (!order) {
      return res.status(404).json({ status: false, message: 'Order not found.' });
    }

    if (order.status === 'SUCCESS') {
      return res.status(200).json({ status: true, message: 'Order is already marked as SUCCESS.', redirect_url: order.redirect_url });
    }

    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE orders 
      SET status = 'SUCCESS', utr = ?, payment_app = ?, completed_at = ? 
      WHERE order_id = ?
    `);
    updateStmt.run(cleanUtr, payment_app || 'Manual UPI', now, order_id);

    // Update merchant balance
    db.prepare('UPDATE merchants SET balance = balance + ? WHERE id = ?').run(order.amount, order.merchant_id);

    // Dispatch webhook to merchant's server asynchronously
    sendWebhook(order_id);

    return res.status(200).json({
      status: true,
      message: 'Payment verified successfully!',
      redirect_url: order.redirect_url
    });
  } catch (error) {
    console.error('[Submit UTR Error]:', error);
    return res.status(500).json({ status: false, message: 'Error processing UTR submission.' });
  }
}

// 5. Automated Notification Receiver (From Android Notifier / SMS forwarder)
async function receiveNotificationWebhook(req, res) {
  try {
    const notificationSecret = req.headers['x-notify-secret'] || req.body.secret_key;
    const expectedSecret = getSecret('NOTIFICATION_SECRET_KEY', { optional: true });
    if (!expectedSecret) return res.status(503).json({ status: false, message: 'Notification receiver is not configured.' });

    if (notificationSecret !== expectedSecret) {
      return res.status(403).json({ status: false, message: 'Unauthorized notification request.' });
    }

    const { amount, utr, order_id, body_text } = req.body;
    const parsedAmount = parseFloat(amount);

    let targetOrder = null;

    if (order_id) {
      targetOrder = db.prepare("SELECT * FROM orders WHERE order_id = ? AND status = 'PENDING'").get(order_id);
    } else if (!isNaN(parsedAmount) && parsedAmount > 0) {
      // Find the most recent pending order matching exact amount in the last 20 minutes
      targetOrder = db.prepare(`
        SELECT * FROM orders 
        WHERE status = 'PENDING' AND ROUND(amount, 2) = ROUND(?, 2)
        ORDER BY created_at DESC 
        LIMIT 1
      `).get(parsedAmount);
    }

    if (!targetOrder) {
      return res.status(200).json({
        status: true,
        message: 'Notification received, but no matching pending order found to auto-credit.'
      });
    }

    const cleanUtr = utr || `AUTO_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE orders 
      SET status = 'SUCCESS', utr = ?, payment_app = 'Auto Listener', completed_at = ?
      WHERE order_id = ?
    `).run(cleanUtr, now, targetOrder.order_id);

    // Update merchant balance
    db.prepare('UPDATE merchants SET balance = balance + ? WHERE id = ?').run(targetOrder.amount, targetOrder.merchant_id);

    // Dispatch webhook to merchant server
    sendWebhook(targetOrder.order_id);

    return res.status(200).json({
      status: true,
      message: `Order ${targetOrder.order_id} credited and marked SUCCESS successfully!`,
      order_id: targetOrder.order_id
    });
  } catch (error) {
    console.error('[Notification Webhook Error]:', error);
    return res.status(500).json({ status: false, message: 'Failed to process notification webhook.' });
  }
}

module.exports = {
  createOrder,
  checkOrderStatus,
  getPublicOrderDetails,
  submitManualUtr,
  receiveNotificationWebhook
};
