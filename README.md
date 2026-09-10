# RenewalRadar 1.3.2

A Node.js + SQLite subscription tracker with account-backed records and documents.

## Run

Requires Node.js **22.5 or newer**. Stripe is a runtime dependency. Node.js 24 LTS is used by the Docker image.

```bash
npm ci
npm start
```

Open `http://localhost:3000`. Optional: copy `.env.example` to `.env`; the server loads it automatically. Shell environment variables take precedence.

GitHub Codespaces: the public origin is derived from `CODESPACE_NAME`, the port and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`. If an old `.env` pins `APP_ORIGIN=http://localhost:3000`, remove that line for automatic detection or set it to the exact Codespaces URL. Other deployments must set `APP_ORIGIN` to their exact public URL. `ALLOWED_ORIGINS` accepts additional exact origins; it does not trust arbitrary proxy headers.

Set `NODE_ENV=production` for HTTPS deployments so session cookies use `Secure`.

## Updating an existing installation

1. Stop the old server and back up its `data` directory.
2. Replace the application files with this package. Keep `.env` out of Git. For a Turso deployment, add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; missing tables are created automatically on first start.
3. Start the new server, sign in with the existing account, and open Settings → Import previous browser records on the browser where you used the old version.
4. Review the records before confirming the import. Duplicate IDs are skipped. Only the old account-scoped storage is considered; legacy unscoped records are not silently assigned to a user.
5. Old document metadata does not contain file bytes. Upload those source files again. Old last-used counters have no observation timestamp, so record their actual last-used dates again.

New accounts start empty. Example service presets are suggestions, not detected subscriptions.

## Data and calculations

- Subscriptions, price-change history, reminder settings and server-verified billing status are stored per account in SQLite. Sign in to the same running installation from another device to see the same records. The browser checks every 15 seconds and on focus/reconnection; pending changes do not overwrite open drafts.
- Saves use a version check. A stale browser gets a conflict instead of overwriting another device. Reload the latest account data before reapplying a conflicting edit.
- Documents contain the actual uploaded bytes, with authenticated download and deletion. Limits: 5 MB per non-empty file and 50 MB per account. Downloads are attachments, not inline executable previews.
- Dates are calendar dates, not noon timestamps. A future first renewal is respected. Month-end and leap-year clamping retains the original billing-day anchor. Monthly, yearly and weekly cycles are supported.
- The current-month summary counts remaining scheduled charges, including today. The annualized estimate uses monthly × 12 and weekly × 52; it is not a statement of actual payments.
- Charts project the entered schedules at their current prices. The year selector works. They are explicitly labelled as schedule estimates, not historical bank transactions.
- Editing price/cycle records a dated change and compares normalized annual costs. It does not automatically discover provider changes.
- Last-used dates are manually recorded. Their age increases with calendar time. “Used today” updates usage; “Review again in 30 days” postpones a review without pretending the service was used.
- The radar displays the seven nearest renewals and shows a visible displayed/total count. The full list and calendar contain all records.
- Removing a record **does not cancel the subscription with its provider**.

## Reminders and email recovery

There are two available reminder paths:

1. **Calendar export:** Settings → Export calendar reminders creates an `.ics` file containing the next 12 months of scheduled occurrences with alarms. Import it into your calendar and enable calendar notifications. Re-export after changing dates/prices. Delivery of these alarms depends on the calendar application; it does not require this webpage to remain open.
2. **Email:** configure `RESEND_API_KEY` and `MAIL_FROM` from a verified sending domain, or an HTTPS mail relay using `MAIL_WEBHOOK_URL` and `MAIL_WEBHOOK_TOKEN`. Verify your account email from Settings, then explicitly enable email reminders and choose a lead time/time zone. The running server checks every minute, even with the browser closed. Each subscription/renewal date is sent once; failed deliveries retry. The server must remain running. Missed, already-past renewals are not sent retrospectively.

### Mail relay contract

The configured endpoint must accept:

```http
POST /your-mail-relay
Authorization: Bearer <MAIL_WEBHOOK_TOKEN>
Content-Type: application/json
Idempotency-Key: <unique-delivery-key>
```

```json
{
  "to": "recipient@example.com",
  "subject": "Renewal reminder",
  "text": "Plain-text message"
}
```

Return a 2xx response only after accepting the message for delivery. Honour the idempotency key to prevent duplicate sends if the server restarts between acceptance and recording success. Connect this relay to your email provider; **no third-party email provider or credentials are bundled**. A local HTTP relay is supported in development for tests; production requires HTTPS.

Forgot-password and email-change links are delivered through the configured provider. They are never returned to the frontend or printed in logs, even in development. Without configuration, recovery reports that delivery is unavailable. Signed-in users can change their password by confirming the current one without email. Password reset revokes sessions and all outstanding reset links; signed-in password changes rotate the current session and revoke the others.

