const axios = require('axios');

async function testGateway() {
  const BASE = 'http://localhost:5000';

  console.log('--- STEP 1: REGISTER MERCHANT ---');
  const regEmail = `test_${Date.now()}@gateway.com`;
  const regRes = await axios.post(`${BASE}/auth/register`, {
    name: 'Mugavai Tech',
    email: regEmail,
    password: 'Password@123',
    upi_vpa: 'mugavaitech@okaxis',
    upi_name: 'Mugavai Tech Store'
  });
  console.log('Registered successfully! ID:', regRes.data.merchant.id);
  const token = regRes.data.token;

  console.log('--- STEP 2: FETCH DASHBOARD DATA & API KEYS ---');
  const dashRes = await axios.get(`${BASE}/auth/dashboard`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const apiKey = dashRes.data.merchant.api_key;
  const apiSecret = dashRes.data.merchant.api_secret;
  console.log('API Key:', apiKey);
  console.log('UPI VPA:', dashRes.data.merchant.upi_vpa);

  console.log('--- STEP 3: CREATE ORDER (LIKE DEVELOPER API) ---');
  const orderRes = await axios.post(`${BASE}/api/create-order`, {
    amount: 199.00,
    customer_name: 'Anbarasan',
    customer_mobile: '9876543210',
    redirect_url: 'https://myshop.com/payment-completed'
  }, {
    headers: {
      'x-api-key': apiKey,
      'x-api-secret': apiSecret
    }
  });

  const orderData = orderRes.data.data;
  console.log('Order Created Successfully!');
  console.log('Order ID:', orderData.order_id);
  console.log('Payment URL:', orderData.payment_url);
  console.log('UPI Intent URI:', orderData.upi_intent);

  console.log('--- STEP 4: CHECK PUBLIC ORDER (CHECKOUT PAGE) ---');
  const pubRes = await axios.get(`${BASE}/api/public-order/${orderData.order_id}`);
  console.log('Public Order Details Status:', pubRes.data.data.status, 'Amount: ₹' + pubRes.data.data.amount);

  console.log('--- STEP 5: VERIFY PAYMENT (SIMULATING UTR SUBMIT / AUTO-VERIFICATION) ---');
  const utrRes = await axios.post(`${BASE}/api/pay/verify-utr`, {
    order_id: orderData.order_id,
    utr: '428910284719'
  });
  console.log('UTR Verification Result:', utrRes.data.message);

  console.log('--- STEP 6: CHECK FINAL ORDER STATUS ---');
  const statusRes = await axios.post(`${BASE}/api/check-order-status`, {
    order_id: orderData.order_id
  }, {
    headers: {
      'x-api-key': apiKey,
      'x-api-secret': apiSecret
    }
  });
  console.log('Final Order Status:', statusRes.data.data.status, 'UTR:', statusRes.data.data.utr);
  console.log('\n✅ ALL 6 STEPS COMPLETED 100% SUCCESSFULLY!');
}

testGateway().catch(err => {
  console.error('Test Failed:', err.response ? err.response.data : err.message);
  process.exit(1);
});
