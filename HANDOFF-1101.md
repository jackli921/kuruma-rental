# Handoff — #1101 vehicle_blocks backend slice

_Last updated: 2026-06-25. Do not commit this file (scratch handoff; delete before PR)._

## Setup (run first)

```bash
cd /Users/jack/Dev/kuruma-1101-vehicle-blocks
export DATABASE_URL="postgres://kuruma:kuruma@localhost:5434/kuruma_test"
```

- **Worktree/branch:** `feat/1101-vehicle-blocks`, base `develop`. Issue #1101 (epic #1099). Backend only; UI band is later.
- **Test DB:** docker `postgres:16` container `kuruma-1101-pg` on **:5434**, migrated through 0076, `db:verify` 5/5.
  Recreate if gone: `docker run -d --rm --name kuruma-1101-pg -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_test -p 5434:5432 postgres:16` then `DATABASE_URL=... bun run db:migrate`.

## Commits on branch (vs develop)

- `f4a010cd` slice 1 — `vehicle_blocks` table + `vehicle_blocks_no_overlap` GiST EXCLUDE + CHECK (migrations 0075/0076).
- `727893f8` slice 2 — VehicleBlock repository + availability subtraction.
- `a5695c1c` slice 3 — booking-vs-block guard in the booking submit.

## DONE — slices 1–3 (committed, all gates green)

- **S1:** enums (`VEHICLE_BLOCK_KINDS`), `vehicleBlocks` table in `db/fleet.ts`, block-vs-block EXCLUDE + `end_after_start` CHECK, composite-FK operator seal. real-pg constraint test.
- **S2:** `VehicleBlock` entity (`stores.ts`), `VehicleBlockRepository` port (`create`/`findById`/`findOverlapping`/operator-scoped `delete`), InMemory + Drizzle impls, barrels, `Repos` bundle + 3 builders + `AppOverrides`. Availability subtracts blocks in BOTH impls: Drizzle `NOT EXISTS vehicle_blocks` in `findAvailableVehicles` + `checkVehicleAvailability`; in-memory takes the block port as a **required** 3rd ctor arg (a default `new InMemory…` trips `lint:boundaries` — keep it required) and mirrors. Block flips `available` without polluting `conflicts`.
- **S3:** SPECIFIC booking create rejects 409 `VEHICLE_BLOCKED` when a block overlaps `[startAt, effectiveEndAt)` (turnaround-inclusive, must-fix #1). Service-level NOT EXISTS via `repos.vehicleBlockRepo.findOverlapping`; threaded a read-only `Pick<…,'findOverlapping'>` through `TransactionRepos` (rebound in `drizzle/transaction.ts`; passed through both in-memory runners). New `VEHICLE_BLOCKED` code in `@kuruma/shared/lib/error-codes.ts` (+ its pinned test).

Tests: api **1923 unit + 337 integration** green, shared green, `db:verify` 5/5, `lint:boundaries` OK, biome clean.

## REMAINING — slices 4–5

### Slice 4 — pg-errors mapping (small)
- `src/pg-errors.ts`: add `VEHICLE_BLOCKS_OVERLAP = 'vehicle_blocks_no_overlap'` constant (pattern: `BOOKING_CODE_CONSTRAINT` etc. ~L52). The slice-5 blocks route distinguishes a 23P01 on it (→ "blocked for maintenance") from `bookings_no_overlap` (→ "already booked"). The DrizzleVehicleBlockRepository.create currently lets a 23P01 bubble; the route maps it.

### Slice 5 — routes + validators + DI (the last vertical slice)
- `POST /vehicles/:id/blocks` + `DELETE /vehicles/:id/blocks/:blockId`, operator-scoped. Gate like `routes/maintenance-logs.ts:13` (`MANAGEMENT_READ_ROLES`, scope-through-vehicle). **operatorId server-derived from the vehicle — never client-supplied.** Map block EXCLUDE 23P01 (slice 4 constant) → 409 "blocked for maintenance"; CHECK 23514 → 400; FK 23503 (foreign/cross-tenant vehicle) → 404.
- Likely needs a thin `VehicleBlockService` (the route has domain policy: resolve vehicle in caller tenant → derive operatorId → create/delete) rather than a sanctioned thin-read route. `delete` is already operator-scoped at the repo (defence-in-depth).
- Validators in `packages/shared/src/validators/` (mirror an existing one): `kind` enum, `reason` required, `startAt`/`endAt` (`endAt > startAt`), optional `notes`.
- Wire route in `index.ts` (the `vehicleBlockRepo` is already on the `Repos` bundle). Add `vehicle_blocks` route tests: create/delete happy path + cross-operator 403/404 + overlap 409.

## Known follow-ups (document in PR, don't silently skip)
- **Schedule-during-checkout race (no per-vehicle advisory lock).** S3 ships the NOT EXISTS guard without `pg_advisory_xact_lock('veh:'+id)`. The issue frames the lock as optional + the race "tiny + operator-recoverable" at 1 operator / 40-50 cars. Decision: skipped intentionally (YAGNI); file as a follow-up. To add later: a `lockVehicleSchedule(vehicleId)` taken by BOTH the SPECIFIC booking path AND the slice-5 block-create path.
- **Combo-capacity vs blocks:** `countClassCapacity` is asOf-point, not windowed, so a CLASS_COMBO could be sold onto a car blocked for a sub-window. Out of scope; needs its own design. File a follow-up.
- **Block-over-existing-booking** is allowed (acceptance criteria only guard booking-vs-block on the booking side). Block-vs-block is the only DB seal on the block-create path.

## Gates before PR
- `DATABASE_URL=… bun run --filter @kuruma/api test:integration` (real-pg)
- `env -u DATABASE_URL bun run --filter @kuruma/api test` + `--filter @kuruma/shared test`
- `bun run --filter @kuruma/api typecheck` + `--filter @kuruma/shared typecheck`
- `bun run db:verify` (5/5) + `bun run --filter @kuruma/api lint:boundaries`
- ⚠️ `tests/` is NOT covered by `tsc` — broken in-memory wiring surfaces only at test runtime. Run the unit suite, don't trust typecheck alone.
- ⚠️ Pre-commit runs biome `check` (sorts imports) — `bun run format` (biome `format`) does NOT sort. Run `bunx biome check --write packages/api packages/shared` before committing or the hook fails.
- Then `/code-review` + `architect-review`, fix, `gh pr create` with **`Refs #1101`** (UI band still pending — not `Closes`) + `gh issue` housekeeping.

## Resume command
`cd /Users/jack/Dev/kuruma-1101-vehicle-blocks && export DATABASE_URL="postgres://kuruma:kuruma@localhost:5434/kuruma_test"` then continue at Slice 4.