## UI and availability

- English, German and Spanish UI strings, dates and currency formatting. User-entered service/plan/category/file names stay as entered.
- Theme changes preserve form drafts; language changes preserve profile, reminder and auth drafts.
- Mobile search, notifications and document upload remain available. Calendar cells fit seven columns without a forced 650 px minimum.
- Dialogs have a title, labelled controls, inert background, keyboard focus cycling and Escape dismissal. Destructive record/file actions require a confirmation within the app.
- Pro uses Stripe hosted checkout, verified webhooks and a customer billing portal. No client flag, import or success URL grants paid access. Bank/inbox connections are not part of this manual-tracking service.
- The contact page exposes a mail link only after `CONTACT_EMAIL` is configured to a real address. It does not pretend to send a contact form.

## Verification

```bash
npm ci
npm test
```

`linkedom` is a development-only dependency for DOM tests. The tests cover date boundaries, auth/reset, mail relay/verification, reminder deduplication, persistence, cross-account file access, optimistic conflicts, rendering in three languages, filtering, editing, draft preservation, dialogs and historical calendar details.

Tests use temporary databases and a local simulated mail relay. Stripe tests use the real SDK against a local simulated API, including signed webhook payloads. No external messages or real charges are sent.

The remote browser available during this review could not open the local application (`ERR_BLOCKED_BY_CLIENT`). HTML/CSS and DOM behaviour were reviewed, but **pixel-level desktop/mobile screenshots and real-browser keyboard/layout checks remain unverified**. See `QA-REPORT-BG.md` for the UI findings and release checklist.

## Operational limits

For Vercel/Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. The app uses Turso when both values are present and falls back to local SQLite only when neither is present. Do not set one without the other. Uploaded documents are still stored in the database in this version; move them to object storage before allowing large real-world document uploads. Production launch needs your real support/business details, business-specific legal policies, provider credentials, HTTPS deployment and browser QA. The included legal pages are product summaries, not a complete set of business-specific policies.


## Accounts and backups

Settings supports full JSON export (subscriptions and actual document bytes), validated merge import, active sessions, password-confirmed revocation of other sessions, verified email changes and password-confirmed account deletion. Import never restores passwords, sessions, verified email flags or Pro rights. Existing IDs and identical files are skipped; invalid imports are atomic. Keep downloaded backups private.

Account deletion expires pending checkouts and cancels Stripe subscriptions **before** deleting local data. If Stripe cannot confirm cancellation, deletion stops and can be retried. Deletion does not issue refunds or erase financial records retained by Stripe. To cancel only Pro, use Manage billing; do not delete the entire account.

## Stripe: configure real payments

1. In your own Stripe account, create a RenewalRadar Pro product and one or two active **EUR, recurring, per-unit** prices (monthly/yearly). The UI reads amounts and intervals from these prices; no price is invented in the app. Configure only prices that grant the same Pro features.
2. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY` and optionally `STRIPE_PRICE_YEARLY` in the server environment. Do not put secret keys in frontend code. Start in Stripe test mode.
3. Create a webhook endpoint at `https://YOUR-DOMAIN/api/billing/webhook`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` and `invoice.payment_action_required`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Use events for your own account, not Stripe Connect accounts.
4. Configure and activate Stripe Customer Portal: allow invoice access, payment-method updates and cancellation. If offering plan changes, allow only this product and the configured price IDs. Optionally set `STRIPE_PORTAL_CONFIGURATION`. Configure cancellation at the end of the paid period if that matches your policy.
5. Configure Stripe payment receipts, failed-payment emails, retry rules and tax settings for your business. `STRIPE_AUTOMATIC_TAX=true` enables automatic tax calculation only after you have configured Stripe Tax. Checkout displays the final charge.
6. Test checkout, return to Settings, Pro access, invoice download, cancellation, declined payment and webhook retries in Stripe test mode. Then replace the secret, price IDs, webhook secret and optional portal configuration with their **live-mode** equivalents. Stripe account activation and a public HTTPS deployment are required to accept real money.

Pro is active only for a current `active` or `trialing` subscription on a configured price. `past_due`, `unpaid`, canceled and expired subscriptions do not grant access. Webhooks query Stripe's current state, so out-of-order payloads cannot restore stale access. A five-minute reconciliation worker covers missed webhooks; the local paid period also expires automatically. The Settings refresh action can confirm checkout immediately. Portal handles invoices, card updates and cancellation. Refunds/disputes are operator actions in Stripe, not an unrestricted customer refund API.

