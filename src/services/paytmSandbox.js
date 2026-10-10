'use strict';
// Paytm STAGING ONLY. Never writes production orders, balances or subscriptions.
const crypto = require('node:crypto');
const IV = Buffer.from('@@@@&&&&####$$$$', 'utf8');
const INIT_HOST = 'https://securestage.paytmpayments.com';
const STATUS_ENDPOINT = 'https://securegw-stage.paytmpayments.in/v3/order/status';
const CHECKOUT_HOST = 'https://securegw-stage.paytm.in';

function configuration(env = process.env) {
  if (env.PAYTM_SANDBOX_ENABLED !== 'true') return null;
  const mid = env.PAYTM_TEST_MID || '';
  const key = env.PAYTM_TEST_MERCHANT_KEY || '';
  const website = env.PAYTM_TEST_WEBSITE || 'WEBSTAGING';
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(mid) || Buffer.byteLength(key, 'utf8') !== 16 ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(website)) {
    throw new Error('Paytm sandbox configuration incomplete/invalid');
  }
  return { mid, key, website };
}
function amountPaise(input) {
  if (typeof input !== 'string' || !/^(?:[1-9]|[1-9][0-9])(?:\.[0-9]{1,2})?$/.test(input)) {
    throw new RangeError('Provide an amount string from 1.00 to 99.99 INR');
  }
  const [whole, fraction = ''] = input.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function money(paise) { return (paise / 100).toFixed(2); }
function sign(payloadText, key, salt = crypto.randomBytes(3).toString('base64')) {
  if (typeof payloadText !== 'string' || !/^[A-Za-z0-9+/]{4}$/.test(salt)) throw new Error('Invalid checksum input');
  const hash = crypto.createHash('sha256').update(payloadText + '|' + salt, 'utf8').digest('hex') + salt;
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), IV);
  return cipher.update(hash, 'utf8', 'base64') + cipher.final('base64');
}
function verify(payloadText, key, signature) {
  if (typeof payloadText !== 'string' || typeof signature !== 'string' ||
      !/^[A-Za-z0-9+/=]{80,160}$/.test(signature)) return false;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), IV);
    const decoded = decipher.update(signature, 'base64', 'utf8') + decipher.final('utf8');
    if (!/^[a-f0-9]{64}[A-Za-z0-9+/]{4}$/.test(decoded)) return false;
    const hash = crypto.createHash('sha256').update(payloadText + '|' + decoded.slice(64), 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(decoded.slice(0, 64), 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS paytm_sandbox_orders (
    order_id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
    state TEXT NOT NULL DEFAULT 'CREATED', paytm_txn_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), checked_at TEXT
  )`);
}
async function signedRequest(url, body, cfg, fetchImpl = fetch) {
  const payload = JSON.stringify(body);
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, head: { signature: sign(payload, cfg.key) } }),
    redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Paytm staging HTTP failure');
  const json = await response.json();
  if (!json || !json.body || !json.head ||
      !verify(JSON.stringify(json.body), cfg.key, json.head.signature)) {
    throw new Error('Invalid Paytm staging response signature');
  }
  return json.body;
}
async function initiate(db, adminId, input, cfg, fetchImpl = fetch) {
  const paise = amountPaise(input);
  ensureTables(db);
  const used = db.prepare("SELECT count(*) AS n FROM paytm_sandbox_orders WHERE admin_id=? AND created_at >= datetime('now','-1 hour')").get(adminId);
  if (used.n >= 8) throw new RangeError('Sandbox limit: 8 attempts per hour');
  const orderId = 'SBX_' + crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO paytm_sandbox_orders(order_id,admin_id,amount_paise) VALUES (?,?,?)').run(orderId, adminId, paise);
  const body = {
    requestType: 'Payment', mid: cfg.mid, websiteName: cfg.website, orderId,
    txnAmount: { value: money(paise), currency: 'INR' },
    userInfo: { custId: 'THURUVAN_SANDBOX_ADMIN_' + adminId }
  };
  const url = INIT_HOST + '/theia/api/v1/initiateTransaction?mid=' + encodeURIComponent(cfg.mid) +
    '&orderId=' + encodeURIComponent(orderId);
  const reply = await signedRequest(url, body, cfg, fetchImpl);
  if (reply.resultInfo?.resultStatus !== 'S' || !['0000','0002'].includes(reply.resultInfo?.resultCode) ||
      typeof reply.txnToken !== 'string' || reply.txnToken.length < 8) {
    throw new Error('Paytm staging initiation did not succeed');
  }
  db.prepare("UPDATE paytm_sandbox_orders SET state='INITIATED' WHERE order_id=?").run(orderId);
  return {
    order_id: orderId, amount: money(paise), mid: cfg.mid, txn_token: reply.txnToken,
    checkout_script: CHECKOUT_HOST + '/merchantpgpui/checkoutjs/merchants/' + cfg.mid + '.js',
    environment: 'STAGING_ONLY'
  };
}
async function status(db, adminId, orderId, cfg, fetchImpl = fetch) {
  if (typeof orderId !== 'string' || !/^SBX_[a-f0-9]{24}$/.test(orderId)) throw new RangeError('Invalid sandbox order ID');
  ensureTables(db);
  const row = db.prepare('SELECT * FROM paytm_sandbox_orders WHERE order_id=? AND admin_id=?').get(orderId, adminId);
  if (!row) return null;
  if (row.state === 'CREATED') return { order_id: orderId, state: 'AWAITING_INITIATION', credited: false };
  const body = await signedRequest(STATUS_ENDPOINT, { mid: cfg.mid, orderId }, cfg, fetchImpl);
  const result = body.resultInfo?.resultStatus;
  const isSuccess = result === 'TXN_SUCCESS' && body.resultInfo?.resultCode === '01';
  if (isSuccess) {
    if (body.orderId !== orderId || body.mid !== cfg.mid ||
        typeof body.txnAmount !== 'string' || !/^\d+\.\d{2}$/.test(body.txnAmount) ||
        Number(body.txnAmount.replace('.', '')) !== row.amount_paise ||
        typeof body.txnId !== 'string' || !/^[A-Za-z0-9_-]{5,100}$/.test(body.txnId)) {
      throw new Error('Paytm staging receipt does not match order, MID or exact amount');
    }
    if (row.paytm_txn_id && row.paytm_txn_id !== body.txnId) throw new Error('Conflicting Paytm staging receipt');
    db.prepare("UPDATE paytm_sandbox_orders SET state='VERIFIED_TEST', paytm_txn_id=?, checked_at=datetime('now') WHERE order_id=? AND admin_id=?").run(body.txnId, orderId, adminId);
    return { order_id: orderId, state: 'VERIFIED_TEST', credited: false };
  }
  if (row.state === 'VERIFIED_TEST') return { order_id: orderId, state: 'VERIFIED_TEST', credited: false };
  const state = result === 'TXN_FAILURE' ? 'TEST_FAILED' : 'PENDING_TEST';
  db.prepare("UPDATE paytm_sandbox_orders SET state=?, checked_at=datetime('now') WHERE order_id=? AND admin_id=?").run(state, orderId, adminId);
  return { order_id: orderId, state, credited: false };
}
module.exports = { configuration, amountPaise, money, sign, verify, signedRequest, initiate, status };
