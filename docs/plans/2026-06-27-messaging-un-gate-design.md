# Messaging Un-Gate — Design & Slice Plan

> **Status: IMPLEMENTED / SUPERSEDED — verified against `origin/develop` @ `82efa91c` (2026-07-07 architect review).**
> This design shipped across **#1205 (slices 1–4)** plus **#1386** (removed `POST /threads`). The body below
> is retained as historical rationale; the **as-built shape diverges from — and improves on — D2/D3**, so do
> NOT rebuild from the slice plan. The doc's code claims were verified against `b0f8f889`, now 165 commits stale.
>
> **As-built (what actually shipped):**
> - **D1 ✅** `threads.operatorId` (FK → operators, indexed) — `packages/shared/src/db/messaging.ts:31`; migration `drizzle/0091`.
> - **D2 — simpler than designed.** No `thread_operator_state` / `unreadEpoch`. Operator unread is one
>   `threads.operatorUnreadCount` counter; the operator gate is `threadReadScope(ctx)` (`packages/api/src/tenancy.ts:193`,
>   a sibling of `bookingReadScope`/`operatorReadScope`) — it replaced `rejectOperatorContextUntilScoped` (deleted).
> - **D3 — simpler than designed.** `OPERATOR_NEW_MESSAGE` kind (`notification.ts:23`, migration `drizzle/0092`);
>   idempotency key is `msg:<messageId>` — re-arms naturally per message, so no window-epoch column was needed.
> - **D4 ✅** `POST /threads` + `createThread` removed (#1386); `ensureThread` is the sole booking-derived creation path.
> - **D5 ✅** all-or-nothing accepted; `MESSAGING` is now `runtimeControlled` (`registry.ts:59`) — flip live at `/admin/feature-flags`.
>
> **Open follow-ups the build did NOT close (2026-07-07 architect review):**
> - **[HIGH, latent] `DEFAULT_STAFF_ID` shared participant.** `ensureThread` (`ensure-thread.ts:38`) still seeds one
>   global staff user into *every* operator's threads. Operator reads no longer need it (they scope by `operatorId`);
>   it is dead weight whose unread row is bumped on every renter send. If that account ever holds a participant-scope
>   role (legacy `STAFF`/`ADMIN`), a single `GET /threads` returns every operator's renter conversations — the exact
>   cross-tenant leak this feature exists to prevent. Not live today *iff* `DEFAULT_STAFF_ID` is `PLATFORM_ADMIN`/`OPERATOR_*`.
>   Fix: seed `[booking.renterId]` only; drop the `staffUserId` wiring (`index.ts:399/404`); data-migrate existing rows away.
> - **[MEDIUM] Blind `operatorUnreadCount = 0` reset can drop the operator *email* alert**, not just the badge (§4):
>   a renter send landing between inbox-open and click-read is zeroed AND never armed an email (it observed count ≥ 2).
>   Bounded (self-heals on next send) but should be documented as "alert can be missed," or switched to a watermark.
>
> ---
>
> <details><summary>Original design (historical — DESIGN FOR REVIEW, 2026-06-27)</summary>
>
> Approach + decisions doc for un-gating in-app messaging (#1205, follow-up to #1032 / #1161). Five
> design decisions (D1–D5) needed sign-off first. **Revised 2026-06-27** after a design review (four findings folded in; see §8).

**Goal:** Let operators read and reply to their bookings' message threads (today the
feature is renter-side only and gated off via `VITE_FEATURE_MESSAGING`), without leaking
one operator's renter conversations to another.

**Tech stack:** Hono API on CF Workers (neon-http reads, `runTx` for interactive tx),
Drizzle/Postgres, Vite + TanStack Router web, use-intl (en/ja/zh).

---

## 1. Corrected current state (verified against `origin/develop` @ `b0f8f889`)

The #1205 issue body and the existing design doc (`2026-04-14-messaging-design.md`) carry
two inaccuracies that change scope. Both verified in code:

1. **No message email exists for *anyone* — not just operators.** `notificationKindEnum`
   (`packages/shared/src/db/notification.ts:6`) has booking / trip / review kinds only —
   there is **no `*_NEW_MESSAGE` kind**. Messaging unread is **in-app polling only**
   (renter nav badge, 60s refetch). So #1205's "operator first-unread email (*was* 'no
   email…')" is wrong twice over: renter email never shipped, and operator email is
   **net-new infrastructure** (kind + template + dispatch relations + idempotency key),
   not a config tweak. → fix the stale claim in memory + the design doc (see §6).

2. **Threads carry no operator linkage, and operators are fail-closed rejected.**
   - `threads` / `thread_participants` (`packages/shared/src/db/messaging.ts`) have **no
     `operatorId`**. Reads for non-privileged callers are *purely participant-membership*
     (`thread.ts` `findAll`: join `thread_participants WHERE userId = ctx.userId`).
   - Every thread/message repo method calls `rejectOperatorContextUntilScoped(ctx, …)`
     (`packages/api/src/auth/guards.ts:138`) → an `OPERATOR_*` caller is **thrown out**
     with `"…not yet operator-scoped"`. This guard *is* the gate. Un-gating ≠ deleting it;
     un-gating = replacing it with real `operatorId`-scoped reads.
   - `ensureThread` (`services/ensure-thread.ts:29`) seeds participants as
     `[booking.renterId, DEFAULT_STAFF_ID]` — one global staff user, a single-tenant
     artifact. `DEFAULT_STAFF_ID` is read once at `index.ts:356`.

**Accurate in #1205:** operator inbox genuinely unbuilt (no `/manage/messages`, no
`business-nav-items` entry); the booking-scoped / auto-create model is correct; and the
operator-as-org decision is correctly flagged as shared with reviews #1158.