See the official [Checkout API](https://docs.stripe.com/api/checkout/sessions/create), [webhook signature verification](https://docs.stripe.com/webhooks/signature), [Customer Portal API](https://docs.stripe.com/api/customer_portal/sessions/create) and [Resend email API](https://resend.com/docs/api-reference/emails/send-email) for provider configuration.

## Deploy

Copy `.env.example` to `.env`, set `APP_ORIGIN=https://YOUR-DOMAIN`, actual contact details and the provider variables above. Run behind a TLS reverse proxy forwarding to port 3000. Preserve the request body for `/api/billing/webhook`; the signature is checked against its original bytes.

```bash
docker compose up -d --build
```

The provided compose file binds the app only to host loopback port 3000; configure your host reverse proxy to terminate public HTTPS. The named volume persists SQLite and uploaded files. Do not run `docker compose down -v` on a live installation: that removes its data volume. `/api/health` checks local database availability; monitor provider webhooks and email delivery separately.

For a Turso deployment: `npm ci --omit=dev`, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then start `node server/server.js`. Local development can omit both values and uses `DATA_DIR`. The in-process reminder interval is suitable for local and single-server development only; a Vercel deployment needs a scheduled endpoint before reminder emails can be relied on.

Before upgrades, stop the service and back up the entire data directory. Restore it with the service stopped. The account JSON export is a portable user backup, not a replacement for operator database backups (which contain auth and billing mappings). No domain, hosting account, Stripe account or email credentials are included in this archive.


## 1.3.0 — activation and recurring use

- First-run dashboard has a clear first-subscription action rather than empty graphs. A dismissible setup checklist reflects real saved records, verified email and enabled reminders.
- The next-payment card shows a concrete service, amount and date, or an explicit quiet week. Radar nodes already open the matching service; a full readable monthly agenda accompanies the calendar, and mobile cells use counts rather than tiny text.
- The add form initially shows service, price, cycle and next renewal date. Optional category, plan and usage fields are collapsed. Presets supply identity/category only: new records never receive a guessed price/date. Custom-service search carries the typed name forward.
- Incomplete form data is autosaved to one account-scoped draft **on the current device**. Saving a draft does not create a scheduled subscription. The dashboard restores it, and starting another add flow offers to resume or explicitly discard it. Local drafts are not synced or included in server backups. Their elapsed time includes time away from the form.
- Successful addition confirms the real saved amount/date and offers reminder setup. It does not claim reminders work before the account has enabled them.
- Server emails link directly to the subscription; the target survives sign-in. Removed or archived targets show an explanatory message.
- Reviews cover up to three records not reviewed within 30 days. Keep marks the review date; Check later leaves it pending. Already canceled requires another confirmation, then atomically removes the record from scheduled charges/reminders and archives it on the account. Archive is included in full backups/imports and can be restored. It does not contact/cancel a third-party provider. Monthly reductions are annualized estimates from user-confirmed cancellations, not bank-verified savings.
- Typography uses available system UI fonts with 16 px primary text and inputs, 14 px supporting text, stronger muted contrast, visible focus states and reduced-motion support. No font download is needed. Ordinary informational text can be selected. Browser caret-navigation mode remains controlled by the browser; the app does not disable this accessibility feature.

## Optional first-party measurement

`ANALYTICS_ENABLED=false` by default. Local per-account event counters are stored on the device without transmitting them. If the operator explicitly enables server measurement, `/api/usage` accepts a fixed event allowlist from authenticated users: add/edit started/completed, reminder opened, review completed. Events contain a random deduplication ID and optional elapsed milliseconds, never service names, prices, email addresses or typed field contents. Server records link to the account and cascade on deletion; records older than 90 days are pruned when new events are accepted. Disclose your enabled measurement in your deployment's privacy information.

Set a separate random `ANALYTICS_ADMIN_TOKEN` of at least 32 characters. `GET /api/admin/usage` requires `Authorization: Bearer <token>` and returns day/event attempt counts, distinct account counts, mean elapsed times and current activation counts. The token must stay outside frontend code and URLs. Reports are operator-only; they are not available through customer login alone. With analytics disabled, the routes return 404.

Repeated draft resumes count as new attempts; distinct-user counts are available separately. Elapsed draft time includes breaks and is capped at one day. Current activation is not a retention cohort. This release supplies measurement, not a statistically validated uplift, automatic A/B allocation or 30/60-day cohort reporting. For an experiment, predefine the metric and sample size before comparing variants. Do not treat a few users or raw event ratios as proof of retention gains.

## 1.3.1 — visual corrections

Pro CTA now occupies its own centered row below the benefits, full-width on mobile. Restored the original six-second radar sweep and service pulses. System reduced-motion preferences still disable animation. These CSS changes were inspected against the supplied screenshots; no new browser screenshots were available.

## 1.3.2 — landing radar stacking

Isolated the hero radar in its own lower stacking context; the price cards sit above every decorative logo and pulse throughout their animations. Dashboard radar behavior is unchanged. CSS inspected against the supplied screenshot; live browser verification remains unavailable.
