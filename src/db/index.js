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

    CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
  `);

  // Seed default admin if not exists
  const bcrypt = require('bcryptjs');
  const adminCheck = db.prepare("SELECT id FROM admins WHERE email = 'admin@thuruvanpay.in'").get();
  if (!adminCheck) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('Admin@123', salt);
    db.prepare("INSERT INTO admins (email, password_hash, name) VALUES ('admin@thuruvanpay.in', ?, 'Master Administrator')").run(hash);
  }
}

initDatabase();

module.exports = db;
