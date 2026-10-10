// Run locally on the application host. JSON is read from stdin, never argv.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { validAdminPassword } = require('../src/security/config');

async function main() {
  if (process.stdin.isTTY) throw new Error('Provide one JSON object on stdin; see ADMIN_SECURITY_RUNBOOK.md.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 16384) throw new Error('Input is too large.');
  }
  const { email, password, name = 'Administrator' } = JSON.parse(input);
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof name !== 'string' || name.length > 100 || !validAdminPassword(password)) {
    throw new Error('Valid email/name and a private password of 14+ characters (max 72 UTF-8 bytes) are required.');
  }
  const hash = await bcrypt.hash(password, 12);
  const db = require('../src/db');
  try {
    db.prepare(`INSERT INTO admins (email, password_hash, name, auth_version) VALUES (?, ?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash,
      name = excluded.name, auth_version = admins.auth_version + 1`)
      .run(email.trim().toLowerCase(), hash, name.trim());
    console.log('Admin provisioned. Previous sessions for this admin are revoked.');
  } finally { db.close(); }
}
main().catch(() => {
  console.error('Admin provisioning failed. Check the input and database path; no credentials are printed.');
  process.exitCode = 1;
});
