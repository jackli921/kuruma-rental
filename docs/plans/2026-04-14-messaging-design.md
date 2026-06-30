# Messaging Feature — Design Document

> Fills gaps in the existing schema/API design (`2026-04-07-schema-api-design.md`).
> Schema, API routes, validators, and translation model are already spec'd there — this doc covers UX decisions, thread lifecycle, notifications, RLS, and UI structure.

> **Status (2026-06-27): partially built + gated off.** The renter side (auto-created
> booking threads, inbox, thread view, reply composer, translation, first-unread email)
> shipped under `#1032`. The **operator inbox was never built** and the feature is hidden
> behind `VITE_FEATURE_MESSAGING` (beta shows it only to the platform admin via the `#1161`
> bypass). This doc predates the **multi-tenant marketplace pivot** (`#385`), so three of
> the original decisions below were single-owner assumptions — corrected inline and
> summarised in **[Current State vs Remaining](#current-state-vs-remaining-2026-06-27)**.

## Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Thread creation | Auto-create on booking confirmation | Thread ready before anyone messages; empty threads negligible at 40-50 vehicles |
| Pre-booking inquiries | Not in MVP | FAQ page handles common questions; owner can't scale replies to every inquiry |
| Cancelled booking threads | Locked (no new messages) | Conversation history preserved, compose input disabled |
| Completed booking threads | Stay writable | Post-rental coordination (lost items, receipts) |
| Message content | Text only, max 5000 chars | Coordination channel, not a chat app. Users exchange Line/WeChat for richer comms |
| Photos/attachments | Not in MVP | Not needed for basic coordination |
| Message deletion | Not supported | Legal protection; Japan not subject to GDPR |
| Thread cleanup | Scheduled deletion every few months/year | Future maintenance job, not MVP |
| ~~Staff assignment~~ Operator participant | **CORRECTED (post-pivot):** the thread counterpart is the **booking's operator**, and **any staff of that operator** (`OPERATOR_OWNER`/`OPERATOR_STAFF`) can read & reply — operator-as-*org*, not a single user | The original `DEFAULT_STAFF_ID` env var (still wired at `index.ts:342`) hardcoded one global recipient — a single-tenant artifact that breaks in the marketplace. Resolve participants from `booking.operatorId`. Same operator-as-org call as reviews (`#1158`) — decide once for both |
| Real-time delivery | Polling on page load / navigation | Not WebSocket — async message exchange, not live chat |
| Rate limiting | 10 messages per minute per user | Service-layer check |

---

## Notification Strategy

> **CORRECTED (post-pivot).** The original table assumed a single owner who lives in the
> app daily and therefore needed no email. In the marketplace there are many operators
> (not all in-app daily) **and the operator inbox does not exist yet**, so an operator who
> only gets an in-app badge would never see a renter's message. Operators need an email
> path too — at minimum first-unread, mirroring the renter side.

| Sender | Recipient | Notification |
|--------|-----------|-------------|
| Renter sends message | The booking's operator (any staff) | **Email on first unread** to the operator's notifiable address(es) + unread badge in the operator inbox. (Was "no email — owner's in the app daily"; no longer true with N operators and no operator inbox.) |
| Operator sends message | Renter | **Email on first unread only.** If `renterUnreadCount === 0` before increment, send one email. No email if they already have unread messages. |

Email contains: message preview (first 200 chars) + link to thread in app. No reply-by-email.

**Provider:** Resend (edge-compatible, free tier sufficient). Requires one-time DNS verification (SPF + DKIM).

---

## Row-Level Security (NOT adopted — see correction)

> **CORRECTED (2026-06-27): this prerequisite never happened, and messaging shipped without it.**
> The codebase scopes tenancy at the **application layer** — `CallerContext` + `services/tenancy.ts`
> + `bookingReadScope`, hardened by the security audits `#1119` / `#1124` — and there is **zero
> Postgres RLS** in the schema (no `crudPolicy` / `authUid` / `pgPolicy` anywhere). Slice 0 below
> was dropped. Treat the rest of this section as a **future defense-in-depth option**, not a
> prerequisite or current reality.

**Original approach (not implemented):** Postgres-level RLS via Drizzle + Neon, enforced at the DB layer so no application bug can leak data across renters.

### Why Postgres RLS was proposed (and the trade-off we actually took)

Application-level (`WHERE renterId = ?` / operator scoping in every repository method) relies on every query getting it right; one missed filter = data leak — which the audits `#1119`/`#1124` did catch and fix. Postgres RLS would enforce at the DB engine level instead. We chose application-level scoping (simpler on Workers + neon-http, no per-connection JWT-claim wiring) and accept the audit burden. RLS remains available later as belt-and-suspenders.

### Tables requiring RLS policies

| Table | Renter policy | Staff/Admin policy |
|-------|--------------|-------------------|
| `bookings` | `SELECT/UPDATE` where `renterId = auth.uid()` | Full access |
| `threads` | `SELECT` where `renterId = auth.uid()` | Full access |
| `messages` | `SELECT` where message belongs to a thread where `renterId = auth.uid()` | Full access |

### Implementation sketch (Drizzle + Neon)

```typescript
import { crudPolicy, authUid } from 'drizzle-orm/neon'

export const threads = pgTable('threads', {
  // ... columns
}, (t) => [
  crudPolicy({
    role: authenticatedRole,
    read: authUid(t.renterId),
    modify: false,  // renters cannot update/delete threads
  }),
])
```

Staff/admin role bypasses policies (needs to see all threads/bookings).

**Requires:** Setting JWT claims (`SET LOCAL request.jwt.claims = ...`) on each DB connection. Neon supports this natively in transactions.

### Implementation order (if ever adopted as hardening)

~~RLS must land before messaging.~~ Messaging already shipped on app-level scoping. If RLS is added later as defense-in-depth:
1. Define Postgres roles (`authenticated`, `staff`, `admin`) in schema
2. Add RLS policies to `bookings` table first (existing, easy to test)
3. Verify with integration tests (renter A cannot see renter B's bookings)
4. Extend to `threads` and `messages` tables

---

## UI Structure

### Renter Side

**Entry points:**
- Booking detail page: "Messages" tab/section (primary access)
- Nav bar: "Messages" link with unread badge count

**Pages:**
- `/bookings/[id]/messages` — thread view embedded in booking detail
- `/messages` — inbox list (all threads, sorted by last activity)
- `/messages/[threadId]` — full thread view

### Staff (Owner) Side

**Entry points:**
- Sidebar: "Messages" nav item with unread badge
- Booking detail: "Message Renter" button opens thread

**Pages:**
- `/manage/messages` — inbox (all threads, shows renter name + vehicle + booking dates)
- `/manage/messages/[threadId]` — thread view

### Shared Components

```
MessageInbox        — list of threads with last message preview + unread dot
MessageThread       — scrollable message list + compose input
MessageBubble       — single message, sender-aligned left/right
TranslateButton     — inline "Translate" toggle per message bubble
ComposeInput        — text input + send button (disabled when thread locked)
UnreadBadge         — count badge for nav items
```

### Empty / Edge States

| State | Display |
|-------|---------|
| No threads | "No messages yet" |
| Thread with no messages | "Start the conversation" prompt |
| Cancelled booking thread | Messages visible, compose disabled: "This booking was cancelled" |
| Translation loading | Skeleton text below bubble |
| Translation error | "Translation unavailable" with retry |

---

## Translation

**Provider interface (in API composition root):**

```typescript
interface TranslationProvider {
  translate(text: string, from: string, to: string): Promise<string>
}
```

MVP concrete: `GoogleTranslationProvider`. Provider-agnostic — swap to DeepL, LibreTranslate, or OpenAI by changing one line in the composition root.

**Flow:** User clicks "Translate" on a message bubble. API checks `translations` JSONB for cached result. Cache miss calls provider, stores result in JSONB. Subsequent requests served from cache.

---

## Implementation Slices

| Slice | Scope | Status |
|-------|-------|--------|
| 0 | ~~RLS foundation~~ | **DROPPED** — app-level scoping shipped instead (see RLS section) |
| 1 | Schema migration: threads + messages tables | ✅ shipped (`#1032`) — without RLS policies |
| 2 | API: auto-create thread on booking confirmation + send/list messages | ✅ shipped — `ensureThread` in `booking-creation.ts` post-commit |
| 3 | API: unread counts (atomic increment on send, reset on read) + inbox list | ✅ shipped |
| 4 | Web: thread view + compose input | ✅ shipped (renter) — `ConversationView` + `MessageComposer` |
| 5 | Web: inbox page with unread badges (both renter + **operator** sides) | ⚠️ **renter only** — operator inbox NOT built |
| 6 | Translation: provider interface + Google concrete + translate endpoint | ✅ shipped — `message-translation.ts`, JSONB cache |
| 7 | Email notification on first unread (Resend) | ✅ renter side; ⚠️ operator side needs it (see Notification correction) |

---

## Current State vs Remaining (2026-06-27)

**Shipped & working (gated off via `VITE_FEATURE_MESSAGING`, hidden in beta per `#1161`):**
- DB schema + API: `POST/GET /threads`, `POST /threads/:id/messages`, `/read`, translation. Tenancy scoped at the app layer.
- Threads **auto-create on booking** (`ensureThread`, idempotent on `booking:<id>`) — so there is deliberately **no "start a conversation" button**; a thread exists once a booking does.
- Renter inbox (`/messages`), thread view (`/messages/$threadId`), reply composer, unread badge, first-unread email, inline translation.

**Remaining before this can ship (the un-gate work):**
1. **Operator inbox** — `/manage/messages` + `business-nav-items` entry + thread view/composer. Today operators have **no UI** and would only learn of a message by email. This is the headline gap.
2. **Multi-tenant participants** — replace `DEFAULT_STAFF_ID` (`index.ts:342`) with operator-derived participants; any staff of `booking.operatorId` can read/reply (operator-as-org; settle jointly with reviews `#1158`).
3. **Operator notifications** — first-unread email to the operator (see Notification correction).
4. *(Optional, later)* Postgres RLS as defense-in-depth; standalone pre-booking inquiries (still **out** — instant-book + FAQ make them low-value).

Tracking issue: see follow-up filed against `#1032`.
