# Vertical Slice: Renter Can Browse Available Cars and Book

> **For agentic workers:** Work in the existing worktree at `/Users/jack/Dev/kuruma-browse-and-book` on branch `feat/browse-and-book`. Follow strict TDD (vertical slices) and the project's vertical slice development rules in CLAUDE.md.

**Goal:** A renter can search by dates, see available cars, book one instantly, and view their bookings.

**What exists already:**
- Vehicle list page at `/vehicles` (grid layout, date params accepted but NOT used for filtering, direct DB queries — needs to switch to API)
- Vehicle detail page at `/vehicles/[id]` (gallery, specs, CTA button → `/bookings/new?vehicleId=X`)
- Search widget on landing page (date picker → `/vehicles?from=X&to=Y`)
- `hono/client` typed client configured in `packages/web/src/lib/api-client.ts` (ready but unused)
- All API routes exist: `GET /vehicles`, `GET /availability`, `POST /bookings`, `GET /bookings`
- `ActiveFilters` component shows selected date range

**What's missing:**
- Vehicle list doesn't filter by availability (ignores from/to params)
- Vehicle list uses direct DB instead of API calls
- No booking creation page (`/bookings/new` route doesn't exist)
- No renter bookings list page (`/bookings` is empty)

---

## Step 1: Switch vehicle list to API with availability filtering

**Files:**
- Modify: `packages/web/src/lib/vehicles.ts` — replace direct DB with API calls via `createApiClient()`
- Modify: `packages/web/src/app/[locale]/vehicles/page.tsx` — use availability API when from/to params present
- Fix: `packages/web/src/lib/api-client.ts` — fix fallback (pre-existing broken test)
- Test: `packages/web/tests/lib/api-client.test.ts` — fix existing test

**Behavior:**
- No dates → `GET /vehicles` (show all available)
- With from/to → `GET /availability?from=X&to=Y` (show only cars free for that range)
- Vehicle cards link to `/vehicles/[id]`

**Key detail:** The API returns JSON with `{ success: true, data: [...] }` wrapper. The vehicle list page needs to unwrap this.

**Note:** The API must be running for the web app to fetch data. For SSR in development, both `bun run dev` (web on port 3001) and `bun run dev:api` (Hono on port 8787) need to be running. For tests, mock the API calls.

---

## Step 2: Build booking creation page

**Files:**
- Create: `packages/web/src/app/[locale]/(renter)/bookings/new/page.tsx`
- Create: `packages/web/src/components/bookings/BookingForm.tsx` (client component)

**Behavior:**
- URL: `/bookings/new?vehicleId=X&from=Y&to=Z`
- Shows vehicle summary (name, photo, specs)
- Shows selected dates (from search)
- Confirm button → `POST /bookings` via API client
- On success: redirect to `/bookings` with success message
- On error (409 conflict — already booked): show error, link back to browse

**Auth:** Must be logged in (renter route group). Needs `renterId` from session.

**i18n:** Add booking-related strings to `messages/en.json`, `ja.json`, `zh.json`

---

## Step 3: Build renter bookings list

**Files:**
- Create: `packages/web/src/app/[locale]/(renter)/bookings/page.tsx`
- Create: `packages/web/src/components/bookings/BookingCard.tsx`

**Behavior:**
- Fetches renter's bookings via `GET /bookings` (filtered by renterId from session)
- Shows list of bookings with: vehicle name, dates (JST), status badge, source
- Status badges: green (CONFIRMED), blue (ACTIVE), gray (COMPLETED), red (CANCELLED)
- Each booking links to detail (future — can be placeholder for now)
- Empty state when no bookings

---

## Step 4: Link the flow end-to-end

**Files:**
- Modify: `packages/web/src/app/[locale]/vehicles/page.tsx` — vehicle cards link to `/bookings/new?vehicleId=X&from=Y&to=Z`
- Modify: `packages/web/src/app/[locale]/vehicles/[id]/page.tsx` — "Book this car" button passes dates

**Behavior:**
- Landing page → search dates → vehicle list (filtered) → click vehicle → detail page → "Book" → booking form → confirm → bookings list
- Full renter journey works end-to-end

---

## Verification

1. `bun run test` — all unit tests pass (shared + api + web)
2. Start both servers: `bun run dev` + `bun run dev:api`
3. Visit `http://localhost:3001/en` → use search widget → see filtered vehicles
4. Click a vehicle → see detail → click "Book" → see booking form → confirm
5. See booking in bookings list

---

## Pre-existing issues to fix

- `packages/web/tests/lib/api-client.test.ts` — test expects fallback URL but `process.env.NEXT_PUBLIC_API_URL` returns `undefined` as string. The implementation looks correct (`?? DEFAULT_API_URL`), the test setup may not be clearing the env var properly.

---

*Created: 2026-04-08*
*Worktree: /Users/jack/Dev/kuruma-browse-and-book*
*Branch: feat/browse-and-book*
