const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thuruvan-admin-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
delete process.env.NOTIFICATION_SECRET_KEY;
// Exercise migration from the deployed pre-session-version schema.
const old = new DatabaseSync(process.env.DATABASE_PATH);
old.exec('CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT, created_at TEXT)');
old.close();
const db = require('../src/db');
const admin = require('../src/controllers/adminController');
const auth = require('../src/controllers/authController');
const config = require('../src/security/config');
const email = 'operator@example.test';
let password = crypto.randomBytes(24).toString('hex');
function response() { return { code: 200, body: null, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } }; }
function allowed(middleware, token) { const res = response(); let passed = false; middleware({ headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; }); return { passed, res }; }
function provision(pwd) { return spawnSync(process.execPath, ['scripts/provision-admin.js'], { cwd: path.resolve(__dirname, '..'), env: process.env, input: JSON.stringify({ email, password: pwd }), encoding: 'utf8' }); }
test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('database migration is additive and does not seed an admin', () => {
  assert.equal(db.prepare('SELECT count(*) AS n FROM admins').get().n, 0);
  assert.ok(db.prepare('PRAGMA table_info(admins)').all().some(c => c.name === 'auth_version'));
});
test('runtime rejects absent, short and previously published signing secrets', () => {
  const saved = process.env.JWT_SECRET;
  for (const value of ['', 'short', 'your_jwt_secret_key_change_in_production']) {
    process.env.JWT_SECRET = value;
    assert.throws(config.getJwtSecret);
  }
  process.env.JWT_SECRET = saved;
  assert.equal(config.getJwtSecret(), saved);
  assert.equal(config.getSecret('NOTIFICATION_SECRET_KEY', { optional: true }), null);
});
test('stdin provisioning creates an admin without exposing its password', () => {
  const result = provision(password);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(password));
  assert.ok(!result.stderr.includes(password));
  const row = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  assert.ok(bcrypt.compareSync(password, row.password_hash));
});
test('admin sessions require a current database row, role and session version', async () => {
  const res = response(); await admin.login({ body: { email, password } }, res);
  assert.equal(res.code, 200); assert.ok(allowed(admin.adminMiddleware, res.body.token).passed);
  const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
  for (const payload of [{ id: claims.id, isAdmin: true }, { id: claims.id, isAdmin: false, authVersion: 0 }, { id: 9999, isAdmin: true, authVersion: 0 }, { id: claims.id, isAdmin: true, authVersion: 99 }]) {
    assert.equal(allowed(admin.adminMiddleware, jwt.sign(payload, process.env.JWT_SECRET)).passed, false);
  }
  assert.equal(allowed(auth.authMiddleware, res.body.token).passed, false);
});
test('password reset revokes previously issued admin tokens', async () => {
  const before = response(); await admin.login({ body: { email, password } }, before);
  const next = crypto.randomBytes(24).toString('hex');
  const changed = response();
  await admin.changePassword({ body: { current_password: password, new_password: next }, admin: jwt.verify(before.body.token, process.env.JWT_SECRET) }, changed);
  assert.equal(changed.code, 200); assert.equal(allowed(admin.adminMiddleware, before.body.token).passed, false);
  password = next;
  const after = response(); await admin.login({ body: { email, password } }, after);
  assert.ok(allowed(admin.adminMiddleware, after.body.token).passed);
  assert.equal(provision(crypto.randomBytes(24).toString('hex')).status, 0);
  assert.equal(allowed(admin.adminMiddleware, after.body.token).passed, false);
});
test('legacy default password is denied even when the old hash remains', async () => {
  const legacy = ['Admin', '@', '123'].join('');
  db.prepare('UPDATE admins SET password_hash = ? WHERE email = ?').run(bcrypt.hashSync(legacy, 4), email);
  const res = response(); await admin.login({ body: { email, password: legacy } }, res);
  assert.equal(res.code, 401); assert.equal(res.body.token, undefined);
});
test('merchant sessions reject deleted/suspended users and accept an active user', () => {
  const result = db.prepare("INSERT INTO merchants(name,email,password_hash,api_key,api_secret,is_active) VALUES ('Test','merchant@example.test','unused','test-key','test-secret',1)").run();
  const id = Number(result.lastInsertRowid), token = jwt.sign({ id, email: 'merchant@example.test' }, process.env.JWT_SECRET);
  assert.equal(allowed(auth.authMiddleware, token).passed, true);
  assert.equal(allowed(admin.adminMiddleware, token).passed, false);
  db.prepare('UPDATE merchants SET is_active = 0 WHERE id = ?').run(id);
  assert.equal(allowed(auth.authMiddleware, token).passed, false);
});
test('admin page has no credential defaults and provisioning rejects weak passwords', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin-login.html'), 'utf8');
  assert.ok(!/id="admin-(?:email|password)"[^>]*value="[^"]+"/.test(html));
  assert.ok(!html.includes(['Admin', '@', '123'].join('')));
  assert.notEqual(provision('short').status, 0);
});
