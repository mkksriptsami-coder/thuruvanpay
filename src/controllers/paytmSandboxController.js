'use strict';
const db = require('../db');
const paytm = require('../services/paytmSandbox');
function guard(req, res, next) {
  try {
    req.paytmSandboxConfig = paytm.configuration();
    if (!req.paytmSandboxConfig) return res.status(503).json({ status: false, code: 'SANDBOX_DISABLED' });
    return next();
  } catch {
    return res.status(503).json({ status: false, code: 'SANDBOX_CONFIG_INVALID' });
  }
}
async function initiate(req, res) {
  try {
    const order = await paytm.initiate(db, req.admin.id, req.body?.amount, req.paytmSandboxConfig);
    return res.status(200).json({ status: true, order });
  } catch (err) {
    if (err instanceof RangeError) return res.status(400).json({ status: false, message: err.message });
    return res.status(502).json({ status: false, message: 'Paytm STAGING initiation unavailable; no live money or wallet changes' });
  }
}
async function status(req, res) {
  try {
    const order = await paytm.status(db, req.admin.id, req.params.orderId, req.paytmSandboxConfig);
    if (!order) return res.status(404).json({ status: false, message: 'Sandbox order not found' });
    return res.json({ status: true, order });
  } catch (err) {
    if (err instanceof RangeError) return res.status(400).json({ status: false, message: err.message });
    return res.status(502).json({ status: false, message: 'Cannot verify signed Paytm STAGING status; no money credited' });
  }
}
module.exports = { guard, initiate, status };
