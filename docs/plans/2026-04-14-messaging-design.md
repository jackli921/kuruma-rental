# Messaging Feature — Design Document

> Fills gaps in the existing schema/API design (`2026-04-07-schema-api-design.md`).
> Schema, API routes, validators, and translation model are already spec'd there — this doc covers UX decisions, thread lifecycle, notifications, RLS, and UI structure.

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
| Staff assignment | `DEFAULT_STAFF_ID` env var | Single owner operation, no round-robin needed |
| Real-time delivery | Polling on page load / navigation | Not WebSocket — async message exchange, not live chat |
| Rate limiting | 10 messages per minute per user | Service-layer check |

---

## Notification Strategy

| Sender | Recipient | Notification |
|--------|-----------|-------------|
| Renter sends message | Owner (staff) | **No email.** Unread badge in app sidebar only. Owner is in the app daily. |
| Owner sends message | Renter | **Email on first unread only.** If `renterUnreadCount === 0` before increment, send one email. No email if they already have unread messages. |

Email contains: message preview (first 200 chars) + link to thread in app. No reply-by-email.

**Provider:** Resend (edge-compatible, free tier sufficient). Requires one-time DNS verification (SPF + DKIM).

---

## Row-Level Security (Prerequisite)

> This is a cross-cutting concern — not messaging-specific. Must be implemented as a foundational layer before messaging, and applied to all tenant-scoped tables (bookings, threads, messages).

**Approach:** Postgres-level RLS via Drizzle + Neon. Strictly enforced at the DB layer so no application bug can leak data across renters.

### Why Postgres RLS, not application-level scoping

Application-level (`WHERE renterId = ?` in every repository method) relies on every query getting it right. One missed filter = data leak. Postgres RLS enforces at the DB engine level — even a buggy query returns zero unauthorized rows.

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

### Implementation order

RLS must land before messaging. Suggested:
1. Define Postgres roles (`authenticated`, `staff`, `admin`) in schema
2. Add RLS policies to `bookings` table first (existing, easy to test)
3. Verify with integration tests (renter A cannot see renter B's bookings)
4. Extend to `threads` and `messages` tables as part of messaging slices

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

| Slice | Scope | Depends on |
|-------|-------|------------|
| 0 | **RLS foundation** — Postgres roles, policies on bookings table, JWT claim wiring | Nothing |
| 1 | Schema migration: threads + messages tables with RLS policies | Slice 0 |
| 2 | API: auto-create thread on booking confirmation + send/list messages | Slice 1 |
| 3 | API: unread counts (atomic increment on send, reset on read) + inbox list | Slice 2 |
| 4 | Web: thread view + compose input on booking detail page | Slice 2 |
| 5 | Web: inbox page with unread badges (both renter + staff sides) | Slice 3 |
| 6 | Translation: provider interface + Google concrete + translate endpoint | Slice 2 |
| 7 | Email notification to renter on first unread message (Resend) | Slice 2 |
