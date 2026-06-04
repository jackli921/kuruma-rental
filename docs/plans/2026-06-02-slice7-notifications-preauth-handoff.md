# Slice 7 — Outbound Notifications & Pre-Auth Handoff (issue #393)

**Date:** 2026-06-02
**Status:** Draft v1 — awaiting green light to create worktree + start TDD
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6 row 7; §4 business item 8 + renter items 5/6; §9 items 2/5/17; §10 item 2; §8.1 Resend/pre-auth risks; §8.2 notification-delivery NFR)
**Format mirror:** `docs/plans/2026-06-02-slice4-insurance-pricing-fees.md`
**Supersedes:** the thin body of #393 (insufficient detail for AFK implementation)

---

## 0. What this slice is (and is not)

This is an **outbound-integration slice**: it adds a generic `EmailSender` port, one concrete adapter (Resend), two templated email kinds in three languages, a `notification_log` table, and a confirmation-page link to each operator's pre-auth URL. It is the *first* outbound side-effect to leave the API, so it also pays down the `TODO(#300)` outbox marker already sitting in `BookingService` (`packages/api/src/services/booking.ts:234`).

**Locked design (proposal §9 item 5 + §10 item 2, verbatim):** design `EmailSender` in `packages/api/src/services/email/` with methods like `sendBookingNotification(...)` / `sendBookingConfirmation(...)`; the concrete vendor (Resend for DX) is chosen here but **swap cost = one adapter class** — no vendor lock-in at any call site. Generic-by-design.

### Does NOT ship here (cross-slice boundaries — cite before you build)