---

## 2. Key design decisions (need your sign-off)

### D1 — How does an operator's thread get scoped to the operator?

**Recommendation: denormalize `operatorId` onto `threads`** (migration + backfill from
`booking.operatorId`; `ensureThread` sets it on create). Read-scope operators by
`thread.operatorId = ctx.operatorId`, mirroring how `notification_log` already does it —
that table carries a `notNull operatorId` *specifically* so "operator-portal reads can
scope by operatorId without a join" (`notification.ts:54`, indexed
`idx_notification_log_operatorId`). Same pattern, already proven in this codebase.

- *Alternative (rejected): join threads→bookings→operatorId at read time.* Every thread
  read grows a join, and `threads.bookingId` is **nullable** — fragile. Denormalizing is
  one indexed column and matches the established precedent.

### D2 — Operator unread + the read-model contract (REVISED after review)

Today unread is a per-**user** counter on `thread_participants`; the web derives the badge
by finding *my* participant row (`unread-badge.ts:13` `countUnread`) and `markAsRead` zeroes
only the caller's participant row (`thread.ts:189`). Operator-as-org (any staff reads/replies;
one staff reading clears the org badge) does not fit that per-user model — and the review
correctly flags that **dropping per-staff rows breaks the existing unread/markRead contract
unless we replace it explicitly**, not just delete it.

Whatever we pick, the API must expose an **explicit operator thread read-model** — e.g.
`{ ...thread, myUnreadCount, counterpart }` — rather than have the operator UI re-derive from
`participants[]`. Two ways to back it:

- **(Recommended) Org-level unread via `thread_operator_state(threadId, operatorId,
  unreadCount, lastReadAt, unreadEpoch)`.** `messageRepo.create` bumps `unreadCount` when the
  sender is the renter; an operator `markAsRead` zeroes it (org-wide) and increments
  `unreadEpoch` (the D3 dedupe counter). Correct semantics; cost = new shape + a web
  operator-badge variant. `senderId` on a reply is still the real staff user (audit intact).
