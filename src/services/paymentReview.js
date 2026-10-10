const db = require('../db');

class ReviewError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function amountInPaise(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}
function validateUtr(utr) {
  if (typeof utr !== 'string' || !/^\d{12}$/.test(utr.trim())) {
    throw new ReviewError(400, 'Enter a 12-digit UPI reference number. This is not proof of payment.');
  }
  return utr.trim();
}
function recordReview({ kind, targetId, merchantId, utr, amountPaise, planName = null, receiverUpi }) {
  const existing = db.prepare('SELECT id FROM payment_review_requests WHERE kind = ? AND target_id = ? AND merchant_id = ? AND utr = ?')
    .get(kind, targetId, merchantId, utr);
  if (existing) return Number(existing.id);
  const count = db.prepare('SELECT count(*) AS n FROM payment_review_requests WHERE kind = ? AND target_id = ? AND merchant_id = ?')
    .get(kind, targetId, merchantId).n;
  if (count >= 3) throw new ReviewError(429, 'Submission limit reached. Contact support with your existing reference.');
  // Unverified claims do not reserve a receipt globally or alter any payment ledger.
  return Number(db.prepare(`INSERT INTO payment_review_requests
    (kind, target_id, merchant_id, utr, amount_paise, plan_name, receiver_upi)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(kind, targetId, merchantId, utr, amountPaise, planName, receiverUpi).lastInsertRowid);
}
function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function submitOrderReview(body = {}) {
  const utr = validateUtr(body.utr);
  if (typeof body.order_id !== 'string' || !body.order_id || body.order_id.length > 200) throw new ReviewError(400, 'Valid order ID required.');
  return transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(body.order_id);
    if (!order) throw new ReviewError(404, 'Order not found.');
    if (order.status !== 'PENDING') throw new ReviewError(409, 'Order is not pending. Contact support for reconciliation; no new credit was applied.');
    const merchant = db.prepare('SELECT id FROM merchants WHERE id = ? AND is_active = 1').get(order.merchant_id);
    if (!merchant) throw new ReviewError(403, 'Merchant account is unavailable.');
    const amountPaise = amountInPaise(order.amount);
    if (!amountPaise) throw new ReviewError(409, 'Stored order amount requires reconciliation.');
    return recordReview({ kind: 'ORDER', targetId: order.order_id, merchantId: order.merchant_id, utr, amountPaise, receiverUpi: order.upi_vpa });
  });
}
function submitSubscriptionReview(merchantId, body = {}) {
  const utr = validateUtr(body.utr);
  if (typeof body.plan_name !== 'string' || !body.plan_name) throw new ReviewError(400, 'Exact plan name required.');
  return transaction(() => {
    const merchant = db.prepare('SELECT id FROM merchants WHERE id = ? AND is_active = 1').get(merchantId);
    if (!merchant) throw new ReviewError(403, 'Merchant account is unavailable.');
    const plans = db.prepare('SELECT * FROM subscription_plans WHERE name = ? AND is_active = 1').all(body.plan_name);
    if (plans.length !== 1) throw new ReviewError(400, 'Select one active, unambiguous plan.');
    const plan = plans[0], amountPaise = amountInPaise(plan.price);
    if (!amountPaise || amountInPaise(body.amount) !== amountPaise) throw new ReviewError(400, 'Amount must match the current server plan price.');
    const receiver = db.prepare("SELECT value FROM system_settings WHERE key = 'subscription_upi_vpa'").get();
    if (!receiver?.value?.trim()) throw new ReviewError(503, 'Subscription receiver is not configured. Contact support.');
    return recordReview({ kind: 'SUBSCRIPTION', targetId: String(plan.id), merchantId, utr, amountPaise, planName: plan.name, receiverUpi: receiver.value.trim() });
  });
}
function respondToReview(res, work) {
  try {
    const id = work();
    return res.status(202).json({ status: false, accepted: true, payment_status: 'PENDING_VERIFICATION', review_id: id,
      message: 'Reference recorded for review. Payment is not verified; no balance credit or plan activation has occurred.' });
  } catch (error) {
    return res.status(error instanceof ReviewError ? error.code : 500).json({ status: false,
      message: error instanceof ReviewError ? error.message : 'Unable to record reference. No payment was approved.' });
  }
}
function verificationUnavailable(res) {
  return res.status(503).json({ status: false, code: 'VERIFICATION_UNAVAILABLE',
    message: 'Payment collection and approval are paused until bank/provider verification is connected. Do not send a new payment.' });
}
module.exports = { amountInPaise, submitOrderReview, submitSubscriptionReview, respondToReview, verificationUnavailable };
