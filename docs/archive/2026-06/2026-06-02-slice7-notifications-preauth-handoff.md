# Slice 7 — Outbound Notifications & Pre-Auth Handoff (issue #393)

**Date:** 2026-06-02 (rev. 2026-06-06)
**Status:** MERGED 2026-06-06 (#393, PR #482, `fd67030`) — outbound notifications + pre-auth handoff landed on `marketplace-pivot`. Plan retained for history.
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6 row 7; §4 business item 8 + renter items 5/6; §9 items 2/5/17; §10 item 2; §8.1 Resend/pre-auth risks; §8.2 notification-delivery NFR)
**Format mirror:** `docs/plans/2026-06-02-slice4-insurance-pricing-fees.md`
**Supersedes:** the thin body of #393 (insufficient detail for AFK implementation)

---

## Changelog — v2.1 (2026-06-06, second architect-review pass; all 5 nits verified vs merged code)

1. **[P1a] Operator-alert recipient now sourced.** Verified: `roleEnum` has `OPERATOR_OWNER/STAFF`, `users.operatorId` is indexed (`idx_users_operatorId`), but `UserRepository` had no by-operator read. v2.1 adds scoped `findOperatorContacts(operatorId)` → owner email, fallback `OPERATOR_ALERT_FALLBACK_EMAIL` (§4d, §11, §12.6).
2. **[P1b] `SENDING` reclaim made lease-bounded.** v2's text both did and didn't reclaim `SENDING`. v2.1: one claim predicate (§3) reclaims `QUEUED`/`FAILED` + **expired** `SENDING` (`SEND_LEASE` = 5 min); a live `SENDING` is never reclaimed (else double-send). *Learn: Check-Then-Act Race* (§12.7).
3. **[P1c] Repair-on-replay preserved.** Verified `ensureThread` fires at **3** sites (`booking.ts:192/209/231`), two of them replay paths. `BookingPostCommitDispatcher` now runs at all three, idempotently — a replay repairs a half-sent booking (§4d, §7, §12.1).
4. **[P2d] Stale v1 execution-order step removed.** §9 no longer lists "add `OperatorRepository.findById`"; replaced with the read-model projection + `findOperatorContacts`.
5. **[P2e] `locationRepo` added to the dispatcher.** Booking row carries only location **IDs** (`booking.ts:35-36`); the dispatcher now resolves location **names** for customer-facing mail (§4c, §4d, §4g, §11).

---

## Changelog — v2 (2026-06-06, post architect-review, all findings verified vs merged Slice 6 `3f04b2b`)

1. **[P1] Pre-auth CTA now has an explicit API contract.** Merged `GET /bookings/:id` returns the booking row only (`bookings.ts:64`); `/operators/:id` is management-gated. v2 adds a **renter-safe `operator: { name, preAuthHandoffUrl }` projection** on the booking read model + a confirmation-page test (new §4h, §5.1).
2. **[P1] Post-commit seam is now decided, not hedged.** Verified: Slice 6 kept `ensureThread` **inline inside `BookingService.create`** (`booking.ts:209`, 3 call-sites) and added **no** generic hook. v2 **refactors the inline `ensureThread` calls into a service-level `BookingPostCommitDispatcher`** (thread + notifications), invoked from `create` — orchestration stays in the service, never split into the route (§4d).
3. **[P1] Manual resend race closed.** The unique `idempotencyKey` stops duplicate *rows*, not concurrent *sends*. v2 adds a `SENDING` status + **atomic claim** (`UPDATE … WHERE status IN ('QUEUED','FAILED') RETURNING`) so two concurrent resends invoke the sender once (§3, §4d, §4f, test in §7).
4. **[P1] `/notifications` auth gating made explicit.** Mirrors `operators.ts:17-18`: `requireAuth()` for `/notifications` **and** `/notifications/*` **inside** `createNotificationRoutes` (not relying on `index.ts` app-level gates) (§4f).
5. **[P2] `OperatorRepository.findById` already exists** (`types.ts:53`, `findById(id)`, intentionally unscoped — scoping lives in `OperatorService`). v2 **drops the "add findById" task**; portal reads go through `OperatorService`, the dispatcher uses the repo with a system policy (§1, §4e).
6. **[P2] `waitUntil` durability claim softened.** The `QUEUED`/`SENDING` row is durable; the *send* is not auto-replayed after eviction. v2: MVP relies on **manual resend for stuck `QUEUED`/`SENDING`/`FAILED` rows**; cron/queue auto-retry is explicitly post-MVP (§10, §12).

---

## 0. What this slice is (and is not)

This is an **outbound-integration slice**: it adds a generic `EmailSender` port, one concrete adapter (Resend), two templated email kinds in three languages, a `notification_log` table, and a confirmation-page link to each operator's pre-auth URL. It is the *first* outbound side-effect to leave the API, so it also pays down the `TODO(#300)` outbox marker already sitting in `BookingService` (`packages/api/src/services/booking.ts:531`).

**Locked design (proposal §9 item 5 + §10 item 2, verbatim):** design `EmailSender` in `packages/api/src/services/email/` with methods like `sendBookingNotification(...)` / `sendBookingConfirmation(...)`; the concrete vendor (Resend for DX) is chosen here but **swap cost = one adapter class** — no vendor lock-in at any call site. Generic-by-design.

### Does NOT ship here (cross-slice boundaries — cite before you build)

