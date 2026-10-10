# Admin access containment — deployment runbook

This patch does not make payment collection ready for production. Payment verification, accounting and merchant isolation still require a separate review/fix. No production credential has been rotated by this pull request.

## Before deployment

1. Back up the existing SQLite database securely and test your restore procedure. Keep production traffic controlled during maintenance.
2. Use Node.js 24 or newer and `npm ci`. Legacy embedded installers are retired; do not deploy old base64/archive snapshots.
3. On the application host, preserve your actual database path, base URL and port in an **untracked** `.env` (permissions 0600). Removing the previously tracked `.env` during checkout can remove that file, so back up host configuration securely before updating. Never restore published secrets.
4. Set a **new, private, random** `JWT_SECRET` with at least 32 characters, generated using your trusted secret manager. Previously published values are rejected. Rotation invalidates existing merchant and admin JWTs. If notification intake is still needed, configure a separate fresh `NOTIFICATION_SECRET_KEY` and coordinate its change with the sender. Leave it empty to disable notification intake. Do not reuse example values or paste secrets into chat or a pull request.
5. Provision/reset the intended admin **against the existing production database**, using the script below. Repeat for each affected admin. No admin is automatically created on startup. The old published default password is denied even if its hash remains in the database.

## Provision/reset an admin without secrets in command arguments

Run from the application checkout, in a private terminal. The Python prompt reads from the terminal; the password is hidden and passes to Node through stdin only. Do not use shell tracing or log stdin.

```bash
python3 -c 'import getpass,json,sys; print("Admin email: ",end="",file=sys.stderr,flush=True); email=input(); password=getpass.getpass("New private admin password (14+ characters): "); print("Admin name: ",end="",file=sys.stderr,flush=True); name=input(); print(json.dumps({"email":email,"password":password,"name":name}))' | node scripts/provision-admin.js
```

New password: at least 14 characters, at most 72 UTF-8 bytes (bcrypt limit). The script updates an existing email or creates a new admin; changing an existing admin increments its session version. Provisioning requires trusted host filesystem access and must not be exposed as an HTTP endpoint.

## Deploy and verify

- Run `npm test` in an isolated checkout. Tests use temporary databases and random test keys, never the production database.
- Validate runtime configuration before replacing the running process:
  `node -e "require('dotenv').config(); require('./src/security/config').validateRuntimeSecrets();"`
- Restart using your existing process manager. Do not run `setup.sh` blindly on an existing nginx installation; it changes host configuration.
- Verify the public admin page has empty credential fields and no credential hints.
- Verify a newly provisioned admin can log in, while the old credential and old sessions cannot.
- Verify an admin token is rejected by merchant endpoints and a merchant token by admin endpoints; a suspended merchant's session must be rejected.
- Change the admin password and confirm all old admin sessions are rejected, then sign in again.
- Review historical admin login and financial changes for unexpected activity. Exposure alone is not proof of compromise.

## History and rollback

Deleting secrets from the current tree does **not** remove them from Git history, forks, cached downloads or past releases. Rotate first; consider coordinated history cleanup separately. This patch deliberately does not rewrite history. Never roll back to the exposed credentials or old embedded installer. Preserve the `auth_version` column during any database rollback and use a new JWT secret when recovering.

## Remaining security work

Admin MFA and login throttling, safe frontend rendering, session storage hardening, verified payment receipts, idempotent accounting, callback destination validation and durable webhook retries remain outstanding. This PR addresses access containment only.
