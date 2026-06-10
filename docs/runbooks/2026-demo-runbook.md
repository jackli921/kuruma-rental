# Slice 8 — Core-Path Runbook (issue #390, interim milestone)

> **Scope.** This runbook verifies the **interim core-path** that slice 8 (#390) delivers:
> *renter search → storefront → vehicle → booking → confirmation → operator sees it.*
> The full customer-facing Qiao/Du demo (pay → partner-revenue) is **#488** and is gated on #457–#462.
>
> The authoritative proof of the core path is the **automated real-DB E2E lane** (§3). The
> manual click-through (§4) is for narration. (Live booking submit now works on the
> neon-serverless API — **#493 is fixed**; see §4.)

---

## 1. What is seeded

After `db:seed` + `db:seed-bookings` against a fresh Neon branch:

- **3 operators** · **9 locations** · **12 ACRISS classes** · **41 vehicles** · **6 insurance options** · **10 fee schedules**
- **4 renters** · **10 bookings** (+ booking_events + notification_log rows), **0 FK orphans**
- Key identities for the walkthrough:
  - Renter: `sarah@example.test` (role `RENTER`)
  - Operator: `owner@best-car-rental.local` (role `OPERATOR_OWNER`, Best Car Rental)
  - `Kansai Airport (KIX)` storefront carries 4 vehicles.

All seed ids are deterministic UUIDs (`seedId(slug)` — `packages/shared/src/db/seed-id.ts`); fixtures keep readable slugs.

---

## 2. Cold start

```bash
git fetch origin
# fresh worktree or fast-forwarded local branch off origin/marketplace-pivot
bun install

# Point DATABASE_URL at a fresh Neon branch off the merged pivot (NOT production).
bun run db:migrate
bun run db:seed
bun run db:seed-bookings
bun run db:verify            # must show 3 green checks
```

For local Google login through the Vite shell, the API's OAuth callback must use
the web dev origin so the browser returns through Vite's `/auth` proxy:

```bash
AUTH_URL=http://localhost:3001
WEB_POST_LOGIN_URL=http://localhost:3001/en
```

Register this redirect URI in the Google OAuth client used for local demos:
`http://localhost:3001/auth/google/callback`.

Then, in two terminals:

```bash
bun --env-file=.env run dev:api
bun run dev
```

---

## 3. Verify the core path (automated — the merge gate)

This is the §6.1 acceptance gate and the honest proof of the journey. It runs the real Next.js
web → real Hono API → seeded Neon branch with a minted Auth.js session.

```bash
set -a; source /tmp/slice8-db.env; set +a   # or export DATABASE_URL for your branch
AUTH_SECRET=ci-placeholder-secret-not-real bun run test:e2e:real-db
```

Expected: **6 passed** (2 session-mint + 3 operator-locations + the marketplace happy-path).
The happy-path spec (`e2e/real-db/marketplace-happy-path.auth.spec.ts`) drives:
renter search → Best Car Rental KIX storefront → vehicle → book → confirmation code
(`/^[2-9A-HJ-NP-Z]{8}$/`) → operator sees the booking on `/manage/bookings?view=month`
+ an `OPERATOR_BOOKING_ALERT` row in `notification_log`.

> **Why the lane uses a postgres-js API server.** The booking → thread-creation path opens an
> interactive transaction. Production now runs these via `runTx` (neon-serverless) since **#493**,
> but the lane keeps `e2e/real-db/real-api-server.ts` on postgres-js (TCP) to exercise the real
> path without opening a WebSocket connection per transaction.

---

## 4. Manual walkthrough (narration)

Routes (locale-prefixed, e.g. `/en`): `/search` → `/storefronts/[locationId]?from&to`
→ `/bookings/new?vehicleId&locationId&from&to` → `/bookings/confirmation?bookingId`;
operator `/manage/bookings?view=month`.

1. **Renter search** — open `/search`, pick Osaka pickup + dates → storefront cards across all 3 operators with per-class min price.
2. **Storefront** — open *Best Car Rental — Kansai Airport (KIX)* → available vehicles grouped by ACRISS class.
3. **Select** — pick a vehicle → plate, price, insurance options shown. (`/bookings/new` requires a logged-in renter; it redirects to `/login` otherwise.)
4. **Book** — choose insurance, confirm.
   - ✅ **#493 fixed.** Live booking submit works: thread creation runs through `runTx` (neon-serverless), not the HTTP driver. Requires the API's `DATABASE_URL` to be the Neon **pooled** endpoint (`-pooler`); on a deployed Worker / `wrangler dev` it commits and returns a confirmation code. (Confirm once via the manual deploy smoke — AC bullet 1 of #493.)
5. **Operator view** — log in as `owner@best-car-rental.local` → `/manage/bookings?view=month` shows the seeded bookings on the calendar (event title = renter name) + notification badge. Operator-2 portal cannot see operator-1 bookings (tenant isolation).
6. **Range** — switch locale to `ja` / `zh` on the renter pages.

---

## 5. Known gaps (interim)

- Full customer demo (pay → partner revenue, pre-auth handoff narration) is **#488**.
- First-load JS baseline 554.9 kB > 500 kB target — signed exception, see plan §7.1 (resolved by #378).
