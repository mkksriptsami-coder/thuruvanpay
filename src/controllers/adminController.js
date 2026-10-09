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

// 8. Change Admin Password & Profile
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ status: false, message: 'Current and new password are required.' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (!admin) return res.status(404).json({ status: false, message: 'Admin not found.' });

    const isMatch = await bcrypt.compare(current_password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(new_password, salt);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, req.admin.id);

    return res.status(200).json({ status: true, message: 'Admin password changed successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error changing password.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { name, email } = req.body;
    db.prepare('UPDATE admins SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?').run(name, email, req.admin.id);
    return res.status(200).json({ status: true, message: 'Admin profile updated!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error updating profile.' });
  }
}

// 9. Export Transactions as CSV (Excel compatible)
async function exportTransactionsCsv(req, res) {
  try {
    const orders = db.prepare(`
      SELECT o.order_id, m.name as merchant_name, o.customer_name, o.customer_mobile,
             o.amount, o.status, o.utr, o.payment_app, o.created_at, o.completed_at
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      ORDER BY o.created_at DESC
    `).all();

    let csv = 'Order ID,Merchant Name,Customer Name,Customer Mobile,Amount (INR),Status,Bank UTR,Payment App,Created At,Completed At\n';
    orders.forEach(o => {
      csv += `"${o.order_id}","${o.merchant_name || ''}","${o.customer_name || ''}","${o.customer_mobile || ''}",${o.amount},"${o.status}","${o.utr || ''}","${o.payment_app || ''}","${o.created_at}","${o.completed_at || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=thuruvanpay_transactions_${Date.now()}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).send('Error generating CSV');
  }
}

// 10. Multi-UPI VPA Pool
async function getUpiPool(req, res) {
  try {
    const pool = db.prepare('SELECT * FROM upi_pool ORDER BY id DESC').all();
    return res.status(200).json({ status: true, pool });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error fetching UPI pool.' });
  }
}

async function addUpiVpa(req, res) {
  try {
    const { vpa, display_name, daily_limit } = req.body;
    if (!vpa || !display_name) {
      return res.status(400).json({ status: false, message: 'UPI VPA and display name are required.' });
    }

    db.prepare('INSERT INTO upi_pool (vpa, display_name, daily_limit) VALUES (?, ?, ?)')
      .run(vpa.trim(), display_name.trim(), parseFloat(daily_limit) || 100000.0);

    return res.status(201).json({ status: true, message: 'UPI VPA added to pool!' });
  } catch (error) {
    return res.status(409).json({ status: false, message: 'VPA already exists in pool.' });
  }
}

async function toggleUpiVpa(req, res) {
  try {
    const { id } = req.params;
    const vpa = db.prepare('SELECT is_active FROM upi_pool WHERE id = ?').get(id);
    if (!vpa) return res.status(404).json({ status: false, message: 'VPA not found.' });

    const newStatus = vpa.is_active === 1 ? 0 : 1;
    db.prepare('UPDATE upi_pool SET is_active = ? WHERE id = ?').run(newStatus, id);
    return res.status(200).json({ status: true, message: 'VPA status toggled!', is_active: newStatus });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error updating VPA.' });
  }
}

async function deleteUpiVpa(req, res) {
  try {
    db.prepare('DELETE FROM upi_pool WHERE id = ?').run(req.params.id);
    return res.status(200).json({ status: true, message: 'VPA removed from pool.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error deleting VPA.' });
  }
}

// 11. Subscription Plans & Merchant Tiers
async function getPlans(req, res) {
  try {
    const plans = db.prepare('SELECT * FROM subscription_plans ORDER BY price ASC').all();
    return res.status(200).json({ status: true, plans });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error loading plans.' });
  }
}

async function savePlan(req, res) {
  try {
    const { id, name, price, validity_days, features } = req.body;
    if (id) {
      db.prepare('UPDATE subscription_plans SET name = ?, price = ?, validity_days = ?, features = ? WHERE id = ?')
        .run(name, parseFloat(price), parseInt(validity_days), features || '', id);
      return res.status(200).json({ status: true, message: 'Plan updated successfully!' });
    } else {
      db.prepare('INSERT INTO subscription_plans (name, price, validity_days, features) VALUES (?, ?, ?, ?)')
        .run(name, parseFloat(price), parseInt(validity_days), features || '');
      return res.status(201).json({ status: true, message: 'Plan created successfully!' });
    }
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error saving plan.' });
  }
}

async function togglePlan(req, res) {
  try {
    const { id } = req.params;
    db.prepare('UPDATE subscription_plans SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
    return res.status(200).json({ status: true, message: 'Plan status updated!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error updating plan status.' });
  }
}

async function deletePlan(req, res) {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM subscription_plans WHERE id = ?').run(id);
    return res.status(200).json({ status: true, message: 'Plan deleted successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error deleting plan.' });
  }
}

async function updateMerchantPlan(req, res) {
  try {
    const { id } = req.params;
    const { plan } = req.body;
    db.prepare('UPDATE merchants SET plan = ? WHERE id = ?').run(plan, id);
    return res.status(200).json({ status: true, message: 'Merchant plan updated successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update merchant plan.' });
  }
}

// 12. Fraud & Security Blacklist
async function getBlacklist(req, res) {
  try {
    const list = db.prepare('SELECT * FROM security_blacklist ORDER BY id DESC').all();
    return res.status(200).json({ status: true, list });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error loading blacklist.' });
  }
}

async function addBlacklistIp(req, res) {
  try {
    const { ip_address, reason } = req.body;
    db.prepare('INSERT INTO security_blacklist (ip_address, reason) VALUES (?, ?)')
      .run(ip_address.trim(), reason || 'Manual Admin Block');
    return res.status(201).json({ status: true, message: 'IP address blocked successfully!' });
  } catch (error) {
    return res.status(409).json({ status: false, message: 'IP is already blocked.' });
  }
}

async function removeBlacklistIp(req, res) {
  try {
    db.prepare('DELETE FROM security_blacklist WHERE id = ?').run(req.params.id);
    return res.status(200).json({ status: true, message: 'IP unblocked successfully.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error removing IP.' });
  }
}

// 13. System Settings & Telegram Alerts
async function getSettings(req, res) {
  try {
    const rows = db.prepare('SELECT * FROM system_settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return res.status(200).json({ status: true, settings });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error loading settings.' });
  }
}

async function updateSettings(req, res) {
  try {
    const entries = Object.entries(req.body);
    const stmt = db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)');
    entries.forEach(([key, val]) => {
      stmt.run(key, String(val));
    });
    return res.status(200).json({ status: true, message: 'System settings saved!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error saving settings.' });
  }
}

async function testTelegramAlert(req, res) {
  try {
    const axios = require('axios');
    const tokenRow = db.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_token'").get();
    const chatRow = db.prepare("SELECT value FROM system_settings WHERE key = 'telegram_chat_id'").get();

    const botToken = tokenRow ? tokenRow.value : '';
    const chatId = chatRow ? chatRow.value : '';

    if (!botToken || !chatId) {
      return res.status(400).json({ status: false, message: 'Please configure Telegram Bot Token and Chat ID first.' });
    }

    const text = '🔔 *ThuruvanPay Test Alert*\n\nGateway telemetry connection active! You will receive notifications for high-value transactions and merchant registrations.';
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });

    return res.status(200).json({ status: true, message: 'Telegram test message sent successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to send Telegram test message: ' + (error.response ? JSON.stringify(error.response.data) : error.message) });
  }
}

// 14. Payouts Management
async function getPayouts(req, res) {
  try {
    const payouts = db.prepare(`
      SELECT p.*, m.name as merchant_name, m.email as merchant_email
      FROM payout_requests p
      JOIN merchants m ON p.merchant_id = m.id
      ORDER BY p.requested_at DESC
    `).all();
    return res.status(200).json({ status: true, payouts });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Error loading payouts.' });
  }
}

async function settlePayout(req, res) {
  try {
    const { id } = req.params;
    const { utr } = req.body;
    const now = new Date().toISOString();
    db.prepare("UPDATE payout_requests SET status = 'SETTLED', utr = ?, processed_at = ? WHERE id = ?")
      .run(utr || `PAYOUT_${Date.now()}`, now, id);
    return res.status(200).json({ status: true, message: 'Payout marked as SETTLED!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to settle payout.' });
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
  getWebhookLogs,
  changePassword,
  updateProfile,
  exportTransactionsCsv,
  getUpiPool,
  addUpiVpa,
  toggleUpiVpa,
  deleteUpiVpa,
  getPlans,
  savePlan,
  togglePlan,
  deletePlan,
  updateMerchantPlan,
  getBlacklist,
  addBlacklistIp,
  removeBlacklistIp,
  getSettings,
  updateSettings,
  testTelegramAlert,
  getPayouts,
  settlePayout
};