- **Per-staff participant rows (cheaper, mismodels org).** Reuses `countUnread`/`markAsRead`
  as-is, but each staff has independent unread, one staff reading doesn't clear another's, and
  the row set breaks as staff join/leave. Acceptable only for tiny teams.

This is the **same operator-as-org call reviews faces (#1158)** — decide once, apply to both.

> Learn: Leaky Abstraction. The per-user participant model would leak into org-level messaging
> if the operator UI kept deriving unread from `participants[]`. Heuristic: when the actor
> changes from user to org, name a new read model (`myUnreadCount`/`counterpart`) instead of
> stretching the old one.

### D3 — `OPERATOR_NEW_MESSAGE` email: trigger + dedupe window (REVISED after review)

Two real problems the review caught, both confirmed in code:

1. **No trigger exists.** The dispatcher fires on **booking-lifecycle** events
   (`notification-dispatcher.ts`), not on messages. The email needs a new seam on the
   **operator unread 0→1 transition** (fired from `messageRepo.create` when a renter message
   lands and operator unread was 0), distinct from the booking post-commit dispatcher.
2. **`notification_log.idempotencyKey` is UNIQUE + terminal** (`notification_log_idempotency_
   unique`, `notification.ts:68`) — "one logical notification per (booking, kind)". A
   `msg:<threadId>:firstunread` key therefore sends **once, ever** — never again after the
   operator reads and a new conversation starts. The key must encode the **window**, not the
   thread forever: `msg:<threadId>:<unreadEpoch>`, where `unreadEpoch` (D2's
   `thread_operator_state`) increments on each operator read → the email re-arms next epoch.
   `notification_log` requires `bookingId`+`operatorId` (both `notNull`) — both available from
   the thread, so the ledger fits once the key is window-scoped.

**Recommendation: operator-only email** (renters have the in-app badge; renter email is
separate, lower value). Given the trigger+key complexity, **Slice 4 can trail the un-gate**
(in-app badge works without it). Confirm scope: operator-only or both?

### D4 — Thread creation must be booking-derived (NEW — review finding 1)

`POST /threads` (`messages.ts:30`) accepts caller-supplied `bookingId` **and**
`participantIds` and `createThread` passes them straight through with only a
participant-inclusion check (`message.ts:44`). Once `threads.operatorId` is the tenant
boundary, that's a mass-assignment hole — a caller could craft a thread's tenant linkage from
the request body.

**The web never calls `POST /threads`** (verified — threads are born only via `ensureThread`
on booking commit). So:

- **(Recommended) Remove the public `POST /threads` route + `createThread`** (YAGNI — dead
  from the product's view); keep `ensureThread` as the sole, server-derived creation path,
  which sets `operatorId`/participants from the authoritative booking.
- *If a direct-create path is wanted later:* it must **load a caller-scoped booking and derive**
  `operatorId`/renter/participants from it — never trust body fields for tenant scope.

> Learn: Mass Assignment. Caller-supplied relationship fields (`bookingId`, `participantIds`)
> become authz state once `operatorId` is derived from them. Heuristic: derive tenant scope
> from a scoped parent row, never from the request body.

### D5 — Flag granularity: un-gate is currently all-or-nothing (NEW — review finding 4)

Slice 3 gates the operator nav on `VITE_FEATURE_MESSAGING`, but the **same global flag** also
admits renters via `isVisibleToViewer(isMessagingEnabled(), role)` (`renter-nav-items.ts:32`,
`feature-visibility.ts:16`). So "un-gate operators only" isn't achievable by flipping it —
flipping reveals **renter + operator messaging together**.

- **(Recommended) Accept all-or-nothing.** Renter messaging is already built/shipped (just
  gated); revealing both at once is fine. Drop the "operators only" wording.
- *If staging is needed:* add a separate `VITE_FEATURE_OPERATOR_MESSAGING` flag (or make the
  visibility helper role-aware). Only worth it to keep operator messaging live while renter
  stays dark.

---

## 3. Proposed vertical slices

Each slice is independently shippable and demo-able. No code shown — full TDD steps come after
the decisions above are signed off (the review reshaped D2/D3 and added D4/D5).

### Slice 1 — Schema: tenant + unread state (depends on D1, D2)
- Migration `bun run db:generate --name messaging_operator_scope`: add `threads.operatorId`
  (FK → `operators`, indexed), backfill from `bookings.operatorId` for existing booking
  threads; `ensureThread` sets it on create. `db:migrate` + `db:verify` (3 green).
- If D2 = org-level unread: same migration adds `thread_operator_state(threadId, operatorId,
  unreadCount, lastReadAt, unreadEpoch)` — `unreadEpoch` is the D3 dedupe counter.
- Tests: ensure-thread sets operatorId; backfill correctness (real-pg).

### Slice 2 — API: lock creation + operator read/reply scoping (security-critical; D1/D2/D4)
- **(D4) Remove the public `POST /threads` + `createThread`** (no web caller); `ensureThread`
  is the sole, booking-derived creation path. (Or, if kept, server-derive operatorId/
  participants from a caller-scoped booking — never the body.)
- Replace `rejectOperatorContextUntilScoped` in the **thread + message** repos (Drizzle +
  InMemory) with operator scoping: `OPERATOR_*` see threads where `thread.operatorId =
  ctx.operatorId`; `PLATFORM_ADMIN` keeps cross-tenant; renter unchanged. Guard with
  `requireOperatorScope(ctx)` (`guards.ts:126`) so a tokenless operator can't read globally.
- Operator reply: `POST /threads/:id/messages` allowed iff `thread.operatorId` matches;
  `senderId` = staff user; bump renter unread (their participant row) + realize operator
  unread per D2.
- **(D2) operator read-model**: thread reads return `{ …, myUnreadCount, counterpart }` for
  operator callers; operator `markAsRead` zeroes org-level unread (and bumps `unreadEpoch`).
- Tests (mutation-resistant + security): operator A cannot read/reply operator B's thread;
  operator staff can read/reply own; renter still scoped to own; admin still global; removed
  create route returns 404. This is the cross-tenant-leak surface #1119/#1124 police.

### Slice 3 — Web: operator inbox (`/manage/messages`) (D2, D5)
- Route under `routes/$locale/_business/manage/messages*` mirroring the renter inbox; reuse
  the counterpart-agnostic `vite/messaging/` components. Add a `business-nav-items` "Messages"
  entry. **(D5)** nav visibility uses the same messaging flag — flipping it reveals renter +
  operator together (accepted), unless we add a separate operator flag.
- Operator badge reads `myUnreadCount` from the operator DTO (NOT `countUnread` over
  `participants[]`, which is renter-only). i18n keys (en/ja/zh).

### Slice 4 — Notifications: `OPERATOR_NEW_MESSAGE` email (D3; may trail the un-gate)
- New `notificationKindEnum` member (enum-add migration — watch `_journal.json` ordering);
  dispatcher template; `RELATIONS_BY_KIND` entry resolving the operator address from the
  thread's `operatorId`. **Trigger on the operator unread 0→1 transition** from
  `messageRepo.create` (new seam, not the booking dispatcher). **Window-scoped idempotency
  key** `msg:<threadId>:<unreadEpoch>` so it re-arms after each read. Update `#710`/`#1151`
  conformance tests that pin the kind set.
- Tests: queued on 0→1 for the operator; NOT re-sent within the same epoch (idempotent);
  re-armed after read→new-message (next epoch); `NO_RECIPIENT` when operator has no email.

### Un-gate
- After Slices 1–3, flip the messaging flag (reveals renter + operator per D5). Slice 4
  (email) can trail — the in-app badge works without it. Admin preview already works (#1161).

---

## 4. Risks

- **Cross-tenant PII leak (highest).** The whole point of the fail-closed guard. Slice 2's
  tests must assert operator-A-cannot-read-operator-B at the repo layer, both impls.
- **Mass-assignment on create (D4).** Don't let the un-gate ship while `POST /threads` still
  trusts body `bookingId`/`participantIds`.
- **Stale-tree trap.** First reviewed on a tree 44 commits behind develop; build on a fresh
  `origin/develop` worktree and re-verify symbols before editing.
- **Enum/column migration ordering.** Slices 1 + 4 each migrate — coordinate the migration
  numbers against develop's tail to avoid the `_journal.json` out-of-order skip (CLAUDE.md).
- **Known limitation — `operatorUnreadCount` is a counter, not a watermark (accepted).**
  `markAsRead` does a blind `set operatorUnreadCount = 0`. A renter send that lands between the
  operator opening the inbox and clicking read is zeroed with it, so the badge can under-count by
  one until the next send. Consequence is badge accuracy only: the message is intact and visible,
  the counter never drifts negative or unbounded (only atomic `+1` bumps and `= 0` resets), and it
  self-corrects on the next send (which also re-fires the 0->1 alert). A watermark (last-read-at +
  `COUNT` of later messages) would be self-healing but adds a column and a per-inbox-load subquery —
  unjustified at this volume. The simple counter is the deliberate choice (owner call).

## 5. Out of scope

Postgres RLS (app-level scoping is the accepted decision; RLS is later belt-and-suspenders);
standalone non-booking inquiries; renter email (unless D3 says otherwise).

## 6. Doc/memory accuracy fixes (do alongside, not code)

- `docs/plans/2026-04-14-messaging-design.md` (currently on PR #1203): the "first-unread
  email" line implies renter email shipped — correct to "in-app badge only; no message email
  exists yet" and frame operator email as net-new.
- Memory `project_messaging-feature-state.md`: same correction (it lists "first-unread email"
  as shipped).

## 7. Open questions for you

1. **D1**: OK to denormalize `operatorId` onto `threads` (a migration)?
2. **D2**: Org-level unread via `thread_operator_state` (recommended) vs per-staff participant
   rows? Either way the operator API gets an explicit `myUnreadCount`/`counterpart` read-model.
3. **D3**: Email scope — `OPERATOR_NEW_MESSAGE` only (recommended) or renter too? OK to let
   Slice 4 trail the un-gate?
4. **D4**: OK to **remove** the unused `POST /threads` route (recommended), vs locking it down
   to booking-derived creation?
5. **D5**: Accept all-or-nothing flag (renter + operator reveal together, recommended) vs a
   separate operator flag?

## 8. Review responses (design review 2026-06-27)

All four findings verified against the worktree and folded in:

| # | Finding | Verified in code | Resolution |
|---|---------|------------------|------------|
| 1 (P1) | Creation under-designed / mass assignment | `POST /threads` passes body `bookingId`+`participantIds` through (`messages.ts:30`, `message.ts:44`); **web never calls it** | **D4 + Slice 2** — remove the unused route (or server-derive from a scoped booking) |
| 2 (P1) | D2 breaks the unread/markRead contract | `countUnread` over `participants[]` (`unread-badge.ts:13`); `markAsRead` clears one participant row (`thread.ts:189`) | **D2 revised + Slice 2/3** — explicit `myUnreadCount`/`counterpart` operator read-model + org-level reset |
| 3 (P1) | Email key sends once forever; no trigger | `idempotencyKey` UNIQUE+terminal (`notification.ts:68`); dispatcher is booking-lifecycle | **D3 revised + Slice 4** — 0→1 transition seam + window key `msg:<threadId>:<unreadEpoch>` |
| 4 (P2) | Global flag can't un-gate operators only | `isVisibleToViewer(isMessagingEnabled(), role)` gates renter nav too (`renter-nav-items.ts:32`) | **D5 + Slice 3** — accept all-or-nothing, or add a separate operator flag |

Not run: tests (design review only). Build must happen on a fresh `origin/develop` worktree.

</details>
