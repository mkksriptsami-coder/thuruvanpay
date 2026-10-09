const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');

async function sendWebhook(orderId) {
  try {
    const orderStmt = db.prepare(`
      SELECT o.*, m.api_secret, m.webhook_url as merchant_default_webhook 
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.order_id = ?
    `);
    const order = orderStmt.get(orderId);

    if (!order) return;

    const targetUrl = order.webhook_url || order.merchant_default_webhook;
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return; // No valid webhook URL configured
    }

    const payload = {
      event: 'order.payment_completed',
      status: 'SUCCESS',
      order_id: order.order_id,
      amount: order.amount,
      utr: order.utr || null,
      payment_app: order.payment_app || 'UPI',
      customer_name: order.customer_name,
      customer_mobile: order.customer_mobile,
      completed_at: order.completed_at || new Date().toISOString()
    };

    const payloadStr = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', order.api_secret)
      .update(payloadStr)
      .digest('hex');

    let responseStatus = 0;
    let responseBody = '';

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Signature': signature,
          'User-Agent': 'UPIGateway-Webhook/1.0'
        },
        timeout: 10000
      });
      responseStatus = response.status;
      responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } catch (err) {
      responseStatus = err.response ? err.response.status : 500;
      responseBody = err.message || 'Webhook network delivery failure';
    }

    const logStmt = db.prepare(`
      INSERT INTO webhook_logs (order_id, url, payload, response_status, response_body)
      VALUES (?, ?, ?, ?, ?)
    `);
    logStmt.run(order.order_id, targetUrl, payloadStr, responseStatus, responseBody.slice(0, 1000));
  } catch (error) {
    console.error(`[Webhook Dispatcher Error for ${orderId}]:`, error);
  }
}

module.exports = { sendWebhook };
