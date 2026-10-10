'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const paytm = require('../src/services/paytmSandbox');
const key = 'abcdefghijklmnop';
const cfg = { mid: 'STAGINGMID123', key, website: 'WEBSTAGING' };
function paytmResponse(body) { return { ok: true, json: async () => ({ body, head: { signature: paytm.sign(JSON.stringify(body), key) } }) }; }
test('Paytm sandbox is disabled by default and production settings cannot turn it on', () => {
  assert.equal(paytm.configuration({ PAYTM_TEST_MID: cfg.mid, PAYTM_TEST_MERCHANT_KEY: key }), null);
  assert.throws(() => paytm.configuration({ PAYTM_SANDBOX_ENABLED: 'true', PAYTM_TEST_MID: cfg.mid, PAYTM_TEST_MERCHANT_KEY: 'wrong' }));
  assert.equal(paytm.configuration({ PAYTM_SANDBOX_ENABLED: 'true', PAYTM_TEST_MID: cfg.mid, PAYTM_TEST_MERCHANT_KEY: key }).mid, cfg.mid);
});
test('Paytm checksum matches verified hash and rejects tampering', () => {
  const str = '{"mid":"STAGINGMID123","orderId":"ORDER123"}';
  const signed = paytm.sign(str, key, 'QUJD');
  assert.equal(paytm.verify(str, key, signed), true);
  assert.equal(paytm.verify(str.replace('ORDER123','ORDER234'), key, signed), false);
  assert.equal(paytm.verify(str, key, 'faked'), false);
});
test('amount is integer paise; rejects floating point, zeros, overlimit', () => {
  assert.equal(paytm.amountPaise('1.00'), 100);
  assert.equal(paytm.amountPaise('12.3'), 1230);
  assert.equal(paytm.amountPaise('99.99'), 9999);
  for (const bad of [0,1,0.01,'0.01','100.00','1.234','1e2','-1','NaN',{}]) assert.throws(()=>paytm.amountPaise(bad));
});
test('signed staging request verifies Paytm signature and uses POST with HTTPS', async () => {
  const response = { resultInfo: { resultStatus: 'PENDING' }, orderId: 'SBX_123' };
  const spy = async (url, options) => {
    assert.equal(url, 'https://securegw-stage.paytmpayments.in/v3/order/status');
    assert.equal(options.method, 'POST');
    const sent = JSON.parse(options.body);
    assert.equal(paytm.verify(JSON.stringify(sent.body), key, sent.head.signature), true);
    return paytmResponse(response);
  };
  const r = await paytm.signedRequest('https://securegw-stage.paytmpayments.in/v3/order/status', { mid: cfg.mid, orderId: 'SBX_123' }, cfg, spy);
  assert.equal(r.orderId, 'SBX_123');
});
test('unsigned and tampered staging responses are denied', async () => {
  const bogus = { resultInfo: { resultStatus: 'TXN_SUCCESS' }, txnAmount: '1.00' };
  await assert.rejects(paytm.signedRequest('https://securegw-stage.paytmpayments.in/v3/order/status', {}, cfg, async () => ({ok:true,json:async()=>({body:bogus,head:{signature:'bad'}})})), /signature/);
  const signed = paytmResponse(bogus); const obj = await signed.json(); obj.body.txnAmount = '9.00';
  await assert.rejects(paytm.signedRequest('https://securegw-stage.paytmpayments.in/v3/order/status', {}, cfg, async () => ({ok:true,json:async()=>obj})), /signature/);
});
test('declined staging requests never produce valid token', async () => {
  const declined = { resultInfo: { resultStatus:'F',resultCode:'2005' } };
  const mockdb={ exec(){}, prepare(sql) {
    if(sql.includes('count(*)'))return {get:()=>({n:0})};
    return {run:()=>({})};
  }};
  await assert.rejects(paytm.initiate(mockdb, 1, '1.00', cfg, async()=>paytmResponse(declined)), /did not succeed/);
});
