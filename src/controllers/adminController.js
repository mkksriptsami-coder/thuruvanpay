const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { sendWebhook } = require('../utils/webhookDispatcher');

// Admin Auth Middleware
function adminMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ status: false, message: 'Unauthorized. Admin token missing.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (!decoded.isAdmin) {
      return res.status(403).json({ status: false, message: 'Forbidden. Admin privileges required.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ status: false, message: 'Invalid or expired admin session.' });
  }
}

// 1. Admin Login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: false, message: 'Email and password required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(cleanEmail);

    if (!admin) {
      return res.status(401).json({ status: false, message: 'Invalid admin credentials.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid admin credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, isAdmin: true },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      status: true,
      message: 'Admin authentication successful!',
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('[Admin Login Error]:', error);
    return res.status(500).json({ status: false, message: 'Server error during admin login.' });
  }
}

// 2. Platform Overall Stats
async function getStats(req, res) {
  try {
    const totalMerchants = db.prepare('SELECT count(*) as count FROM merchants').get().count;
    const activeMerchants = db.prepare('SELECT count(*) as count FROM merchants WHERE is_active = 1').get().count;
    const totalOrders = db.prepare('SELECT count(*) as count FROM orders').get().count;
    const successData = db.prepare("SELECT count(*) as count, sum(amount) as total FROM orders WHERE status = 'SUCCESS'").get();
    const pendingOrders = db.prepare("SELECT count(*) as count FROM orders WHERE status = 'PENDING'").get().count;

    const totalRevenue = successData.total || 0;
    const successOrders = successData.count || 0;
    const successRate = totalOrders > 0 ? ((successOrders / totalOrders) * 100).toFixed(1) : '100.0';

    return res.status(200).json({
      status: true,
      stats: {
        totalMerchants,
        activeMerchants,
        totalOrders,
        successOrders,
        pendingOrders,
        totalRevenue,
        successRate
      }
    });
  } catch (error) {
    console.error('[Admin Stats Error]:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch platform stats.' });
  }
}

// 3. Get All Merchants
async function getMerchants(req, res) {
  try {
    const merchants = db.prepare(`
      SELECT m.id, m.name, m.email, m.phone, m.upi_vpa, m.upi_name, 
             m.balance, m.plan, m.is_active, m.created_at,
             (SELECT count(*) FROM orders WHERE merchant_id = m.id) as orders_count,
             (SELECT coalesce(sum(amount), 0) FROM orders WHERE merchant_id = m.id AND status = 'SUCCESS') as total_volume
      FROM merchants m
      ORDER BY m.id DESC
    `).all();

    return res.status(200).json({ status: true, merchants });
  } catch (error) {
    console.error('[Admin Merchants Error]:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch merchants.' });
  }
}

// 4. Toggle Merchant Status (Ban / Activate)
async function toggleMerchantStatus(req, res) {
  try {
    const { id } = req.params;
    const merchant = db.prepare('SELECT id, is_active FROM merchants WHERE id = ?').get(id);

    if (!merchant) {
      return res.status(404).json({ status: false, message: 'Merchant not found.' });
    }

    const newStatus = merchant.is_active === 1 ? 0 : 1;
    db.prepare('UPDATE merchants SET is_active = ? WHERE id = ?').run(newStatus, id);

    return res.status(200).json({
      status: true,
      message: `Merchant ${newStatus === 1 ? 'activated' : 'suspended'} successfully.`,
      is_active: newStatus
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error toggling merchant status.' });
  }
}

// 5. Get All Orders (Transactions Stream)
async function getOrders(req, res) {
  try {
    const { search, status } = req.query;
    let query = `
      SELECT o.*, m.name as merchant_name, m.email as merchant_email
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
    `;
    const params = [];
    const conditions = [];

    if (status && status !== 'ALL') {
      conditions.push('o.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(o.order_id LIKE ? OR o.utr LIKE ? OR o.customer_name LIKE ? OR m.name LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY o.created_at DESC LIMIT 50';

    const orders = db.prepare(query).all(...params);
    return res.status(200).json({ status: true, orders });
  } catch (error) {
    console.error('[Admin Orders Error]:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch orders.' });
  }
}

// 6. Manual Force Verify Order by Admin
async function manualVerifyOrder(req, res) {
  try {
    const { orderId } = req.params;
    const { utr } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ status: false, message: 'Order not found.' });
    }

    const finalUtr = (utr && utr.trim()) || `ADMIN_VERIFIED_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE orders 
      SET status = 'SUCCESS', utr = ?, payment_app = 'Admin Manual Verification', completed_at = ?
      WHERE order_id = ?
    `).run(finalUtr, now, orderId);

    // Credit merchant balance
    db.prepare('UPDATE merchants SET balance = balance + ? WHERE id = ?').run(order.amount, order.merchant_id);

    // Send webhook to merchant
    sendWebhook(orderId);

    return res.status(200).json({
      status: true,
      message: `Order ${orderId} marked as SUCCESS! Webhook dispatched.`,
      utr: finalUtr
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to verify order.' });
  }
}

// 7. Get Recent Webhook Logs
async function getWebhookLogs(req, res) {
  try {
    const logs = db.prepare('SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 30').all();
    return res.status(200).json({ status: true, logs });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to load logs.' });
  }
}

module.exports = {
  adminMiddleware,
  login,
  getStats,
  getMerchants,
  toggleMerchantStatus,
  getOrders,
  manualVerifyOrder,
  getWebhookLogs
};
