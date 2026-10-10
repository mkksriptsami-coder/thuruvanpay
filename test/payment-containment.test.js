const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const vm = require('node:vm');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thuruvan-payment-'));
process.env.DATABASE_PATH = path.join(dir, 'fixture.db');
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.NOTIFICATION_SECRET_KEY = crypto.randomBytes(48).toString('hex');
let webhookCalls = 0;
const hook = require.resolve('../src/utils/webhookDispatcher');
require.cache[hook] = { id: hook, filename: hook, loaded: true, exports: { sendWebhook: () => { webhookCalls++; } } };
const db = require('../src/db');
const { amountInPaise } = require('../src/services/paymentReview');
const app = express(); app.use(express.json());
app.use('/api', require('../src/routes/api'));
app.use('/auth', require('../src/routes/auth'));
app.use('/admin-api', require('../src/routes/admin'));
let server, base, merchantId, merchantToken, adminToken;
const state = () => ({
  orders: db.prepare('SELECT order_id,status,utr,completed_at FROM orders ORDER BY order_id').all(),
  merchants: db.prepare('SELECT id,balance,plan FROM merchants ORDER BY id').all(),
  subscriptions: db.prepare('SELECT * FROM subscription_orders').all()
});
function addOrder(id, status = 'PENDING') { db.prepare('INSERT INTO orders(order_id,merchant_id,amount,upi_vpa,status) VALUES (?,?,25,?,?)').run(id, merchantId, 'fixture@invalid', status); }
async function request(route, body, token, headers = {}, method = 'POST') {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  return { code: response.status, body: await response.json() };
}
test.before(async () => {
  merchantId = Number(db.prepare("INSERT INTO merchants(name,email,password_hash,api_key,api_secret,plan) VALUES ('Fixture','fixture@example.test','unused','fixture-key','fixture-secret','STARTER')").run().lastInsertRowid);
  db.prepare("INSERT INTO admins(email,password_hash,auth_version) VALUES ('admin@example.test','unused',0)").run();
  merchantToken = jwt.sign({ id: merchantId }, process.env.JWT_SECRET);
  adminToken = jwt.sign({ id: 1, isAdmin: true, authVersion: 0 }, process.env.JWT_SECRET);
  addOrder('pending'); addOrder('completed', 'SUCCESS'); addOrder('failed', 'FAILED'); addOrder('limited'); addOrder('rollback');
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('unverified UTR queues review without success, money, plan or webhook', async () => {
  const before = state();
  const result = await request('/api/pay/verify-utr', { order_id: 'pending', utr: '123456789012' });
  assert.equal(result.code, 202); assert.equal(result.body.status, false); // Safe for cached legacy clients.
  assert.equal(result.body.accepted, true); assert.equal(result.body.payment_status, 'PENDING_VERIFICATION');
  assert.deepEqual(state(), before); assert.equal(webhookCalls, 0);
  const review = db.prepare('SELECT * FROM payment_review_requests WHERE id=?').get(result.body.review_id);
  assert.equal(review.amount_paise, 2500); assert.equal(review.receiver_upi, 'fixture@invalid');
});
test('concurrent identical retries produce one pending review and zero credits', async () => {
  const before = state();
  const results = await Promise.all(Array.from({ length: 12 }, () => request('/api/pay/verify-utr', { order_id: 'pending', utr: '123456789012' })));
  assert.ok(results.every(r => r.code === 202)); assert.equal(new Set(results.map(r => r.body.review_id)).size, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM payment_review_requests WHERE target_id='pending'").get().n, 1);
  assert.deepEqual(state(), before);
});
test('invalid, unknown and terminal orders cannot be approved or credited', async () => {
  const before = state();
  for (const utr of ['not-a-utr!!', '123', 123456789012, {}, null]) {
    assert.equal((await request('/api/pay/verify-utr', { order_id: 'pending', utr })).code, 400);
  }
  assert.equal((await request('/api/pay/verify-utr', { order_id: 'missing', utr: '123456789013' })).code, 404);
  for (const order_id of ['completed', 'failed']) assert.equal((await request('/api/pay/verify-utr', { order_id, utr: '123456789013' })).code, 409);
  assert.deepEqual(state(), before);
});
test('claim limit is atomic and existing retries remain idempotent', async () => {
  for (const utr of ['111111111111', '222222222222', '333333333333']) assert.equal((await request('/api/pay/verify-utr', { order_id: 'limited', utr })).code, 202);
  assert.equal((await request('/api/pay/verify-utr', { order_id: 'limited', utr: '444444444444' })).code, 429);
  assert.equal((await request('/api/pay/verify-utr', { order_id: 'limited', utr: '111111111111' })).code, 202);
});
test('failed review insert rolls back without altering accounting', async () => {
  const before = state();
  db.exec("CREATE TRIGGER audit_abort BEFORE INSERT ON payment_review_requests WHEN NEW.target_id='rollback' BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  const result = await request('/api/pay/verify-utr', { order_id: 'rollback', utr: '123456789015' });
  assert.equal(result.code, 500); assert.deepEqual(state(), before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM payment_review_requests WHERE target_id='rollback'").get().n, 0);
  db.exec('DROP TRIGGER audit_abort');
  assert.equal((await request('/api/pay/verify-utr', { order_id: 'rollback', utr: '123456789015' })).code, 202);
});
test('admin force verification stays blocked on pending and successful orders', async () => {
  const before = state();
  for (const id of ['pending', 'completed', 'completed']) {
    assert.equal((await request(`/admin-api/orders/${id}/verify`, { utr: '123456789012' }, adminToken)).code, 503);
  }
  assert.deepEqual(state(), before); assert.equal(webhookCalls, 0);
});
test('even authenticated notification cannot replace bank proof', async () => {
  const before = state();
  for (const body of [{ amount: 25, utr: '123456789012' }, { order_id: 'pending', amount: 1, utr: '123456789012' }]) {
    assert.equal((await request('/api/webhook/notify', body, null, { 'x-notify-secret': process.env.NOTIFICATION_SECRET_KEY })).code, 503);
  }
  assert.equal((await request('/api/webhook/notify', { amount: 25 }, null, { 'x-notify-secret': 'invalid' })).code, 403);
  assert.deepEqual(state(), before); assert.equal(webhookCalls, 0);
});
test('new collections are paused and legacy public checkout exposes no payment QR or intent', async () => {
  assert.equal((await request('/api/create-order', { amount: 25 }, null, { 'x-api-key': 'fixture-key', 'x-api-secret': 'fixture-secret' })).code, 503);
  const result = await request('/api/public-order/pending', null, null, {}, 'GET');
  assert.equal(result.code, 200); assert.equal(result.body.data.verification_available, false);
  assert.equal(result.body.data.qr_code, undefined); assert.equal(result.body.data.upi_intent, undefined);
});
test('subscription price/name tampering cannot activate or create an approved subscription', async () => {
  const before = state();
  for (const body of [
    { plan_name: 'Enterprise Unlimited', amount: 1, utr: '123456789012' },
    { plan_name: 'Enterprise', amount: 1999, utr: '123456789012' },
    { plan_name: 'Enterprise Unlimited', amount: '1999junk', utr: '123456789012' },
    { plan_name: '%', amount: 1999, utr: '123456789012' }
  ]) assert.equal((await request('/auth/submit-subscription-payment', body, merchantToken)).code, 400);
  assert.deepEqual(state(), before);
});
test('correct-price subscription is pending only and retries do not activate plans', async () => {
  const before = state(), body = { plan_name: 'Enterprise Unlimited', amount: 1999, utr: '123456789019' };
  const first = await request('/auth/submit-subscription-payment', body, merchantToken);
  const next = await request('/auth/submit-subscription-payment', body, merchantToken);
  assert.equal(first.code, 202); assert.equal(first.body.status, false); assert.equal(first.body.payment_status, 'PENDING_VERIFICATION');
  assert.equal(first.body.review_id, next.body.review_id); assert.deepEqual(state(), before);
  const row = db.prepare('SELECT * FROM payment_review_requests WHERE id=?').get(first.body.review_id);
  assert.equal(row.amount_paise, 199900); assert.equal(row.plan_name, 'Enterprise Unlimited');
});
test('direct self-service plan activation is forbidden', async () => {
  const before = state(); assert.equal((await request('/auth/change-plan', { plan: 'ENTERPRISE' }, merchantToken)).code, 403); assert.deepEqual(state(), before);
});
test('review queue requires admin permission and subscription intake requires merchant permission', async () => {
  assert.equal((await request('/admin-api/payment-reviews', null, null, {}, 'GET')).code, 401);
  assert.equal((await request('/admin-api/payment-reviews', null, merchantToken, {}, 'GET')).code, 403);
  assert.equal((await request('/admin-api/payment-reviews', null, adminToken, {}, 'GET')).code, 200);
  assert.equal((await request('/auth/submit-subscription-payment', {}, null)).code, 401);
});
test('status polling with no request body works and partial credentials fail closed', async () => {
  assert.equal((await request('/api/order-status/pending', null, null, {}, 'GET')).code, 200);
  assert.equal((await request('/api/order-status/pending', null, null, { 'x-api-key': 'fixture-key' }, 'GET')).code, 401);
});
test('amount parser rejects non-finite, excess precision and non-number types', () => {
  assert.equal(amountInPaise('25.10'), 2510);
  for (const input of [Infinity, NaN, '1e3', '25oops', '-1', '0', '1.001', {}, [], true, '9007199254740992']) assert.equal(amountInPaise(input), null);
});
test('checkout pending response never produces success UI, redirects or timers', async () => {
  const nodes = new Map(); const node = id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', disabled: false, value: '', classList: { toggle() {} } }); return nodes.get(id); };
  let responses = 0;
  const context = { URLSearchParams, window: { location: { search: '?order_id=pending' } }, document: { getElementById: node }, fetch: async () => ({ ok: true, status: responses++ ? 202 : 200, json: async () => responses === 1 ? { status: true, data: { order_id: 'pending', amount: 25, status: 'PENDING', verification_available: false } } : { status: false, accepted: true, payment_status: 'PENDING_VERIFICATION', review_id: 42 } }) };
  vm.createContext(context);
  const html = fs.readFileSync(path.join(__dirname, '../public/checkout.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(script.replace('    loadOrder();', ''), context);
  await vm.runInContext('loadOrder()', context); node('utr-input').value = '123456789012';
  await vm.runInContext('submitUtr()', context);
  assert.match(node('utr-msg').textContent, /verification pending/);
  assert.equal(context.window.location.search, '?order_id=pending');
  assert.equal(html.includes('Payment Successful!'), false);
  assert.equal(script.includes('setInterval'), false);
});
