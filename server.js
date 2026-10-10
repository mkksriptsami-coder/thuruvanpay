require('dotenv').config();
require('./src/security/config').validateRuntimeSecrets();
const express = require('express');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);
app.use('/auth', authRoutes);
app.use('/admin-api', adminRoutes);

// Friendly URL: /pay/:orderId -> /checkout.html?order_id=:orderId
app.get('/pay/:orderId', (req, res) => {
  res.redirect(`/checkout.html?order_id=${req.params.orderId}`);
});

// Friendly URL: /docs -> /api-docs.html
app.get('/docs', (req, res) => {
  res.redirect('/api-docs.html');
});

// Friendly URL: /admin -> /admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// 404 fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 UPI Payment Gateway is running on port ${PORT}`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api-docs.html`);
  console.log(`💼 Merchant Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`👑 Admin Panel: http://localhost:${PORT}/admin-login.html`);
  console.log(`===============================================`);
});
