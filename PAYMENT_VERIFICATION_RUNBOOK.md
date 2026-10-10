# Payment verification containment

This patch depends on the admin/access hardening patch (PR #1). It is a fail-closed containment release, not a bank integration or a working automated payment gateway.

## Changed behavior

- New `/api/create-order` requests return HTTP 503 / `VERIFICATION_UNAVAILABLE` without creating an order. Existing checkout pages do not provide QR codes, app intents or payment redirects. The homepage and merchant workspace disclose the pause.
- A 12-digit UTR for a pending order can be recorded for review. It cannot change order status, merchant balance, plan or dispatch a success webhook.
- Accepted review responses are HTTP 202 with `accepted: true`, `payment_status: PENDING_VERIFICATION`, `review_id` and **`status: false`**. This intentionally keeps cached legacy clients that check only `status` from displaying payment success. It means approval is false, not that the review was lost.
- Repeated identical submissions return the same review ID. Each order/merchant-plan pair allows at most three distinct submitted references. Unverified claims do not reserve a bank receipt globally. Changing or refunding a payment is outside this queue.
- Subscription reviews require an exact active plan and the server's price in integer paise. Submitted references do not create approved subscription records or activate plans. Self-service direct plan changes are forbidden. Explicit admin entitlement management remains an administrative action, not evidence of payment.
- Both admin force-credit and the shared-secret notification receiver refuse financial state changes. A notification, shared secret or human-entered UTR is not independently verified bank evidence. No environment flag can bypass this restriction.
- Admins can inspect the newest 100 records through authenticated `GET /admin-api/payment-reviews`. There is intentionally no approval endpoint until trusted receipt verification exists. Pending references are retained in the additive `payment_review_requests` table.

## Existing data and deployment

1. Follow ADMIN_SECURITY_RUNBOOK.md first: new private secrets, valid admin account, database/configuration backup and Node.js 24+.
2. Coordinate the collection pause with merchants and inspect payments already in progress before deploying. This patch does not cancel a transfer already initiated in a bank app, and cannot revoke QR/intent values previously copied outside the platform.
3. Existing orders, balances and historical subscription approvals are preserved. Past SUCCESS/APPROVED records are **not** newly verified by this patch. Reconcile prior receipts and duplicate credits independently; do not bulk reverse customer funds.
4. Deploy backend and static pages together and refresh any CDN cache. Cached clients receive the safe pending/false contract rather than success. Verify create-order and force-credit return 503, review submission returns 202 with no ledger change, and checkout presents no QR/intent.
5. Verify the application host clock, backup/restore and monitoring. No live payments are required for this release check.

## Before resuming collections

Choose an authorized bank/payment provider and implement its documented server-to-server verification flow. The verifier must bind a confirmed receipt to merchant, destination account, currency, exact amount, order and unique provider receipt ID, and validate signatures/authentication and replay controls. It must enforce expiry and handle late payments deliberately.

Only that verified path may atomically mark an order complete and record financial effects once. Direct-to-bank collections must not also become an unsupported payable wallet liability; decide ledger semantics before crediting balances. Add receipt uniqueness, idempotent transitions, reconciliation, refunds/reversals, durable callback delivery and safe callback destinations. Do not re-enable the old manual/notification code or merely change `status` to true.

Use provider sandbox fixtures and controlled end-to-end tests before a separately authorized live transaction. Pending-review processing and merchant status views need to be integrated with that verifier; this patch intentionally cannot approve queued submissions.

## Validation

`npm test`: 23 tests pass, including HTTP route tests against an isolated temporary SQLite database, concurrent idempotent submissions, rollback, amount/plan tampering, legacy-success protection, role checks and pending-only checkout UI logic. No bank requests or production mutations occur. Browser visual testing and live bank reconciliation were not performed.
