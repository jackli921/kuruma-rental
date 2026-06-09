# Slice: Stripe payment + `payment_events` (webhook source-of-truth) — #461

**Status:** APPROVED (conditional green 2026-06-09) — amended per 3 P1/P2 review findings + positive-int total; proceeding to Neon + TDD
**Branch target:** `marketplace-pivot` (PR squash; close #461 manually)
**Worktree:** `~/Dev/kuruma-461-payment` on `feat/461-payment` (already created)
**Source of truth:** proposal §5 + `2026-06-05-scope-update-du-kaku.md` §2 + issue #461

---

## 1. Scope & boundary (the seam)

This is the **foundational payment backend**. Vertical slice = **DB → API**. The renter-facing
"Pay" UI is the final step of the **#460 booking wizard** and is delivered there, consuming the
typed Hono client contract this slice exposes. That is the deliberate seam — #461 owns
`payments/` + `payment_events` + the API; #460 owns the wizard UI that calls it.

**No change to the booking lifecycle.** The booking-confirm/cancel path (shared with #459/#460)
is **not touched**. "Booking is paid" is **derived**: a `SUCCEEDED` payment_event exists for the
booking. This keeps the seam clean and decoupled — I read `bookings.totalPrice` (whatever #460's
add-ons computed it to be) and never mutate the booking. No new `booking_events` enum value.

**Money rules (from addendum §2):** renter pays the sticker price (`totalPrice`, whole JPY).
Platform Stripe collects the full amount. Platform retains **4%**; `net_to_partner = gross − 4%`.
No Stripe Connect — single platform account; remittance computed in DB, paid manually month-end.
**"Don't trust the client for money":** booking marked paid ONLY on the signed webhook.

---

## 2. Schema (`packages/shared/src/db/schema.ts`)

New enum + table (migration via disposable Neon branch off staging):

```ts
export const paymentEventStatusEnum = pgEnum('payment_event_status', ['SUCCEEDED'])
// MVP records only the success event (checkout.session.completed → payment_status 'paid').
// REFUNDED/DISPUTED are post-MVP — do not add until a refund flow exists (YAGNI).

export const paymentEvents = pgTable('payment_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Partner attribution — RE-DERIVED server-side from the booking, never trusted from metadata.
  operatorId: text('operatorId').notNull().references(() => operators.id),
  bookingId: text('bookingId').notNull().references(() => bookings.id),
  // Idempotency fence (Stripe redelivery): same event id replayed hits this unique and no-ops.
  stripeEventId: text('stripeEventId').notNull(),
  stripeCheckoutSessionId: text('stripeCheckoutSessionId').notNull(),
  stripePaymentIntentId: text('stripePaymentIntentId'),
  // Whole JPY (zero-decimal currency). gross = Stripe amount_total (trusted, not the client).
  grossJpy: integer('grossJpy').notNull(),
  platformFeeJpy: integer('platformFeeJpy').notNull(),    // 4% of gross
  netToPartnerJpy: integer('netToPartnerJpy').notNull(),  // gross − fee
  currency: text('currency').notNull().default('jpy'),
  status: paymentEventStatusEnum('status').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_payment_events_operatorId').on(table.operatorId), // FK cover + revenue agg by partner (#462)
  index('idx_payment_events_bookingId').on(table.bookingId),   // FK cover + "is booking paid" lookup
  // P1 — Stripe-redelivery dedupe: the same event id can never insert twice.
  uniqueIndex('payment_events_stripeEventId_unique').on(table.stripeEventId),
  // P1 — one Checkout Session can only ever record one row (defence in depth vs redelivery).
  uniqueIndex('payment_events_stripeCheckoutSessionId_unique').on(table.stripeCheckoutSessionId),
  // P1 — the BUSINESS fact seal: at most ONE successful payment per booking, even across two
  // distinct valid Sessions both completing. Vendor event dedupe (above) only stops duplicate
  // MESSAGES; this stops a duplicate FACT. Partial so a future REFUNDED row never collides.
  uniqueIndex('payment_events_one_success_per_booking')
    .on(table.bookingId)
    .where(sql`${table.status} = 'SUCCEEDED'`),
])
```

Constraint names also added to `pg-errors.ts` so the webhook handler can tell the three
unique-violation paths apart (`pgConstraintName`):
`PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT` (redelivery → idempotent no-op),
`PAYMENT_EVENT_SESSION_CONSTRAINT` (session replay → no-op),
`PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT` (a *different* session already paid this booking →
double-payment anomaly: structured-error log so an operator can refund one, ack 200 to Stripe).

Migration: `bun run db:generate --name add_payment_events` → `db:migrate` → `db:verify` (3 green),
all against a **disposable Neon branch off the marketplace-pivot staging branch** (never prod, never staging directly).

---

## 3. Pure commission helper (`packages/shared/src/lib/commission.ts` + export)

Shared so #462's revenue tab reuses the exact same math. JPY is zero-decimal → integer arithmetic.

```ts
export const PLATFORM_FEE_BPS = 400 // 4%, basis points
export function computePlatformCommission(grossJpy: number): {
  platformFeeJpy: number; netToPartnerJpy: number
} {
  const platformFeeJpy = Math.round((grossJpy * PLATFORM_FEE_BPS) / 10_000)
  return { platformFeeJpy, netToPartnerJpy: grossJpy - platformFeeJpy }
}
```
Invariant tested: `platformFeeJpy + netToPartnerJpy === grossJpy` for all inputs (no yen lost to rounding).

---

## 4. API layer (all in `packages/api`, routes→services→repositories DI)

```
routes/payments.ts            createPaymentRoutes(paymentService)
services/payment.ts           PaymentService — business logic, idempotency orchestration, commission
services/payment-gateway.ts   PaymentGateway (PORT/interface) — Stripe SDK kept out of the service
services/stripe-payment-gateway.ts  StripePaymentGateway (ADAPTER) — wraps `stripe`, Workers fetch + async sig verify
repositories/types.ts         + PaymentEventRepository interface
repositories/drizzle/payment-event.ts        DrizzlePaymentEventRepository
repositories/in-memory/payment-event.ts       InMemoryPaymentEventRepository
index.ts                      wire concretes (Drizzle / in-memory / test-override branches)
```

**PaymentGateway port** (hexagonal — Stripe types never leak past the adapter):
```ts
interface PaymentGateway {
  createCheckoutSession(p: CreateCheckoutParams): Promise<{ sessionId: string; url: string }>
  parseWebhookEvent(rawBody: string, signature: string): Promise<VerifiedPaymentEvent>
}
```
`VerifiedPaymentEvent` is a narrowed domain shape: `{ eventId, type, checkoutSessionId,
paymentIntentId, amountTotal, currency, paymentStatus, metadata: { bookingId } }`.

### Endpoints
| Method/path | Auth | Purpose |
|---|---|---|
| `POST /bookings/:bookingId/checkout-session` | renter (under `/bookings/*` `requireAuth`) | server-side create Checkout Session; returns `{ url }` |
| `POST /webhooks/stripe` | **public** (no `requireAuth`; CSRF no-ops on cookie-less callers) | signed webhook = source of truth |
| `GET /bookings/:bookingId/payment` | renter | derived `{ status: 'PAID' \| 'UNPAID' }` so the success page confirms server-side |

`createCheckoutSession` service: load booking → assert caller owns it (`renterId`) & not CANCELLED →
**require `totalPrice` is a positive integer JPY** (`Number.isInteger && > 0`, else 422 — not just
non-null) → **reject if already paid** (a `SUCCEEDED` payment_event exists for the booking → 409
Conflict; closes the double-pay window before it opens) → build params with
`metadata = { bookingId, operatorId }` (**P2** — `operatorId` included to satisfy the #461
acceptance wording; still ignored on the webhook), `currency: 'jpy'`, `amount = totalPrice`,
success/cancel URLs from `WEB_ORIGIN` + booking code → call gateway.

`handleWebhook` service: `parseWebhookEvent` (verifies signature; bad sig throws → 400) → ignore
non `checkout.session.completed` (200) and `paymentStatus !== 'paid'` sessions (200) → load booking
by `metadata.bookingId` (missing booking → structured-error log, 200 ack) →
**assert `amountTotal === booking.totalPrice` AND `currency === 'jpy'`** (**P1** — a stale/buggy
session paying the wrong amount is rejected: NO row, structured-error log, 200 ack so Stripe stops
retrying a permanently-bad event) → **re-derive `operatorId` from the booking row** (never metadata) →
`gross = amountTotal` → `computePlatformCommission` → insert `payment_events` **idempotently**.

Idempotency is constraint-name-aware (`pgErrorCode === UNIQUE_VIOLATION`, then `pgConstraintName`):
- `…_stripeEventId_unique` or `…_stripeCheckoutSessionId_unique` → same event/session redelivered →
  no-op, 200 (the fact is already recorded).
- `…_one_success_per_booking` → a *different* Session already paid this booking → **double-payment
  anomaly**: no second row, ERROR-level structured log (operator refunds one), 200 ack.
In-memory repo mirrors all three checks by scanning its map; the Drizzle repo relies on the DB.

---

## 5. CF Workers / Stripe specifics (gotchas to bake in)
- `new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })` — Node http client breaks on Workers.
- Webhook verify MUST use **`stripe.webhooks.constructEventAsync`** (SubtleCrypto), not the sync `constructEvent`.
- Raw body for signature: Hono `await c.req.text()` (NOT parsed JSON), header `stripe-signature`.
- `stripe` added to `packages/api` deps; lazy-construct the client (never at module scope — CF lesson #1).

## 6. Env / secrets (never hardcoded/logged)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, reuse `WEB_ORIGIN` for redirect URLs. Wired via
`wrangler secret put` (test-mode keys for the demo) + `deploy.yml`/`rotate-secrets.yml` presence
checks (follow the slice-0 pattern). Gateway/keys absent ⇒ sentinel that throws on first use
(mirrors `translationProvider`/`emailSender`), so unrelated tests/boot still work.

---

## 7. TDD plan (vertical, RED→GREEN per behavior)
1. `computePlatformCommission` — 4% rounding + `fee + net === gross` invariant (pure unit).
2. `createCheckoutSession` — owner check; CANCELLED reject; `totalPrice` non-positive/non-integer
   reject (422); **already-paid → 409**; metadata `{ bookingId, operatorId }` + amount correctness (fake gateway).
3. Webhook happy path — verified `checkout.session.completed` → one row, correct operator/gross/fee/net.
4. Webhook redelivery idempotency — same `eventId` twice → exactly one row, 200 both times.
5. **Webhook one-success-per-booking** — two *different* completed Sessions for one booking →
   exactly one row; second → anomaly-logged, 200, no second row.
6. **Webhook amount/currency guard** — `amountTotal !== totalPrice` or `currency !== 'jpy'` →
   no row, 200 ack.
7. Webhook security — bad signature → 400, no row; non-paid / other event types → 200, no row;
   operator re-derived from booking (metadata `operatorId` ignored).
8. `GET .../payment` — UNPAID before, PAID after webhook.
9. Integration (DATABASE_URL, CI) — Drizzle repo enforces all three unique constraints for real.

Full local gate before "green": `bun run lint` / typecheck-all / `lint:boundaries` / export-drift /
fk-indexes / i18n-parity / `db:verify` / api vitest / web vitest / build / dist-size.

## 8. Coordination
- Booking path untouched → rebase on #459/#460 is trivial (additive files + 2 schema objects + 1 helper).
- `totalPrice` is the only contract surface with #460 (add-ons fold into it upstream).
- `payment_events` columns are #462's revenue-tab query surface — frozen here "complete from day one".

## 9. Out of scope (follow-ups)
- Refunds/disputes/`REFUNDED` status; partner payout export; pre-auth/security-deposit handoff (slice 7, separate).
- The renter Pay UI (lives in #460 wizard); a thin demo button only if #460 hasn't landed by demo time.
