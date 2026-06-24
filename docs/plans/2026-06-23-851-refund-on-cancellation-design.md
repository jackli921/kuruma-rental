# #851 — Auto-refund on cancellation (design)

> Status: **PROPOSED — awaiting sign-off.** Spun out of #679 (cancellation fee
> semantics) and #868 (settlement-state scaffolding). Owner: this session.
> Rev 4 — queue from earliest intent (`bookings.REFUND_DUE`); Stripe-verified pull
> advances state (not webhook-only); receipt seals. Rev 3 — durable receipt
> (24h-prune gap). Rev 2 — outbox, atomic idempotency, repo API.

## Problem

`BookingLifecycleService.cancel()` (renter) computes `refundAmount` and records a
`cancellationFee`; the operator path (`updateStatus(→ CANCELLED)`) leaves the fee
NULL (full refund owed) — but **neither moves money in Stripe**. For a PAID
booking the refund is owed and only happens if an operator manually refunds. This
closes the gap with automated, **durably-queued, double-refund-proof, self-healing**
refunds.

## State + storage model

- **`bookings.cancellationFeeSettlement`** (exists; #868; text, default `ADVISORY`)
  — booking-facing projection **and the durable work queue**. States:
  `ADVISORY · CAPTURED · REFUND_DUE · REFUNDED · WAIVED`. The cancel tx commits
  `REFUND_DUE` — the *earliest* durable intent; the reconciler scans from here.
  Add a **partial index** `WHERE cancellationFeeSettlement='REFUND_DUE'` (small hot set).
- **`payment_refunds`** (NEW table) — durable money receipt / create-dedup ledger,
  **not** the queue: `{ id, bookingId UNIQUE, operatorId, stripePaymentIntentId,
  amountJpy, stripeRefundId (null until created), status: PENDING|SUCCEEDED|FAILED,
  createdAt, updatedAt }`. Seals: `UNIQUE(bookingId)` (≤1 refund/booking) **and
  a partial `UNIQUE(stripeRefundId) WHERE stripeRefundId IS NOT NULL`** (an
  adoption bug can't bind one `re_…` to two rows).

We do **not** add `payment_events.status='REFUNDED'` (its `notNull` revenue columns
+ unique `stripeCheckoutSessionId` seal don't fit a refund; schema flags it "post-MVP
YAGNI"). `payment_refunds` is the DDD-correct home and carries `re_…` for support.

> Rev 2 claimed "no migration." Rev 4: **one migration** = `payment_refunds` +
> the `REFUND_DUE` partial index. Correctness over convenience.

### Reconciliation note (issue text vs codebase)
#851's body lists "a `REFUNDED` payment_event"; #868 built the settlement-state
machine. Resolved toward the deliberate design: settlement state + `payment_refunds`.

## Decisions (signed off)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Automate? | **Yes** | Refunds owed and manual today. |
| Stripe fee | **Platform absorbs** | Refund the full refundable amount; standard Airbnb/Turo. |
| `REFUND_DUE` semantics | **Durable work queue (outbox)** | A flag alone loses money on a crash. |
| Queue source | **`bookings.REFUND_DUE`** (earliest committed intent) | The receipt is created post-commit; scanning it would miss a crash before the claim. |
| What advances state | **Any Stripe-verified signal** — webhook push *or* server-side retrieve/list pull, via one atomic transition | The webhook can never arrive; a verified pull is equally authoritative and self-heals. (Client redirects still never advance — #461.) |
| Double-refund safety | **Durable `re_…` receipt + pre-create `list`** | Stripe's idempotency key prunes ~24h; the sweep is daily. |

## Money policy

Payment model: **upfront Checkout capture, but payment is optional** — a booking can
be `CONFIRMED` + `UNPAID`. A refund applies only when a `SUCCEEDED` payment_event exists.

| Situation | Settlement | Stripe action |
|-----------|-----------|---------------|
| UNPAID cancel | stays `ADVISORY` | none — most cancels |
| PAID renter, `refundAmount > 0` | `REFUND_DUE` → `REFUNDED` | refund **`refundAmount`** |
| PAID renter, FULL tier (`refundAmount == 0`) | `CAPTURED` | none — whole payment kept |
| PAID operator-fault | `REFUND_DUE` → `REFUNDED` | refund **full `totalPrice`** |

Amounts from existing `calculateCancellationFee()`. **Clamp**: refund =
`min(intended, payment_event.grossJpy)` — never refund more than captured.

## Reliability model — outbox queued on `REFUND_DUE`

The cancel tx atomically commits `REFUND_DUE`. One **idempotent** entry point,
`initiateCancellationRefund(booking)`, is shared by the eager fire and the reconciler:

```
1. UNPAID or amount≤0 → no-op.
2. claim(bookingId): INSERT payment_refunds PENDING ON CONFLICT(bookingId) DO
   NOTHING → load. Idempotent; NEVER regresses SUCCEEDED/FAILED → PENDING.
3. If receipt.status == FAILED (terminal) → no-op; leave for human surface.
4. If receipt.stripeRefundId present → refunds.retrieve(id).
   Else refunds.list({payment_intent}) → adopt ONLY a refund matching our business
   correlation (metadata.bookingId === booking.id AND amount === amountJpy AND
   currency 'jpy' AND payment_intent AND status not failed/canceled). A foreign or
   partial refund on the same PI (e.g. a manual operator refund) is NEVER adopted —
   the parent PI can hold legitimate facts we don't own. Else refunds.create(…,
   {idempotencyKey:`refund:${bookingId}`}) → attach re_….
5. Map Stripe status (below). On `succeeded` → confirmRefundSucceeded(bookingId).
```

`confirmRefundSucceeded(bookingId)` = **one tx**: `payment_refunds → SUCCEEDED`
**and** `markCancellationSettlement(REFUND_DUE → REFUNDED)`. Used by BOTH the webhook
and the reconciler, so a push and a pull racing are safe — the booking guard
`WHERE cancellationFeeSettlement='REFUND_DUE'` lets the first commit win; the second
matches 0 rows → no-op. State never regresses; ordering is safe (`REFUND_DUE`
commits before Stripe is ever called).

### Stripe Refund.status → our enum (deliberate map)
`succeeded` → SUCCEEDED (+ confirm). `pending` / `requires_action` → stay PENDING
(reconciler revisits). `failed` / `canceled` → FAILED (terminal; booking stays
`REFUND_DUE` as the human-reconcile signal, excluded from auto-retry). A
`refunds.create` rejection because the charge is already (manually) refunded or the
remaining balance is insufficient → receipt FAILED + leave booking `REFUND_DUE` for
the human surface. We never confirm `REFUNDED` for a refund we didn't issue for our
amount.

### Drivers
- **Eager** — post-commit best-effort (low latency). A throw is caught/logged; the
  row stays `REFUND_DUE` for the backstop.
- **Backstop** — reconciler on `worker.ts scheduled` (Slice 4) scans
  `bookings.REFUND_DUE`. A lost eager-claim, a lost webhook, or a Stripe transient
  all self-heal here.

## Repository API changes

Current: `cancel(ctx,id,{from,fee,cancelledAt})`, `updateStatus(ctx,id,{from,to})`;
`create` `Omit`s `cancellationFeeSettlement`. Add:
- `cancel` gains `settlement` (renter cancel writes status+fee+settlement in-tx).
- Operator `updateStatus(→ CANCELLED)` tx writes the initial settlement in-tx.
- NEW `markCancellationSettlement(ctx,id,{from,to})` — guarded conditional transition.
- NEW `listRefundDueNeedingDrive({limit})` — bounded reconciler scan: bookings
  `REFUND_DUE` joined to `payment_refunds`, keeping only rows with NO receipt or a
  non-terminal (PENDING) receipt, so terminal-FAILED rows are excluded **before** the
  limit and can't starve retryable work.
- NEW **`PaymentRefundRepository`**: `claim(bookingId,…)` (idempotent upsert →
  PENDING, **forward-only**), `attachStripeRefund(bookingId, re_…)`,
  `markStatus(bookingId, status)` (forward-only), `findByBookingId`.
- All on **both** InMemory and Drizzle (parity — #939).

## Plan — 4 vertical slices (TDD, money = high care)

Stripe SDK confined to `services/payment/stripe-payment-gateway.ts`.

### Slice 1 — schema + gateway + idempotent core (unit + integration)
Migration: `payment_refunds` (both unique seals) + `REFUND_DUE` partial index. Repo
(InMem+Drizzle). Gateway `refundPayment` / `retrieveRefund` /
`listRefundsByPaymentIntent`; `parseWebhookEvent` recognizes the refund event.
`initiateCancellationRefund` = the steps above, with clamp + UNPAID/`amount≤0` no-ops.
Tests: creates once + attaches `re_…`; **re-drive after the key prunes → retrieves,
no second refund**; **`list` adopts ONLY a correlation-matching refund** (a foreign
partial refund on the same PI is NOT adopted → create attempted); a
charge-already-refunded create error → receipt FAILED + booking stays `REFUND_DUE`;
**`claim` never regresses SUCCEEDED→PENDING**; duplicate `re_…` attach rejected by the
partial unique; clamp caps.

### Slice 2 — webhook → confirm (integration, real pg)
Refund event → `confirmRefundSucceeded` (one tx: receipt SUCCEEDED + booking
REFUNDED). Tests: flips both; redelivery/parallel = no-op (0 rows); unknown booking
ignored; bad signature → 400 records nothing.

### Slice 3 — wire both cancel paths + eager (integration)
`cancel()` sets initial settlement in-tx + fires `initiateCancellationRefund`
post-commit; operator `updateStatus(→ CANCELLED)` full-total, same pattern. Tests:
paid LOW-tier → moves `refundAmount`, `REFUND_DUE`; unpaid → nothing, `ADVISORY`;
full-tier → `CAPTURED`; operator paid → full total.

### Slice 4 — reconciler backstop, failure-isolated (integration)
Sweep from `worker.ts scheduled` (next to ComplianceDigest):
`listRefundDueNeedingDrive({limit:N})` (terminal-FAILED excluded in-query) —
**bounded batch**, **per-row try/catch**, **summary counters** logged like
`[cron:compliance-digest]` (`{attempted, succeeded, failed, pending}`). Tests:
**refund succeeded at Stripe but webhook never arrived → sweep retrieves `succeeded`
and flips to `REFUNDED`** (the self-heal case); a stuck pre-claim `REFUND_DUE` is
claimed + driven; **M terminal-FAILED rows ahead of K retryable do NOT starve the
batch** — the sweep still drives min(K,N) retryable; **one poison row does not abort
the rest**; already-`REFUNDED` not picked up; two runs idempotent; `limit` respected.

## Out of scope (explicit)
- **Human** admin "stuck / terminally-FAILED refund" reconciliation + alert UI (the
  *automated* reconciler is IN; escalation surface is a follow-up).
- `payment_events.REFUNDED` row / net-of-refunds revenue math (#462).
- `DOUBLE_PAYMENT`-anomaly refunds (operator-manual via #508); partial/multi refunds;
  disputes/chargebacks; exponential backoff (daily cadence is enough now).

## Risks
- **Stripe refund event shape**: confirm `charge.refunded` vs `refund.updated`
  carries `metadata.bookingId` + `payment_intent`; resolve in Slice 1. Fallback: map
  `payment_intent → booking` via the SUCCEEDED payment_event.
- **`refunds.list` cost**: a PI has ≤ a handful of refunds; `limit:10` ample. Belt to
  the receipt, not the primary guard.

## Worktree / branch
- Worktree `~/Dev/kuruma-851-refund-on-cancel`, branch `feat/851-refund-on-cancel`.
- On sign-off: post this design to issue #851, then TDD Slice 1.
