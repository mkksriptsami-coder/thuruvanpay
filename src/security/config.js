const crypto = require('node:crypto');

// Fingerprints of previously published credentials. Never accept them again.
const exposedSecrets = new Set(["34f72e005cd287050e69367fbfc1f56e3241139420f2411627fc56a3c443a200", "b96dcb3e6bfef7f5ec521563a2b74e7241088995514e747190cbfcab970704ea", "d87a4ac6ea2e7424ce7862e43854208e95d1ac71717eb902b2d3219d58fa795f", "f1d181316cef8a04ecb30b71bd09ae87b3cdd82f1107ccc838a94b12fc90f1b0", "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b", "2a9bf1d3624f75e0b22e0a343e641822584f047664fe8f6fb7cef9e55ff8c9b8"]);
const exposedAdminPassword = "e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7";
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');

function getSecret(name, { optional = false } = {}) {
  const value = process.env[name];
  if (optional && !value) return null;
  if (typeof value !== 'string' || value.trim().length < 32 || exposedSecrets.has(fingerprint(value))) {
    throw new Error(`${name} must be a new, private random secret of at least 32 characters.`);
  }
  return value;
}
function getJwtSecret() { return getSecret('JWT_SECRET'); }
function isExposedAdminPassword(value) {
  return typeof value === 'string' && fingerprint(value) === exposedAdminPassword;
}
function validAdminPassword(value) {
  return typeof value === 'string' && value.length >= 14 && Buffer.byteLength(value, 'utf8') <= 72 && !isExposedAdminPassword(value);
}
function validateRuntimeSecrets() {
  getJwtSecret();
  getSecret('NOTIFICATION_SECRET_KEY', { optional: true });
}
module.exports = { getSecret, getJwtSecret, isExposedAdminPassword, validAdminPassword, validateRuntimeSecrets };
