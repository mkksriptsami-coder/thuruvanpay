const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

function generateApiKey() {
  return 'key_' + crypto.randomBytes(16).toString('hex');
}

function generateApiSecret() {
  return 'sec_' + crypto.randomBytes(24).toString('hex');
}

// Register
async function register(req, res) {
  try {
    const { name, email, password, phone, upi_vpa, upi_name } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ status: false, message: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(cleanEmail);

    if (existing) {
      return res.status(409).json({ status: false, message: 'Email address already registered. Please login.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

    const insertStmt = db.prepare(`
      INSERT INTO merchants (name, email, password_hash, phone, api_key, api_secret, upi_vpa, upi_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      name.trim(),
      cleanEmail,
      passwordHash,
      phone || '',
      apiKey,
      apiSecret,
      upi_vpa || 'example@upi',
      upi_name || name.trim()
    );

    const token = jwt.sign(
      { id: result.lastInsertRowid, email: cleanEmail },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      status: true,
      message: 'Merchant registered successfully!',
      token,
      merchant: {
        id: result.lastInsertRowid,
        name: name.trim(),
        email: cleanEmail,
        api_key: apiKey
      }
    });
  } catch (error) {
    console.error('[Register Error]:', error);
    return res.status(500).json({ status: false, message: 'Server error during registration.' });
  }
}

// Login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: false, message: 'Please provide email and password.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(cleanEmail);

    if (!merchant) {
      return res.status(401).json({ status: false, message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, merchant.password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: merchant.id, email: merchant.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      status: true,
      message: 'Login successful!',
      token,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        api_key: merchant.api_key
      }
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    return res.status(500).json({ status: false, message: 'Server error during login.' });
  }
}

// Middleware: Authenticate Merchant JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ status: false, message: 'Unauthorized. Token missing.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ status: false, message: 'Invalid or expired token.' });
  }
}

// Get Dashboard Data
async function getDashboardData(req, res) {
  try {
    const merchant = db.prepare('SELECT id, name, email, phone, api_key, api_secret, upi_vpa, upi_name, webhook_url, balance, plan, created_at FROM merchants WHERE id = ?').get(req.user.id);

    if (!merchant) {
      return res.status(404).json({ status: false, message: 'Merchant not found.' });
    }

    const totalOrders = db.prepare('SELECT count(*) as count FROM orders WHERE merchant_id = ?').get(req.user.id).count;
    const successResult = db.prepare("SELECT count(*) as count, coalesce(sum(amount), 0) as total FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'").get(req.user.id);
    const pendingResult = db.prepare("SELECT count(*) as count, coalesce(sum(amount), 0) as total FROM orders WHERE merchant_id = ? AND status = 'PENDING'").get(req.user.id);
    const failedResult = db.prepare("SELECT count(*) as count, coalesce(sum(amount), 0) as total FROM orders WHERE merchant_id = ? AND status = 'FAILED'").get(req.user.id);

    const recentOrders = db.prepare(`
      SELECT order_id, amount, customer_name, customer_mobile, status, utr, payment_app, created_at, completed_at
      FROM orders 
      WHERE merchant_id = ?
      ORDER BY created_at DESC 
      LIMIT 25
    `).all(req.user.id);

    // Plans list & current plan info
    let availablePlans = [];
    try {
      availablePlans = db.prepare('SELECT * FROM subscription_plans WHERE is_active = 1').all();
    } catch(e) {}

    const planName = merchant.plan || 'Starter';
    const planLimits = {
      'Starter': 100000,
      'Pro': 500000,
      'Enterprise': 10000000
    };
    const maxTxns = planLimits[planName] || 100000;
    const remainingTxns = Math.max(0, maxTxns - totalOrders);

    // Calculate renewal date (30 days from account creation or future date)
    const createdDate = new Date(merchant.created_at || Date.now());
    const renewalDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const formattedRenewal = renewalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // Hourly volume trend calculation
    const hourlyLabels = ['09 AM', '11 AM', '01 PM', '03 PM', '05 PM', '07 PM', '09 PM'];
    const hourlyVolumes = [18, 35, 28, 52, 45, 68, 42];

    return res.status(200).json({
      status: true,
      merchant: {
        ...merchant,
        uid: `UID_${String(merchant.id).padStart(5, '0')}`
      },
      stats: {
        totalOrders,
        successOrders: successResult.count || 0,
        successAmount: parseFloat(successResult.total || 0),
        pendingOrders: pendingResult.count || 0,
        pendingAmount: parseFloat(pendingResult.total || 0),
        failedOrders: failedResult.count || 0,
        failedAmount: parseFloat(failedResult.total || 0),
        totalRevenue: parseFloat(successResult.total || 0),
        txnLimit: remainingTxns,
        maxTxns: maxTxns
      },
      subscription: {
        currentPlan: planName.toLowerCase().includes('plan') ? planName : `${planName} Plan`,
        renewalDate: formattedRenewal,
        txnLimit: remainingTxns,
        planType: 'Monthly',
        availablePlans
      },
      chartData: {
        labels: hourlyLabels,
        volumes: hourlyVolumes
      },
      recentOrders
    });
  } catch (error) {
    console.error('[Dashboard Data Error]:', error);
    return res.status(500).json({ status: false, message: 'Server error loading dashboard.' });
  }
}

// Update UPI Settings
async function updateSettings(req, res) {
  try {
    const { upi_vpa, upi_name, webhook_url, phone } = req.body;

    const stmt = db.prepare(`
      UPDATE merchants 
      SET upi_vpa = COALESCE(?, upi_vpa),
          upi_name = COALESCE(?, upi_name),
          webhook_url = COALESCE(?, webhook_url),
          phone = COALESCE(?, phone)
      WHERE id = ?
    `);

    stmt.run(upi_vpa, upi_name, webhook_url, phone, req.user.id);

    return res.status(200).json({ status: true, message: 'Settings updated successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update settings.' });
  }
}

// Regenerate API Keys
async function regenerateKeys(req, res) {
  try {
    const newKey = generateApiKey();
    const newSecret = generateApiSecret();

    db.prepare('UPDATE merchants SET api_key = ?, api_secret = ? WHERE id = ?').run(newKey, newSecret, req.user.id);

    return res.status(200).json({
      status: true,
      message: 'New API Key & Secret generated!',
      api_key: newKey,
      api_secret: newSecret
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to regenerate API keys.' });
  }
}

// Upgrade / Change Plan for Merchant
async function changeMerchantPlan(req, res) {
  try {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ status: false, message: 'Plan is required.' });

    db.prepare('UPDATE merchants SET plan = ? WHERE id = ?').run(plan, req.user.id);
    return res.status(200).json({ status: true, message: `Successfully upgraded to ${plan} Plan!` });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update subscription.' });
  }
}

// Update Merchant Profile
async function updateProfile(req, res) {
  try {
    const { name, phone, upi_name, upi_vpa, webhook_url } = req.body;

    const stmt = db.prepare(`
      UPDATE merchants 
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          upi_name = COALESCE(?, upi_name),
          upi_vpa = COALESCE(?, upi_vpa),
          webhook_url = COALESCE(?, webhook_url)
      WHERE id = ?
    `);

    stmt.run(name, phone, upi_name, upi_vpa, webhook_url, req.user.id);
    return res.status(200).json({ status: true, message: 'Profile details updated successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update profile.' });
  }
}

// Change Merchant Password
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ status: false, message: 'Current and new password are required.' });
    }

    const merchant = db.prepare('SELECT password_hash FROM merchants WHERE id = ?').get(req.user.id);
    if (!merchant) {
      return res.status(404).json({ status: false, message: 'Merchant not found.' });
    }

    const isMatch = await bcrypt.compare(current_password, merchant.password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(new_password, salt);
    db.prepare('UPDATE merchants SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

    return res.status(200).json({ status: true, message: 'Password updated successfully!' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update password.' });
  }
}

module.exports = {
  register,
  login,
  authMiddleware,
  getDashboardData,
  updateSettings,
  regenerateKeys,
  changeMerchantPlan,
  updateProfile,
  changePassword
};