| Not in slice 7 | Owned by | Why it matters |
|---|---|---|
| The booking DB transaction (availability validate → insert → first `booking_events` → fee snapshot) | **Slice 6 (#392)**, proposal §2 "Booking write boundary" + §10 item 14 | Slice 7 fires **after commit only**. We do not touch the transaction. |
| `bookings.booking_code`, `requested_vehicle_id`, `assigned_vehicle_id`, `insurance_option_id`, `insurance_snapshot`, `fee_snapshot`, `bookings.operatorId`, `booking_events` table | **Slice 6 (#392)**, proposal §5.1 step 4 + §9 item 3 | The notification payload reads these. **They are NOT on `marketplace-pivot` yet** (verified: `bookings` still has the legacy single-`vehicleId` shape). See §1 preconditions. |
| `operators.pre_auth_handoff_url` **column** | **Already merged (slice 1, #386)** | Verified present on `marketplace-pivot`. Slice 7 *consumes* it; does not add it. |
| Renter cancellation UI / auto-charge of fees | Post-MVP (proposal §9 items 7/19) | Confirmation email lists a cancellation contact + "potential additional charges" informationally only. |
| Operator-portal "manual resend" button beyond a basic action | This slice ships the API + a minimal portal surface; rich ops UI is slice 8 polish (proposal §8.2: "failed sends visible to operator with manual-resend button") |

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **Slice 6 (#392) merged to `marketplace-pivot`** | Slice 7's payload reads `booking_code`, `assigned_vehicle_id`, selected `insurance_snapshot`, `fee_snapshot`, `bookings.operatorId`, and fires off the post-commit hook slice 6 introduces. **Hard dependency** (proposal §6 "Depends on Slice 6"). | **Not started.** `bookings` on `marketplace-pivot` is still the legacy shape — no `bookingCode`/`operatorId`/`insuranceSnapshot`/`feeSnapshot`/event log. **This slice cannot start until #392 lands.** |
| `operators` table + `pre_auth_handoff_url` column | Confirmation page + email link out to it. | **Merged** (#386). `OperatorRepository` exists with `create`/`existsBySlug` only — slice 7 **adds `findById`** (§4). |
| `CallerContext.operatorId` / `bypassScope` (#386/#401) | `notification_log` reads are operator-private (§6.2 scoping). | Merged on pivot. |
| Resend account + `RESEND_API_KEY` secret provisioned | Adapter needs a key; absent → dev stub / prod sentinel (mirrors `GoogleTranslationProvider`). | Provision before the integration test against the real boundary; unit tests inject a fake `fetchFn`. |
| `EMAIL_FROM` / `WEB_PUBLIC_ORIGIN` env | `From:` address + absolute links in emails (emails can't use relative URLs). | Add to `.dev.vars` + GitHub Secrets at kickoff. |

If slice-6 contract names differ at kickoff (e.g. the post-commit hook signature), slice 7 adapts its own PR — never refactor a landed slice (per slice-4 precedent).

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

One table, append-then-update lifecycle. A row is **inserted `QUEUED` before** the send attempt and **updated to `SENT`/`FAILED`** after — so a crash mid-send leaves a durable `QUEUED` row the resend path can pick up (at-least-once, proposal §9 item 17 / §8.2).

```ts
export const notificationKindEnum = pgEnum('notification_kind', [
  'OPERATOR_BOOKING_ALERT',   // -> operator: a booking landed
  'RENTER_BOOKING_CONFIRM',   // -> renter: confirmation + pre-auth link
])
export const notificationStatusEnum = pgEnum('notification_status', ['QUEUED', 'SENT', 'FAILED'])

export const notificationLog = pgTable('notification_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookingId: text('bookingId').notNull().references(() => bookings.id),
  // Tenant owner — every notification belongs to exactly one operator, so
  // operator-portal reads can scope by operatorId without a join (§6.2).
  operatorId: text('operatorId').notNull().references(() => operators.id),
  kind: notificationKindEnum('kind').notNull(),
  channel: text('channel').notNull().default('EMAIL'),  // future: SMS/LINE without schema churn
  recipient: text('recipient').notNull(),               // resolved address at send time
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

**`idempotencyKey` format:** `notify:<bookingId>:<kind>` (e.g. `notify:<uuid>:RENTER_BOOKING_CONFIRM`). One renter-confirm + one operator-alert per booking. A second post-commit dispatch (replay) finds the `SENT` row and no-ops; a `FAILED`/`QUEUED` row is what the manual-resend route re-attempts.

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

**Payload fields (read from the slice-6 booking read model):** `booking_code`, vehicle make/model/plate (assigned vehicle), pickup/return location + datetimes, operator name, selected `insurance_snapshot`, **operator `pre_auth_handoff_url`** (renter email + confirmation page), and the `fee_snapshot` "potential additional charges" block (proposal §9 item 19 — informational only).

### 4d. `NotificationDispatcher` + `NotificationService`

- **`NotificationDispatcher`** (`services/notification-dispatcher.ts`) is the post-commit hook. It is what the `TODO(#300)` in `BookingService` predicted: *"if a second post-booking side effect appears here, extract an outbox/event dispatcher rather than chaining another inline hook."* That condition is now true (thread + email). It:
  1. Builds the renter + operator notifications from the committed booking;
  2. For each: upsert a `QUEUED` `notification_log` row by `notify:<bookingId>:<kind>` (skip if already `SENT`);
  3. `await emailSender.send(...)`; on success update `SENT` + `providerMessageId`; on throw, `console.error` (structured) + update `FAILED` + `error` + `attempts++`.
  - **Never throws back into the booking path** — booking is authoritative, exactly like `ensureThread`'s catch-and-log.
- **`NotificationService`** (`services/notification.ts`) backs the operator-portal **list** (`findAll(ctx, { bookingId? })`, operator-scoped, management-read guarded) + **manual resend** (`resend(ctx, notificationId)` → re-runs the dispatcher for that one row, returns `{ ok, status }`).

**Wiring the post-commit fire (no email inside the transaction — proposal §2 / §10 item 14):** after the booking service returns a committed booking, invoke the dispatcher through slice 6's post-commit seam when present; otherwise invoke it from the booking route via `c.executionCtx.waitUntil(...)`. The response does not wait for Resend, and the booking transaction never contains a network call.

### 4e. `OperatorRepository.findById` (additive)

Current interface (`create`/`existsBySlug` only) can't read `pre_auth_handoff_url`. Add:
```ts
findById(ctx: CallerContext, id: string): Promise<Operator | undefined>
```
to the interface + Drizzle + InMemory pair. Read-scoped: an operator caller only resolves its own row; bypass roles resolve any (mirrors the §6.2 read-scope split). The dispatcher uses `SYSTEM_CONTEXT` since it runs post-commit on the platform's behalf.

### 4f. Routes — `routes/notifications.ts`

- `GET /notifications?bookingId=` — operator-scoped list (management-read guard rejects `RENTER`/`PARTNER`; bypass callers need explicit `?operatorId=` or `?includeAll=true`, mirroring slice 4 §2). For the operator portal badge (proposal §4 business item 8).
- `POST /notifications/:id/resend` — manual resend; cross-operator id → **404 not 403** (no tenant-existence leak). Uses `ok()`/`fail()` from `routes/helpers.ts`. Gated on management roles.

Mounted at `/` in `index.ts`.

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
Construct `NotificationDispatcher(notificationLogRepo, operatorRepo, vehicleRepo, userRepo, emailSender)` and `NotificationService(notificationLogRepo, emailSender, …)`; wire the dispatcher into the booking post-commit seam; `.route('/', createNotificationRoutes(notificationService))`. Add `notificationLogRepo` to the `overrides` test surface (InMemory) like every other repo.

---

## 5. Web layer — confirmation page links to pre-auth

`packages/web/src/app/[locale]/bookings/confirmation/page.tsx` currently renders booking id (`booking.id.slice(0, 8)` → becomes `booking_code` post-slice-6), class, dates, status. Slice 7 adds (proposal §4 renter item 5):

1. **Pre-auth handoff CTA** — a prominent button linking to the operator's `pre_auth_handoff_url` (absolute, external → plain `<a href target="_blank" rel="noopener noreferrer">`, **not** the i18n `Link`). The URL comes from the booking read model the API returns (web has **no DB access** — AGENTS.md). If the operator has no URL configured, hide the CTA (don't render a dead link).
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
| **Template renderers** (pure, `packages/api/tests/services/email/`) | `renderRenterConfirmation` includes `booking_code`, selected `insurance_snapshot`, the **exact** `pre_auth_handoff_url`, and each `fee_snapshot` line; `ja`/`zh` produce localized subject lines (specific string match, not "truthy"); `text` fallback non-empty; missing pre-auth URL omits the CTA line. |
| **`ResendEmailSender`** (inject fake `fetchFn`) | Posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>` + correct JSON body; maps `{ id }` → `providerMessageId`; **retries once on 5xx/network, NOT on 4xx**; `AbortSignal` present (mirror `#336` translate-timeout tests). |
| **`NotificationDispatcher`** (InMemory log + fake sender) | Inserts `QUEUED` then updates `SENT` with `providerMessageId`; on sender throw → `FAILED` + `error` + `attempts=1`, **booking unaffected**; replay with same booking → idempotent (no second `SENT` row, send not called twice); writes the booking's `operatorId`. |
| **`OperatorRepository.findById`** (Drizzle on Neon `test` + InMemory) | Operator caller resolves own row only; cross-operator id → `undefined`; bypass resolves any; returns `pre_auth_handoff_url`. |
| **`NotificationService` + routes** | resend re-sends a `FAILED` row → `SENT`; `RENTER`/`PARTNER` read → 403; cross-operator resend id → 404; bypass list without `operatorId`/`includeAll` → 400. |
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
5. `OperatorRepository.findById` (additive).
6. `NotificationDispatcher` + `NotificationService`.
7. Wire DI in `index.ts` + post-commit seam into the booking route/service.
8. `routes/notifications.ts` (list + resend).
9. Web: confirmation-page selected-insurance summary + pre-auth CTA + potential-charges block + i18n keys (en/ja/zh, verify parity).
10. E2E happy path.
11. Review → rebase onto `origin/marketplace-pivot` (regenerate migration if journal moved) → PR (`Closes #393`).

---

## 10. Risks (proposal §8.1)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Slice 6 not merged** — payload fields don't exist | High (today) | Blocking | Hard precondition (§1); do not start until #392 lands; adapt to its actual post-commit seam. |
| Email side effect leaks into the booking transaction | Low | High | Dispatcher runs **after commit** via `waitUntil`/post-commit callback; proposal §2/§10.14; test asserts booking succeeds when sender throws. |
| Resend free-tier limit (3k/mo) | Low | Low | Free tier covers MVP + early ops; upgrade $20/mo later (proposal §8.1). |
| Double-send on post-commit replay | Medium | Medium | `notification_log.idempotencyKey` unique on `notify:<bookingId>:<kind>`; dispatcher skips `SENT`; integration test asserts 23505 + no second send. |
| Pre-auth handoff UX confuses tourists | Medium | Medium | Confirmation page explains the step (proposal §8.1); email reinforces; copy reviewed with Du. |
| Vendor lock-in creeps into call sites | Low | Medium | `lint:boundaries` + the port/adapter split; no `resend` import outside `resend-email-sender.ts` + `index.ts`. |
| i18n key drift across en/ja/zh | Medium | Low | `chore/i18n-parity-lint` parity check; verify all three before merge (CLAUDE.md). |
| Failed send invisible to operator | Low | Medium | `notification_log` `FAILED` rows surfaced in operator portal + manual-resend route (proposal §8.2 / §9 item 17). |

---

## 11. Critical files

**New (API):** `services/email/email-sender.ts`, `services/email/resend-email-sender.ts`, `services/email/templates/{renter-confirmation,operator-alert}.ts`, `services/email/templates/messages/{en,ja,zh}.ts`, `services/notification-dispatcher.ts`, `services/notification.ts`, `repositories/{drizzle,in-memory}/notification-log.ts`, `routes/notifications.ts`.
**Modify (API):** `schema.ts` (add `notification_log` + enums), `repositories/types.ts` (`NotificationLogRepository` + `OperatorRepository.findById`), `index.ts` (DI + post-commit seam + route mount + overrides), `repositories/drizzle/operator.ts` + `repositories/in-memory/operator.ts` (`findById`), new migration in `drizzle/`.
**Modify (web):** `app/[locale]/bookings/confirmation/page.tsx`, `messages/{en,ja,zh}.json` (`bookings.confirmation.*` keys), operator-portal notifications surface (minimal — badge/list; rich UI = slice 8).
**Env:** `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, `WEB_PUBLIC_ORIGIN` (`.dev.vars` + GitHub Secrets; never hardcode — security rule).

---

## 12. Resolved decisions

1. **Post-commit seam shape.** Prefer a service-level post-commit dispatcher seam from slice 6. If slice 6 lands without one, invoke `NotificationDispatcher` from the booking route via `c.executionCtx.waitUntil`; do not add a second inline side-effect chain inside `BookingService`.
2. **Operator alert locale.** Default operator alerts to `ja` with `en` fallback unless a landed operator-language field exists. Do not add `operators.language` in slice 7.
3. **`waitUntil` vs awaited send.** Use `waitUntil` for Resend sends so booking latency is unaffected. The `QUEUED` row is inserted before the send attempt, and manual resend covers failures.
4. **Reply-to / cancellation contact.** Use `EMAIL_REPLY_TO` when configured, otherwise `EMAIL_FROM`, as the MVP cancellation-contact/reply-to address. Do not add an operator contact-email column in slice 7.
