# Marketplace Demo Runbook — renter books, operator sees it (Path A)

> **Scope.** Verifies the shipped marketplace happy path end to end on the real
> stack: *renter search → storefront → vehicle → instant-book → confirmation →
> operator sees it*. This is the **#488** final demo, scoped to **Path A**
> (instant-book / pay-at-pickup — no online Stripe charge) to match what ships in
> the Vite app (#511). It began as the #390 interim core-path and was re-pointed
> to the Vite UI when the web app moved off Next.js (#378).
>
> **Deferred — not in this runbook:** the Stripe *pay* step (#461 backend exists;
> the renter flow is intentionally instant-book) and the admin *partner-revenue
> 4%* tab (#462). The authoritative proof is the automated real-DB E2E lane (§3);
> the manual click-through (§4) is for narration.

---

## 1. What is seeded

After the marketplace fixture is seeded (`db:seed:tcp` against local Postgres, or
`db:seed` + `db:seed-bookings` against a Neon branch):

- **3 operators** · **9 locations** · **12 ACRISS classes** · **41 vehicles** · **6 insurance options** · **10 fee schedules**
- **4 renters** · **10 bookings** (+ booking_events + notification_log rows), **0 FK orphans**
- Key identities for the walkthrough:
  - Renter: `sarah@example.test` (role `RENTER`)
  - Operator: `owner@best-car-rental.local` (role `OPERATOR_OWNER`, Best Car Rental)
  - `Kansai Airport (KIX)` storefront carries 4 vehicles (the happy-path run consumes one for a far-future window).

All seed ids are deterministic UUIDs (`seedId(slug)` — `packages/shared/src/db/seed-id.ts`); fixtures keep readable slugs.

---

## 2. Cold start

```bash
git fetch origin
# fresh worktree or fast-forwarded local branch off origin/marketplace-pivot
bun install

# Local Postgres — no Neon branch (#542). Spin up a disposable container:
docker run -d --name kuruma-e2e-pg \
  -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_e2e \
  -p 5433:5432 postgres:16
export DATABASE_URL='postgresql://kuruma:kuruma@localhost:5433/kuruma_e2e'
bun run db:migrate
bun run db:seed:tcp          # seeds over postgres-js/TCP; the neon-http getDb() can't reach a local container
bun run db:verify            # must show 4 green checks

# Alternatively, against a fresh Neon branch off the merged pivot (NOT production):
#   export DATABASE_URL=<neon-branch-pooled-url>
#   bun run db:migrate && bun run db:seed && bun run db:seed-bookings && bun run db:verify
```

For local Google login through the Vite shell (only needed for the **manual**
walkthrough in §4, on the normal `bun run dev` web at :3001), the API's OAuth
callback must use the web dev origin so the browser returns through Vite's
`/auth` proxy:

```bash
AUTH_URL=http://localhost:3001
WEB_POST_LOGIN_URL=http://localhost:3001/en
```

Register `http://localhost:3001/auth/google/callback` in the local-demo Google
OAuth client, then run the web + API in two terminals:

```bash
bun --env-file=.env run dev:api
bun run dev
```

---

## 3. Verify the core path (automated — the merge gate)

The honest proof of the journey. It runs the real **Vite** web (`vite --port 3002`,
proxying `/api` + `/auth` to the Hono API) → real Hono API (postgres-js) → the
seeded **local Postgres** (or a Neon branch), authenticated with a minted
**`kuruma_session`** HS256 cookie (`e2e/real-db/mint-session.ts`, mirroring the
API's `mintSessionToken` contract).

```bash
# One-shot against local Postgres — boots a throwaway postgres:16, migrates,
# seeds (TCP), and runs the lane. No Neon branch, no manual env (#542):
bun run test:e2e:real-db:local
#   docker rm -f kuruma-e2e-pg    # tear the container down afterwards

# Or point it at an already-seeded DB yourself (local container or Neon pooled URL):
AUTH_SECRET=<any 32+ char secret> DATABASE_URL=<postgres-url> bun run test:e2e:real-db
```

Expected: **3 passed** (2 session-mint + the marketplace happy-path). The
happy-path spec (`e2e/real-db/marketplace-happy-path.auth.spec.ts`) drives:
renter search → Best Car Rental KIX storefront → vehicle → the 5-step wizard
(Continue ×3 → Continue to payment → **Reserve now**) → confirmation code
(`/^[2-9A-HJ-NP-Z]{8}$/`) → operator sees the booking in the **list** at
`/manage/bookings` (asserted by the booking-code cell) + an
`OPERATOR_BOOKING_ALERT` row in `notification_log`.

> `locations.auth.spec.ts` is quarantined in the config — the operator
> `/manage/locations` page is the retired Next.js one; its Vite port is **#529**.

> **Why the lane uses a postgres-js API server.** The booking → thread-creation path opens an
> interactive transaction. Production runs these via `runTx` (neon-serverless) since **#493**,
> but the lane keeps `e2e/real-db/real-api-server.ts` on postgres-js (TCP) to exercise the real
> path without opening a WebSocket per transaction. `pgConnectOptions` turns TLS off for a
> localhost container and keeps `ssl: 'require'` for remote hosts; with a Neon `DATABASE_URL`,
> use the **pooled** endpoint (`-pooler`).

---

## 4. Manual walkthrough (narration)

Routes (locale-prefixed, e.g. `/en`): `/search` → `/storefronts/[locationId]?from&to`
→ `/bookings/new?vehicleId&locationId&from&to` → `/bookings/confirmation?bookingId`;
operator `/manage/bookings`.

1. **Renter search** — open `/search`, pick Osaka pickup + dates → storefront cards across all 3 operators with per-class min price.
2. **Storefront** — open *Best Car Rental — Kansai Airport (KIX)* → available vehicles grouped by ACRISS class.
3. **Select** — "Book this car" → `/bookings/new` carries `vehicleId` + `locationId` + dates. (Requires a logged-in renter; redirects to `/login` otherwise.)
4. **Book (5-step wizard)** — Dates (pre-filled, read-only) → Extras (optional) → Insurance (default **No insurance**) → Review → Payment. Click **Reserve now**. Instant-book: **no online charge** — you pay at pickup via the operator's pre-authorization link.
5. **Confirmation** — reservation code + status **Confirmed** + the pre-auth handoff card (the operator's payment link; hidden if the operator set none).
6. **Operator view** — log in as `owner@best-car-rental.local` → `/manage/bookings` lists the booking (newest first; renter name + code) + notification badge. Tenant isolation: the operator-2 portal cannot see operator-1 bookings.
7. **Range** — switch locale to `ja` / `zh` on the renter pages.

---

## 5. Known gaps / follow-ups

- **Out of Path A scope:** the Stripe *pay* step and the admin *partner-revenue 4%* tab — #461 (live Stripe) / #462 (Vite admin portal).
- **Local Postgres for this lane — #542 (done).** `db:seed:tcp` seeds over postgres-js/TCP and `pgConnectOptions` turns TLS off for localhost, so the lane runs against a disposable `postgres:16` with no Neon branch — `bun run test:e2e:real-db:local` (§3).
- **CI gate — #445 (done).** The `e2e-real-db` job runs this lane against a fresh `postgres:16` service container (no Neon branch, no external secrets) and is a required check on `marketplace-pivot`.
- **Operator locations port — #529.** Re-enables `locations.auth.spec.ts` in this lane.