| Not in slice 7 | Owned by | Why it matters |
|---|---|---|
| The booking DB transaction (availability validate → insert → first `booking_events` → fee snapshot) | **Slice 6 (#392)**, proposal §2 "Booking write boundary" + §10 item 14 | Slice 7 fires **after commit only**. We do not touch the transaction. |
| `bookings.booking_code`, `requested_vehicle_id`, `assigned_vehicle_id`, `insurance_option_id`, `insurance_snapshot`, `fee_snapshot`, `bookings.operatorId`, `booking_events` table | **Slice 6 (#392)**, proposal §5.1 step 4 + §9 item 3 | The notification payload **reads** these (now present on `marketplace-pivot` via `3f04b2b`); slice 7 does not write or alter them. See §1. |
| `operators.pre_auth_handoff_url` **column** | **Already merged (slice 1, #386)** | Verified present on `marketplace-pivot`. Slice 7 *consumes* it; does not add it. |
| Renter cancellation UI / auto-charge of fees | Post-MVP (proposal §9 items 7/19) | Confirmation email lists a cancellation contact + "potential additional charges" informationally only. |
| Operator-portal "manual resend" button beyond a basic action | This slice ships the API + a minimal portal surface; rich ops UI is slice 8 polish (proposal §8.2: "failed sends visible to operator with manual-resend button") |

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **Slice 6 (#392) merged to `marketplace-pivot`** | Slice 7's payload reads `booking_code`, `assigned_vehicle_id`, selected `insurance_snapshot`, `fee_snapshot`, `bookings.operatorId`. **Hard dependency** (proposal §6 "Depends on Slice 6"). | ✅ **MERGED 2026-06-06** (PR #469 squash `3f04b2b`). `bookings` now carries `bookingCode`/`operatorId`/`assignedVehicleId`/`insuranceSnapshot`/`feeSnapshot` + `booking_events`. **Note:** Slice 6 did **not** add a generic post-commit hook — `ensureThread` is still inline in `BookingService.create` (`booking.ts:209`). v2 introduces the dispatcher seam itself (§4d). |
| `operators` table + `pre_auth_handoff_url` column | Confirmation page + email link out to it. | **Merged** (#386). `OperatorRepository.findById(id)` **already exists** (`types.ts:53`, unscoped by design; scoping in `OperatorService`). Slice 7 **reuses** it — does **not** add it (§4e). |
| `CallerContext.operatorId` / `bypassScope` (#386/#401) | `notification_log` reads are operator-private (§6.2 scoping). | Merged on pivot. |
| Resend account + `RESEND_API_KEY` secret provisioned | Adapter needs a key; absent → dev stub / prod sentinel (mirrors `GoogleTranslationProvider`). | Provision before the integration test against the real boundary; unit tests inject a fake `fetchFn`. |
| `EMAIL_FROM` / `WEB_PUBLIC_ORIGIN` env | `From:` address + absolute links in emails (emails can't use relative URLs). | Add to `.dev.vars` + GitHub Secrets at kickoff. |

If slice-6 contract *names* differ at kickoff, slice 7 adapts its own PR — never silently change a landed slice's behavior (slice-4 precedent). **Carve-out (architect P1):** consolidating the inline `ensureThread` calls into `BookingPostCommitDispatcher` is **not** a forbidden refactor — slice 6's own `TODO(#300)` (`booking.ts:531`) authored the extension point: *"if a second post-booking side effect appears here, extract an outbox/event dispatcher rather than chaining another inline hook."* Thread-creation behavior is preserved (still post-commit, awaited); only the call site moves. Cover it with the §7 `BookingPostCommitDispatcher` test so the slice-6 behavior is pinned.

---

## 2. The canonical pattern this slice mirrors

The codebase already has the **exact interface → adapter → composition-root DI** shape we need: `TranslationProvider` (port) → `GoogleTranslationProvider` (REST adapter with timeout + retry + injectable `fetchFn`) → wired in `index.ts` with a prod sentinel + dev stub. `EmailSender` is the same shape for a different verb.

| Existing artifact (reference, do not edit) | Slice-7 analog |
|---|---|
| `services/translation-provider.ts` — `TranslationProvider` port | `services/email/email-sender.ts` — `EmailSender` port |
| `services/google-translation-provider.ts` — REST adapter, 3s `AbortSignal.timeout`, single retry on 5xx/network, `fetchFn` injected (`#336`) | `services/email/resend-email-sender.ts` — same resilience shape against Resend's `POST /emails` |
| `index.ts:206-222` — provider chosen by env key; prod sentinel throws on use, dev stub returns a marker | `index.ts` — `EmailSender` chosen by `RESEND_API_KEY`; prod sentinel + dev console stub |
| `BookingService.ensureThread` (`#335` auto-thread-on-confirm) + `TODO(#300)` outbox marker | `NotificationDispatcher` — the second post-commit side effect; extract the outbox the TODO predicted |
| `MessageTranslationService` returns `{ ok: true|false, status }`; route maps to HTTP | `NotificationService` returns the same discriminated result for the resend route |

**Boundary reminder (AGENTS.md):** routes → services → repositories, never backwards. `EmailSender` is an **interface in `services/`** with the concrete `ResendEmailSender` constructed **only in `index.ts`**. `packages/shared` gains **no runtime dep** (templates render in the API, not shared). `packages/web` gets **no DB access** — it reads the operator's pre-auth URL via the booking read model the API already returns.

> **Learn: Hexagonal Boundary / DIP.** `EmailSender` is a port; `ResendEmailSender` is the only adapter; the only `new ResendEmailSender(...)` lives in the composition root. The service layer never imports `resend` or names a vendor. Heuristic: *if a service file says `import { Resend }` or `require('resend')`, the adapter leaked into the core — inject the port instead.*

---

## 3. Schema — `notification_log` (`packages/shared/src/db/schema.ts`)

One table, claim-then-update lifecycle. A row is **inserted `QUEUED`**; the dispatcher/resend path **atomically claims it to `SENDING`** before the send, then updates `SENT`/`FAILED` after. The atomic claim — not just the unique key — is what makes two concurrent sends of the same row invoke the provider exactly once (architect P1).

**Claim predicate (single definition — used by both dispatch and resend):**
```sql
UPDATE notification_log
   SET status = 'SENDING', updatedAt = now(), attempts = attempts + 1
 WHERE id = $1
   AND ( status IN ('QUEUED', 'FAILED')
      OR (status = 'SENDING' AND updatedAt < now() - $SEND_LEASE) )   -- expired lease only
 RETURNING *;
```
`SEND_LEASE` is a named constant (start **5 minutes**). A claim that returns **no row** means another sender holds a *live* lease → skip (this is the concurrent-send guard). A crash mid-send leaves a `SENDING` row that is **only** reclaimable once its lease expires — never a fresh one (architect P1: *reclaim only leases that have expired*, else reclaiming `SENDING` is itself a double-send). There is no automatic replay in MVP; the operator's manual resend (or a future cron) re-claims expired `SENDING`/`FAILED`/`QUEUED` (§10, §12).

```ts
export const notificationKindEnum = pgEnum('notification_kind', [
  'OPERATOR_BOOKING_ALERT',   // -> operator: a booking landed
  'RENTER_BOOKING_CONFIRM',   // -> renter: confirmation + pre-auth link
])
// SENDING is the in-flight lease between QUEUED and SENT/FAILED — it closes the
// concurrent-send race (atomic claim, architect P1). Reclaimable ONLY after the
// SEND_LEASE expires (see claim predicate above); SENT is terminal.
export const notificationStatusEnum = pgEnum('notification_status', ['QUEUED', 'SENDING', 'SENT', 'FAILED'])

export const notificationLog = pgTable('notification_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookingId: text('bookingId').notNull().references(() => bookings.id),
  // Tenant owner — every notification belongs to exactly one operator, so
  // operator-portal reads can scope by operatorId without a join (§6.2).
  operatorId: text('operatorId').notNull().references(() => operators.id),
  kind: notificationKindEnum('kind').notNull(),
  channel: text('channel').notNull().default('EMAIL'),  // future: SMS/LINE without schema churn
  recipient: text('recipient').notNull(),               // resolved address at claim time (§4d recipient resolution)
  locale: text('locale').notNull(),                     // en | ja | zh chosen for this send
  status: notificationStatusEnum('status').notNull().default('QUEUED'),
  providerMessageId: text('providerMessageId'),         // Resend id on success (audit / dedupe)
  error: text('error'),                                 // last failure reason (truncated)
  attempts: integer('attempts').notNull().default(0),
  // Idempotency: one logical notification per (booking, kind). The dispatcher
  // upserts on this key so a post-commit replay never double-sends. Mirrors the
  // `booking:<id>` thread idempotency key in ensureThread (#335).
  idempotencyKey: text('idempotencyKey').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_notification_log_bookingId').on(t.bookingId),
  // operator-portal list scopes on operatorId (§6.2); also covers the operatorId FK.
  index('idx_notification_log_operatorId').on(t.operatorId),
  unique('notification_log_idempotency_unique').on(t.idempotencyKey),
])
```

**`idempotencyKey` format:** `notify:<bookingId>:<kind>` (e.g. `notify:<uuid>:RENTER_BOOKING_CONFIRM`). One renter-confirm + one operator-alert per booking. A second post-commit dispatch (replay) finds the `SENT` row and no-ops, **or repairs a row that was never created/sent** (idempotency-replay repair, §4d / P1c); a `FAILED`/`QUEUED`/expired-`SENDING` row is what the claim predicate re-attempts.

**Migration workflow (CLAUDE.md drizzle rules — non-negotiable):**
```bash
bun run db:generate --name add_notification_log
bun run db:migrate
bun run db:verify          # 3 green checks
```
Regenerate on top of slice-6's migrations after rebase (journal `when` must stay monotonic — CLAUDE.md 2026-04-17 trap). Never hand-edit `_journal.json` unless cherry-picking, then bump `when` to `max(prev)+1`.

**No schema change to `operators`** — `pre_auth_handoff_url` already exists (§1).

---

## 4. API layer

### 4a. `EmailSender` port — `services/email/email-sender.ts`

```ts
export interface EmailMessage {
  to: string
  from: string
  subject: string
  html: string
  text: string          // plain-text fallback; deliverability + screen readers
  replyTo?: string
}
export interface SendResult { providerMessageId: string }

/**
 * Provider-agnostic outbound email port. Implementations call a vendor
 * (Resend, SES, Postmark…); the service layer depends on this interface so
 * the vendor swaps at the composition root. Throws on provider failure —
 * the dispatcher catches, logs FAILED, and never rolls back the booking.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>
}
```

### 4b. `ResendEmailSender` adapter — `services/email/resend-email-sender.ts`

REST against `POST https://api.resend.com/emails` (NOT the npm SDK — keeps the CF Workers bundle lean and matches the REST-over-SDK choice in `GoogleTranslationProvider`). Same resilience contract as `#336`:
- `AbortSignal.timeout(TIMEOUT_MS)` (start 5000ms — email is less latency-sensitive than translate);
- single retry on network error / 5xx; 4xx returns immediately (caller error, e.g. bad address);
- `fetchFn: typeof fetch = fetch` injected so unit tests assert the request without a network call;
- maps the Resend `{ id }` response to `SendResult.providerMessageId`; throws a typed error with the Resend message on `!ok`.

### 4c. Templates — `services/email/templates/`

`packages/shared` stays runtime-dep-free (AGENTS.md), so **templates live in the API**, not shared. Strategy:

- A pure render function per kind: `renderRenterConfirmation(data, locale)` and `renderOperatorAlert(data, locale)` returning `{ subject, html, text }`.
- **i18n source:** a single `templates/messages/{en,ja,zh}.ts` map keyed by template + field (subject lines, labels, the "potential additional charges" heading, cancellation-contact line). Keep it co-located and typed — these are *outbound* strings, distinct from the web `next-intl` namespaces, so they do not need a dev-server restart. **Do not** reach into `packages/web/messages/*.json` from the API (boundary violation).
- Renderers are **pure** (data in → strings out) → unit-testable with zero I/O.

> **Learn: Functional Core / Imperative Shell.** Template rendering is the pure core (deterministic strings); `EmailSender.send` is the imperative shell (network). Keeping them split means template assertions need no mock at all. Heuristic: *if a "render" function awaits anything, a side effect leaked into the core.*

**Locale selection:** renter email uses `users.language` (the renter's stored language, already on the booking's renter); operator email uses the operator's display language (en/ja per §8.2 NFR — zh optional for operator). Fallback chain `requested → en`.

**Payload fields:** `booking_code`, vehicle make/model/plate (assigned vehicle), pickup/return **location names** (resolved via `locationRepo` from the booking's location IDs — §4d, P2e) + datetimes, operator name, selected `insurance_snapshot`, **operator `pre_auth_handoff_url`** (renter email + confirmation page), and the `fee_snapshot` "potential additional charges" block (proposal §9 item 19 — informational only). All assembled by the dispatcher; the renderers stay pure (data in → strings out).

### 4d. Post-commit seam: `BookingPostCommitDispatcher` (architect P1) + `NotificationDispatcher` + `NotificationService`

**The seam (decided, not hedged).** Verified against `3f04b2b`: Slice 6 calls `ensureThread` **inline in `BookingService.create`** at three sites (`booking.ts:192/209/231`) and added **no** generic hook. The `TODO(#300)` (`booking.ts:531`) predicted exactly this: *"if a second post-booking side effect appears here, extract an outbox/event dispatcher rather than chaining another inline hook."* That condition is now true (thread + email), so v2:

- Extracts a **`BookingPostCommitDispatcher`** (`services/booking-post-commit-dispatcher.ts`) that runs the booking's post-commit side effects in order: (1) `ensureThread`, (2) `NotificationDispatcher.dispatch(booking)`. `BookingService.create` calls `await this.postCommit.run(ctx, booking)` at **every site where `ensureThread` runs today — not just the fresh-create path** (architect P1c). Verified the three sites: fresh create (`booking.ts:209`), idempotency replay of an existing booking (`:192`), and the idempotency-key race winner (`:231`). The two replay paths **must** keep firing so a booking whose first post-commit attempt half-failed (thread made, email not) is **repaired on replay**. This is safe because every side effect is idempotent: `ensureThread` keys on `booking:<id>`; notifications upsert on `notify:<bookingId>:<kind>` and skip `SENT`. **Orchestration stays in the service — never split into the route** (the failure mode the architect flagged).
- It is **awaited in the service**, consistent with how `ensureThread` is awaited today. The service stays CF-Workers-agnostic — we do **not** leak `c.executionCtx` into the service layer (that would be a hexagonal boundary violation). Trade-off: a successful renter+operator send adds the Resend round-trip (~200-500ms) to the booking response. Accepted for MVP; if latency bites, introduce a **scheduler port** (`Deferrer.defer(fn)`) injected at the composition root so the route can pass `waitUntil` *without* the service knowing about CF — **not** by moving the call into raw route code (§12).
- **Never throws back into the booking path** — each side effect is caught-and-logged; the booking is authoritative, exactly like `ensureThread` today.

**`NotificationDispatcher`** (`services/notification-dispatcher.ts`) — constructor deps: `notificationLogRepo, operatorRepo, vehicleRepo, userRepo, locationRepo, emailSender` (+ `OPERATOR_ALERT_FALLBACK_EMAIL`/`EMAIL_REPLY_TO`/`EMAIL_FROM`). `locationRepo` is **required** (architect P2e): the booking row carries only `pickupLocationId`/`dropoffLocationId` (`booking.ts:35-36`), so the dispatcher resolves the two location **names** for the email — customer-facing mail must show names, not IDs. Per kind:
  1. **Resolve the recipient** (see below) and locale, then build the payload (read `operatorRepo.findById`, `vehicleRepo`, `locationRepo`, the booking's `insuranceSnapshot`/`feeSnapshot`);
  2. **Upsert** a `QUEUED` row by `notify:<bookingId>:<kind>` (no-op if already `SENT`), persisting the resolved `recipient`;
  3. **Atomically claim** the row to `SENDING` using the **single claim predicate from §3** (incl. the expired-lease branch); if the claim returns no row, a live lease holds it → skip (concurrent-send guard, architect P1);
  4. `await emailSender.send(...)`; on success → `SENT` + `providerMessageId`; on throw → `console.error` (structured) + `FAILED` + `error` (`attempts` already bumped by the claim).

**Recipient resolution (architect P1a) — `notification_log.recipient` is now sourced explicitly:**
  - `RENTER_BOOKING_CONFIRM` → the booking renter's email (`userRepo.findByIds([renterId])`).
  - `OPERATOR_BOOKING_ALERT` → the operator's owner. Add a **scoped** `UserRepository.findOperatorContacts(operatorId)` returning that operator's **`OPERATOR_OWNER`** users — a fixed-purpose **platform-internal** read over the indexed `users.operatorId` (`idx_users_operatorId`); it is **not** a caller-facing lookup, so it does **not** reopen the #396 renter-enumeration vector. Dispatcher uses the **first owner's email**; if the operator has no owner user, fall back to `OPERATOR_ALERT_FALLBACK_EMAIL ?? EMAIL_REPLY_TO ?? EMAIL_FROM` (a platform ops inbox). **MVP is owner-only — do NOT build an `OPERATOR_STAFF` fallback.** Owner+staff fan-out (and multi-recipient) is post-MVP (today: one row, one address per booking-kind).

**`NotificationService`** (`services/notification.ts`) backs the operator-portal **list** (`findAll(ctx, { bookingId? })`, operator-scoped, management-read guarded) + **manual resend** (`resend(ctx, notificationId)` → runs the same claim→send→update path for that one row, returns `{ ok, status }`). Because resend shares the §3 claim predicate, two concurrent resends of one row send once, and a stuck `SENDING` is reclaimed only after its lease expires.

### 4e. Operator lookup — reuse the existing `OperatorRepository.findById(id)` (architect P2)

**Corrected from v1.** `OperatorRepository.findById(id)` **already exists** (`types.ts:53`) and is intentionally **unscoped** — the comment there is explicit: *"Access is decided in `OperatorService` (operator may only read its own); the repo is unscoped."* So slice 7 adds **nothing** to the operator repo. Two consumers, two policies:

- **Dispatcher (post-commit, platform-internal):** calls `operatorRepo.findById(booking.operatorId)` **directly** to read `name` + `preAuthHandoffUrl` for the email payload. It runs on the platform's behalf for a booking that already passed tenant checks at create — no caller scoping needed, so it uses the repo, not the scoped service.
- **Operator-portal reads:** go through **`OperatorService`** (the existing scope gate: an operator may only resolve its own row). Slice 7 does not bypass that.

### 4f. Routes — `routes/notifications.ts`

**Auth gating is in-route (architect P1), mirroring `operators.ts:17-18`** — do **not** rely on the `index.ts` app-level allow-list, which only gates *known* paths (`index.ts:342-347`) and would silently leave a new mount open:
```ts
app.use('/notifications', requireAuth())
app.use('/notifications/*', requireAuth())   // requireUser() in each handler is the 401 backstop
```

- `GET /notifications?bookingId=` — operator-scoped list (management-read guard rejects `RENTER`/`PARTNER`; bypass callers need explicit `?operatorId=` or `?includeAll=true`, mirroring slice 4 §2). For the operator portal badge (proposal §4 business item 8).
- `POST /notifications/:id/resend` — manual resend; cross-operator id → **404 not 403** (no tenant-existence leak). Goes through `NotificationService.resend`, which performs the **atomic `SENDING` claim** (§4d) so a double-click / concurrent retry sends once. Uses `ok()`/`fail()` from `routes/helpers.ts`. Gated on management roles.

Mounted at `/` in `index.ts` (with the two in-route `requireAuth()` gates above living inside `createNotificationRoutes`).

### 4g. Composition root — `index.ts`

Add, mirroring the `translationProvider` block (`index.ts:206-222`):
```ts
const emailSender: EmailSender = (() => {
  const key = process.env.RESEND_API_KEY
  if (key) return new ResendEmailSender(key, process.env.EMAIL_FROM ?? '')
  if (process.env.NODE_ENV === 'production') {
    return { send: async () => { throw new Error('RESEND_API_KEY not configured') } }
  }
  return { send: async (m) => { console.info('[email:dev]', m.to, m.subject); return { providerMessageId: 'dev' } } }
})()
```
Construct `NotificationDispatcher(notificationLogRepo, operatorRepo, vehicleRepo, userRepo, locationRepo, emailSender, { fallbackOperatorEmail: process.env.OPERATOR_ALERT_FALLBACK_EMAIL ?? process.env.EMAIL_REPLY_TO ?? process.env.EMAIL_FROM })` (note `locationRepo` — P2e), then `BookingPostCommitDispatcher(threadDeps, notificationDispatcher)`, and inject **that** into `BookingService` (replacing the inline `ensureThread` wiring). Construct `NotificationService(notificationLogRepo, emailSender, …)` and `.route('/', createNotificationRoutes(notificationService))`. Add `notificationLogRepo` to the `overrides` test surface (InMemory) like every other repo.

### 4h. Booking read-model — renter-safe `operator` projection (architect P1)

The web confirmation page needs `pre_auth_handoff_url`, but it has **no DB access** and `/operators/:id` is management-gated (`operators.ts:17` rejects renters). Merged `GET /bookings/:id` returns the bare booking row (`bookings.ts:64`, `ok(c, booking)`). So v2 extends the **booking read model**, not the operator route:

- `BookingService.findById` attaches a **renter-safe projection** — `operator: { name, preAuthHandoffUrl }` (only those two fields; never the full operator row) — by reading `operatorRepo.findById(booking.operatorId)`. The renter already owns this booking, so exposing their operator's public handoff URL + name leaks nothing cross-tenant.
- Shape: `GET /bookings/:id` → `{ ...booking, operator: { name, preAuthHandoffUrl: string | null } }`. The web reads `booking.operator.preAuthHandoffUrl`; `null` → hide the CTA (§5.1).
- **Test:** `GET /bookings/:id` for the booking owner includes `operator.preAuthHandoffUrl` with the exact value; a `RENTER` who is **not** the owner still 404s (slice-6 scope unchanged); the projection never includes operator fields beyond `name`/`preAuthHandoffUrl`.

---

## 5. Web layer — confirmation page links to pre-auth

`packages/web/src/app/[locale]/bookings/confirmation/page.tsx` currently renders booking id (`booking.id.slice(0, 8)` → becomes `booking_code` post-slice-6), class, dates, status. Slice 7 adds (proposal §4 renter item 5):

1. **Pre-auth handoff CTA** — a prominent button linking to `booking.operator.preAuthHandoffUrl` (the renter-safe projection from §4h; absolute, external → plain `<a href target="_blank" rel="noopener noreferrer">`, **not** the i18n `Link`). Web has **no DB access** (AGENTS.md) — it consumes only the booking read model. If `preAuthHandoffUrl` is `null`, hide the CTA (don't render a dead link). **Confirmation-page test:** renders the CTA with the exact URL when present; omits it entirely when `null`.
2. **"Potential additional charges" block** — render `fee_snapshot` rows (overtime/hour, cleaning, no-fuel) informational only (proposal §9 item 19). Slice 6 surfaces the snapshot; slice 7 ensures the email mirrors the page.
3. Copy that explains the pre-auth step (risk §8.1: "Pre-auth handoff UX confuses tourists" — confirmation page must explain it).

**i18n:** extend the existing `bookings.confirmation` namespace in `packages/web/messages/{en,ja,zh}.json` with `preAuthTitle`, `preAuthExplain`, `preAuthCta`, `potentialChargesTitle`, `cancellationContact`. New keys in an existing namespace **do not** need a dev-server restart (a *new namespace* would — CLAUDE.md). **Verify all three locales have every key** (CLAUDE.md: merges silently drop keys; `lint` parity check at `chore/i18n-parity-lint` enforces).

---

## 6. Tenant scoping (proposal §6.2)

`notification_log` is **operator-private** — same posture as insurance/fees in slice 4:
- Reads gated by a **management-read guard** (reject `RENTER` + `PARTNER`) *then* `operatorReadScope`: operator callers see only their `operatorId` rows; bypass callers (`PLATFORM_ADMIN` + legacy `STAFF`/`ADMIN`) see across, gated on `ctx.bypassScope === true` (not the role string).
- The renter never reads `notification_log` via the portal — the renter sees the confirmation **page/email**, not the log.
- The dispatcher writes with the booking's `operatorId` (from the slice-6 booking row) — no cross-tenant write possible.

---

## 7. Tests (TDD vertical-slice, mutation-resistant; mock only the HTTP boundary to Resend)

Per proposal §6.1: E2E required green for slice 7. Mock **only** the Resend HTTP boundary (inject `fetchFn`); no internal mocks.

| Layer | What it asserts |
|---|---|
| **Template renderers** (pure, `packages/api/tests/services/email/`) | `renderRenterConfirmation` includes `booking_code`, selected `insurance_snapshot`, the **exact** `pre_auth_handoff_url`, the resolved pickup/return **location names** (not IDs — P2e), and each `fee_snapshot` line; `ja`/`zh` produce localized subject lines (specific string match, not "truthy"); `text` fallback non-empty; missing pre-auth URL omits the CTA line. |
| **`ResendEmailSender`** (inject fake `fetchFn`) | Posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>` + correct JSON body; maps `{ id }` → `providerMessageId`; **retries once on 5xx/network, NOT on 4xx**; `AbortSignal` present (mirror `#336` translate-timeout tests). |
| **`NotificationDispatcher`** (InMemory log + fake sender) | `QUEUED` → atomic claim `SENDING` → `SENT` with `providerMessageId`; on sender throw → `FAILED` + `error`, **booking unaffected**; replay with same booking → idempotent (no second `SENT`, send not called twice); **two concurrent `dispatch` for the same row → sender invoked exactly once** (claim race, architect P1); **a fresh `SENDING` row is NOT reclaimed** (live lease → skip, no send) but an **expired `SENDING` IS reclaimed** (lease boundary, P1b); writes the booking's `operatorId`. |
| **Recipient resolution (architect P1a)** | `RENTER_BOOKING_CONFIRM` → renter email; `OPERATOR_BOOKING_ALERT` → operator's **first `OPERATOR_OWNER`** email via `findOperatorContacts`; **operator with no owner user → falls back to `OPERATOR_ALERT_FALLBACK_EMAIL`** (no `OPERATOR_STAFF` fallback); resolved address is persisted to `notification_log.recipient`. `findOperatorContacts` returns only that operator's `OPERATOR_OWNER` users (scoping test — no cross-operator leak). |
| **`BookingPostCommitDispatcher`** (fake thread + fake notification dispatcher) | runs `ensureThread` **then** notifications; a throw in either side effect is caught — `create` still returns the committed booking (booking authoritative); **runs on the idempotency-replay path too — a replay of a booking whose notification row is missing/`FAILED` repairs it (creates+sends); a replay where it is `SENT` does not resend** (P1c repair-on-replay). |
| **Booking read-model `operator` projection** (architect P1; Drizzle on Neon `test` + InMemory) | `GET /bookings/:id` for the owner returns `operator: { name, preAuthHandoffUrl }` with the **exact** URL; projection excludes all other operator fields; non-owner `RENTER` → 404 (slice-6 scope intact); `null` handoff URL passes through as `null`. |
| **`NotificationService` + routes** | resend re-sends a `FAILED` row → `SENT`; **two concurrent resends of one row → sender once** (atomic claim); unauthenticated → **401** (in-route `requireAuth`, architect P1); `RENTER`/`PARTNER` read → 403; cross-operator resend id → 404; bypass list without `operatorId`/`includeAll` → 400. |
| **Drizzle `notification_log`** (Neon `test`) | FK on `bookingId`/`operatorId`; second insert of same `idempotencyKey` → 23505 (proves idempotency seal). |
| **E2E (Playwright, proposal §6.1)** | renter search → book → **confirmation page shows selected insurance + pre-auth CTA + potential charges**; operator portal shows a notification row. Resend HTTP boundary mocked. Test viewports per §8.2 (mobile-first). |

---

## 8. Per-slice merge gate (proposal §6.1)

All green before merge: `bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` (port/adapter direction — this slice is the litmus test for it) · `bun run lint:modules` · `bun run db:verify` · E2E happy path · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 9. Execution order & worktree

```bash
# Branch from the remote pivot; local marketplace-pivot is known to lag.
git worktree add ../kuruma-notifications -b feature/393-notifications-preauth origin/marketplace-pivot
```
Within the worktree (TDD RED→GREEN per slice, one behavior at a time):
1. `notification_log` migration → `db:verify` (3 green).
2. `EmailSender` port + template renderers (RED template tests first — pure, fast).
3. `ResendEmailSender` adapter (RED: fake `fetchFn` asserts request + retry).
4. `notificationLog` repo pair (InMemory → Drizzle integration).
5. Booking read-model `operator: { name, preAuthHandoffUrl }` projection in `BookingService.findById` (§4h) + scoped `UserRepository.findOperatorContacts(operatorId)` for recipient resolution (§4d). *(v1's "add `OperatorRepository.findById`" step is deleted — it already exists.)*
6. `NotificationDispatcher` (with `locationRepo` + recipient resolution) + `BookingPostCommitDispatcher` + `NotificationService`.
7. Wire DI in `index.ts` + inject `BookingPostCommitDispatcher` into `BookingService` (replacing the inline `ensureThread` calls at all three sites) — **service-level seam, not the route**.
8. `routes/notifications.ts` (list + resend, in-route `requireAuth`).
9. Web: confirmation-page selected-insurance summary + pre-auth CTA + potential-charges block + i18n keys (en/ja/zh, verify parity).
10. E2E happy path.
11. Review → rebase onto `origin/marketplace-pivot` (regenerate migration if journal moved) → PR (`Closes #393`).

---

## 10. Risks (proposal §8.1)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ~~Slice 6 not merged~~ — **RESOLVED** | — | — | ✅ Merged `3f04b2b` (2026-06-06). Payload fields present. Seam built by this slice (§4d), not inherited. |
| Email side effect leaks into the booking transaction | Low | High | `BookingPostCommitDispatcher` runs **after commit, awaited in the service** (CF-agnostic — no `executionCtx` leak); proposal §2/§10.14; test asserts booking succeeds when sender throws. |
| Booking response latency from awaited send (~200-500ms) | Medium | Low | Accepted for MVP; if it bites, inject a `Deferrer` scheduler port at the composition root (route supplies `waitUntil`) — never move the call into route code (§4d/§12). |
| Stuck `SENDING`/`QUEUED` after worker eviction (no auto-replay) | Low | Low | MVP: operator **manual resend** re-claims stuck rows — but **only after the `SEND_LEASE` expires** (§3), so a still-in-flight send is never duplicated (architect P1b). `waitUntil` does not auto-retry; cron/queue auto-retry is post-MVP. |
| Operator-alert recipient unknown (no contact field) — **resolved** | (was undefined in v2) | High | `UserRepository.findOperatorContacts(operatorId)` → `OPERATOR_OWNER` email; fallback `OPERATOR_ALERT_FALLBACK_EMAIL ?? EMAIL_REPLY_TO ?? EMAIL_FROM` (§4d, architect P1a). Scoped internal read — does not reopen #396. |
| Pre-auth CTA has no read path to the URL | (was unscoped in v1) | Medium | Renter-safe `operator.preAuthHandoffUrl` projection on the booking read model (§4h); not via the management-gated `/operators/:id`. |
| Resend free-tier limit (3k/mo) | Low | Low | Free tier covers MVP + early ops; upgrade $20/mo later (proposal §8.1). |
| Double-send on **replay** (sequential) | Medium | Medium | `idempotencyKey` unique on `notify:<bookingId>:<kind>`; dispatcher skips `SENT`; integration test asserts 23505 + no second send. |
| Double-send on **concurrent** dispatch/resend (architect P1) | Medium | Medium | The single §3 claim predicate (`status IN ('QUEUED','FAILED') OR expired-`SENDING``) — the unique key alone does **not** stop two sends of one existing row; test: two concurrent resends → sender once; fresh `SENDING` not reclaimed, expired `SENDING` reclaimed. |
| Pre-auth handoff UX confuses tourists | Medium | Medium | Confirmation page explains the step (proposal §8.1); email reinforces; copy reviewed with Du. |
| Vendor lock-in creeps into call sites | Low | Medium | `lint:boundaries` + the port/adapter split; no `resend` import outside `resend-email-sender.ts` + `index.ts`. |
| i18n key drift across en/ja/zh | Medium | Low | `chore/i18n-parity-lint` parity check; verify all three before merge (CLAUDE.md). |
| Failed send invisible to operator | Low | Medium | `notification_log` `FAILED` rows surfaced in operator portal + manual-resend route (proposal §8.2 / §9 item 17). |

---

## 11. Critical files

**New (API):** `services/email/email-sender.ts`, `services/email/resend-email-sender.ts`, `services/email/templates/{renter-confirmation,operator-alert}.ts`, `services/email/templates/messages/{en,ja,zh}.ts`, `services/notification-dispatcher.ts`, `services/notification.ts`, **`services/booking-post-commit-dispatcher.ts`** (architect P1 — consolidates `ensureThread` + notifications), `repositories/{drizzle,in-memory}/notification-log.ts`, `routes/notifications.ts`.
**Modify (API):** `schema.ts` (`notification_log` + enums incl. **`SENDING`**), `repositories/types.ts` (`NotificationLogRepository` + **`UserRepository.findOperatorContacts(operatorId)`** for recipient resolution — P1a; **no** `OperatorRepository` change, `findById` already exists), `repositories/{drizzle,in-memory}/user.ts` (implement `findOperatorContacts`), `services/booking.ts` (inject `BookingPostCommitDispatcher`, replacing the 3 inline `ensureThread` calls; **attach `operator: { name, preAuthHandoffUrl }` in `findById`** — §4h), `index.ts` (DI: dispatcher gets `locationRepo` + fallback email — P2e/P1a; route mount + overrides), new migration in `drizzle/`. **No change to** `repositories/{drizzle,in-memory}/operator.ts` or `routes/bookings.ts` (read model shape comes from the service).
**Modify (web):** `app/[locale]/bookings/confirmation/page.tsx`, `messages/{en,ja,zh}.json` (`bookings.confirmation.*` keys), operator-portal notifications surface (minimal — badge/list; rich UI = slice 8).
**Env:** `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, optional **`OPERATOR_ALERT_FALLBACK_EMAIL`** (operator-alert fallback inbox — P1a), `WEB_PUBLIC_ORIGIN` (`.dev.vars` + GitHub Secrets; never hardcode — security rule). `SEND_LEASE` is a code constant (5 min), not env.

---

## 12. Resolved decisions (v2 — verified against merged `3f04b2b`)

1. **Post-commit seam shape (architect P1 / P1c).** Slice 6 added **no** hook — `ensureThread` is inline in `BookingService.create` at **three** sites. Decision: **extract a `BookingPostCommitDispatcher` in the service** (thread + notifications), invoked at **all three** sites (fresh create + both idempotency-replay/race paths), awaited — so replays **repair** half-completed side effects (idempotent). Orchestration stays in the service; **never** invoked from raw route code. The service stays CF-agnostic (no `executionCtx`).
2. **Operator alert locale.** Default operator alerts to `ja` with `en` fallback unless a landed operator-language field exists. Do not add `operators.language` in slice 7.
3. **Awaited send vs `waitUntil` (architect P2).** MVP **awaits** the send in the service (consistent with `ensureThread`; ~200-500ms added to the booking response — accepted). `waitUntil` is **deferred** and, when added, comes via an injected `Deferrer` scheduler **port** — not by leaking `executionCtx` into the service. Durability is the `QUEUED`/`SENDING` row + **manual resend**, not `waitUntil` (which does not auto-replay); cron/queue auto-retry is post-MVP.
4. **Reply-to / cancellation contact.** Use `EMAIL_REPLY_TO` when configured, otherwise `EMAIL_FROM`, as the MVP cancellation-contact/reply-to address. Do not add an operator contact-email column in slice 7.
5. **`OperatorRepository.findById` (architect P2).** Already exists (`types.ts:53`); reused, not added. Portal reads via `OperatorService` (scoped); dispatcher uses the repo directly (platform-internal).
6. **Operator-alert recipient (architect P1a) — green-lit owner-only.** Resolve via a new scoped `UserRepository.findOperatorContacts(operatorId)` → **first `OPERATOR_OWNER` email**; if no owner, fall back to `OPERATOR_ALERT_FALLBACK_EMAIL ?? EMAIL_REPLY_TO ?? EMAIL_FROM`. **No `OPERATOR_STAFF` fallback in MVP.** One recipient per `(booking, kind)`; owner+staff / multi-recipient fan-out is post-MVP. Renter recipient = the booking renter's email. No new `operators`/`users` column.
7. **Stuck-`SENDING` reclaim needs a lease (architect P1b).** A single claim predicate (§3) reclaims `QUEUED`/`FAILED` **and** `SENDING` whose `updatedAt` is older than `SEND_LEASE` (5 min). A live `SENDING` is never reclaimed — that would itself be a double-send. *Learn — Check-Then-Act Race: claim rows atomically; reclaim only leases that have expired.*
