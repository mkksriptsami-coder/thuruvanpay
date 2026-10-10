# ThuruvanPay status — 2026-10-10

## Current patch: admin access containment

- Removed public credential prefills/hints and automatic default-admin creation.
- Added local stdin-only admin provisioning/reset and password session revocation.
- Added JWT role checks, current admin session-version checks and suspended-merchant session rejection.
- Removed fallback signing/notification secrets; startup rejects known published values.
- Removed tracked environment secrets and embedded installation snapshots; old history is unchanged.
- Added a deployment runbook and eight isolated regression tests.

## Validation

`npm test`: 8 tests pass. JavaScript syntax, admin inline script syntax, shell syntax and `git diff --check` pass. No live login, production credential rotation, payment or deployment was performed.

## Deployment gate

Read ADMIN_SECURITY_RUNBOOK.md before deploying. Fresh runtime secrets and a provisioned admin are required. Existing sessions may be invalidated. Back up the database and host configuration first. This patch is not payment-readiness approval.

## Next work, in order

1. Bank-confirmed payment/subscription verification and removal of unverified activation paths.
2. Atomic, idempotent order crediting and reconciliation.
3. Correct order-to-receipt binding and protection of callback destinations.
4. Frontend safe rendering, checkout state/expiry, API docs and recovery flows.
5. Admin MFA, throttling, security headers, durable webhook retries and operational recovery tests.

Detailed audit evidence is provided separately to the owner. Payment issues remain open in this focused patch.
