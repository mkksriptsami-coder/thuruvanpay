const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH 
  ? path.resolve(__dirname, '../../', process.env.DATABASE_PATH)
  : path.join(dataDir, 'gateway.db');

const db = new DatabaseSync(dbPath);

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      api_key TEXT UNIQUE NOT NULL,
      api_secret TEXT NOT NULL,
      upi_vpa TEXT DEFAULT 'example@upi',
      upi_name TEXT DEFAULT 'Merchant Pay',
      webhook_url TEXT DEFAULT '',
      balance REAL DEFAULT 0.0,
      plan TEXT DEFAULT 'PRO',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      customer_name TEXT,
      customer_mobile TEXT,
      customer_email TEXT,
      redirect_url TEXT,
      webhook_url TEXT,
      upi_vpa TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      utr TEXT,
      payment_app TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      completed_at TEXT,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      url TEXT NOT NULL,
      payload TEXT,
      response_status INTEGER,
      response_body TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT 'Super Admin',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS upi_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vpa TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      daily_limit REAL DEFAULT 100000.0,
      today_volume REAL DEFAULT 0.0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      validity_days INTEGER NOT NULL,
      transaction_limit INTEGER DEFAULT -1,
      features TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS security_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      blocked_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS payout_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      bank_account TEXT NOT NULL,
      ifsc TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      utr TEXT,
      requested_at TEXT DEFAULT (datetime('now', 'localtime')),
      processed_at TEXT,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS subscription_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      plan_name TEXT NOT NULL,
      amount REAL NOT NULL,
      validity_days INTEGER NOT NULL,
      receiver_upi TEXT NOT NULL,
      utr TEXT NOT NULL,
      status TEXT DEFAULT 'APPROVED',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      approved_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS payment_review_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('ORDER', 'SUBSCRIPTION')),
      target_id TEXT NOT NULL,
      merchant_id INTEGER NOT NULL,
      utr TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      plan_name TEXT,
      receiver_upi TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status = 'PENDING_VERIFICATION'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, target_id, merchant_id, utr),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_sub_orders_utr ON subscription_orders(utr);
  `);

  // Existing databases gain session revocation support; no admin is auto-created.
  const adminColumns = db.prepare('PRAGMA table_info(admins)').all();
  if (!adminColumns.some(column => column.name === 'auth_version')) {
    db.exec('ALTER TABLE admins ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
  }

  // Seed default plans if not exists
  const planCheck = db.prepare("SELECT count(*) as count FROM subscription_plans").get();
  if (planCheck.count === 0) {
    db.exec(`
      INSERT INTO subscription_plans (name, price, validity_days, features) VALUES 
      ('Starter Gateway', 299, 30, '0% Fee, Dynamic QR, Standard Webhooks'),
      ('Pro Business Plan', 799, 90, '0% Fee, Dynamic QR, High-Speed Webhooks, Priority UTR'),
      ('Enterprise Unlimited', 1999, 365, 'Unlimited Transactions, Dedicated VPA Pool, 24/7 SLA');
    `);
  }

  // Seed default settings if not exists
  const settingCheck = db.prepare("SELECT count(*) as count FROM system_settings").get();
  if (settingCheck.count === 0) {
    db.exec(`
      INSERT INTO system_settings (key, value) VALUES
      ('telegram_bot_token', ''),
      ('telegram_chat_id', ''),
      ('alert_min_amount', '500'),
      ('notify_on_signup', 'true'),
      ('notify_on_payment', 'true'),
      ('max_utr_attempts', '3');
    `);
  }

  db.exec(`
    INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('subscription_upi_vpa', 'thuruvanpay@okaxis'),
    ('subscription_upi_name', 'ThuruvanPay Official');
  `);
}

initDatabase();

module.exports = db;
