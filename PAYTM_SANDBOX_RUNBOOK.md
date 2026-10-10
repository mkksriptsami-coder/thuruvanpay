# Paytm Staging-only integration (PR review notes)

This is an **isolated administrative staging tool**, NOT a live gateway. The original `/api/create-order`, UTR, subscription and admin force-credit pauses remain in place. It does not credit merchant balances, approve plans, dispatch merchant webhooks or change the existing orders ledger.

## Before testing

- Back up the real database/configuration first; deploy the admin/auth hardening and payment-containment patches per their runbooks.
- Requires Node 24+, a provisioned admin and private JWT secret.
- Put only **TEST** MID and **TEST** Merchant Key in the server's untracked `.env`, never frontend, repository, logs or chat. Paytm checksum AES-128 requires a 16-byte test key.
- Set `PAYTM_SANDBOX_ENABLED=true` only on an explicitly authorized test instance with network access to Paytm staging. Default `false` refuses all new endpoints with HTTP 503.
- Test checkout at `/paytm-sandbox.html` after admin login. The page calls admin-token-protected endpoints and loads Paytm staging JS Checkout.
- Do not put production MID/Key in test settings. The adapter has fixed **staging** hosts, with no production host fallback.

## Routes

`POST /admin-api/paytm-sandbox/initiate` with `{"amount":"1.00"}` uses server-generated `SBX_...` order IDs; admin-authenticated only. Amount 1.00–99.99 INR; max 8 per hour per admin. Sends a signed Paytm Initiate Transaction request and verifies signed response. Returns a staging transaction token.

`GET /admin-api/paytm-sandbox/status/:orderId` queries official Paytm staging Transaction Status API, checks response signature, MID, exact amount, order ID and unique provider transaction ID before marking `VERIFIED_TEST` **only in paytm_sandbox_orders**. Does not change financial records.

New table: `paytm_sandbox_orders`. This is strictly segregated from `orders`, `subscription_orders`, `merchants` and wallets. Non-success, malformed, unsigned or network-failed replies can never credit.

## Required before any LIVE payments

Real provider agreement/MID activation, secure merchant identification and onboarding rules, reconciliation and refunds, order ledger and atomic idempotent financial posting, ownership checks, callback/webhook destination safety, durable retries, browser QA and controlled staging end-to-end tests are **still pending**. This PR does not waive these gates. Do not remove the current payment pause.

Paytm official API references:
- https://www.paytmpayments.com/docs/api/initiate-transaction-api/
- https://www.paytmpayments.com/docs/api/v3/transaction-status-api/
- https://business.paytm.com/docs/jscheckout-invoke-payment
- https://github.com/paytm/Paytm_Node_Checksum
