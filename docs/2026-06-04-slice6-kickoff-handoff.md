# Slice 6 — Kickoff Handoff (issue #392)

**Date:** 2026-06-04
**Plan (source of truth):** `docs/plans/2026-06-02-slice6-booking-event-log.md` (Draft v2, review-cleared) — lives on `marketplace-pivot` alongside the code, so it is in your worktree.
**Epic:** #385 · **Proposal:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md`

This doc is the **ready-to-paste prompt** for an agent to implement slice 6. Copy the block below.
Read the "Coordination" section first if you intend to run more than one agent.

---

## Coordination (read before dispatching)

- **Slice 6 is ONE vertical slice = ONE worktree = ONE owning agent.** The booking submit is a single DB transaction (availability + row + event + snapshots); it does not parallelize cleanly. Do **not** put two sessions in one worktree — that caused the #407 collision (`docs/2026-06-04-operator-picker-collision-handoff.md`).
- **Safe parallelism (optional):** the confirmation-page UI + i18n (§6 "Confirmation page", web layer) can be a *second* agent **only after** the API contract (validators + route response shape) has landed in the branch. Until then it has nothing stable to build against. If you split, the web agent works in the *same* worktree on different files, after a sync — or waits.

---

## PASTE-THIS PROMPT

> You are implementing **Slice 6 — Booking & Event Log** for the kuruma-rental marketplace MVP. Work autonomously, TDD, vertical slice.
>
> **1. Source of truth.** Read `docs/plans/2026-06-02-slice6-booking-event-log.md` end to end before writing any code — it is on `marketplace-pivot`, so it is right there in your worktree (step 2). It is Draft v2 and review-cleared — build exactly the contract it describes. Also skim `AGENTS.md` (layer boundaries) and the project `CLAUDE.md` gotchas. If the plan contradicts the code you find, STOP and surface it — do not silently pick one.
>
> **2. Branch & worktree.** Base branch is **`marketplace-pivot`** (NOT `main`). Create a worktree:
> `git fetch origin && git worktree add ../kuruma-slice6 -b feat/slice6-booking-events origin/marketplace-pivot`
> then `cd ../kuruma-slice6 && bun install` and confirm `bunx tsc --noEmit` is clean before touching anything.
>
> **3. Database connection (CRITICAL).** Do NOT copy the root `.env` into the worktree — it points at the **production** Neon branch. Use the **`marketplace-pivot`** Neon branch connection string (`reference_neon-branches`). `bun run db:seed` is Neon-only. Migration workflow is non-negotiable: `bun run db:generate --name <change>` → `bun run db:migrate` → `bun run db:verify` (must show 3 green). Hand-written SQL (exclusion constraint, trigger rebind, `btree_gist` rename) uses `bun run db:generate --custom --name <name>` — never drop raw `.sql` into `drizzle/`. Sequence: **additive generated migration first, custom SQL migration second.** If you rebase and a migration's `when` ends up out of order, regenerate (don't hand-edit `_journal.json`) — see the 2026-04-17 journal-trap gotcha.
>
> **4. TDD, vertical slices (mandatory).** One failing test → minimal impl → repeat. Mutation-resistant assertions (specific values, not truthiness). Follow the §7 test table as your checklist. Mirror `packages/api/tests/integration/rls-context.test.ts` for tenant-isolation cases. Respect `routes → services → repositories` (never backwards); concrete repos wired **only** in `index.ts`.
>
> **5. Locked contract decisions (do not re-litigate — these were decided in review):**
> - **`assignedVehicleId` is server-derived**, never a client field. The submit validator requires `requestedVehicleId`; the service sets `assignedVehicleId := requestedVehicleId` after scoped validation. Any client-supplied `assignedVehicleId`/`totalPrice`/`bookingCode`/`operatorId`/snapshot fields are silently dropped.
> - **Turnaround is location-only.** **Drop `vehicles.bufferMinutes` entirely** (no per-vehicle override in MVP). Resolve `turnaround_minutes = location.defaultTurnaroundMinutes ?? 2880` (48h). Add `locations.defaultTurnaroundMinutes` (default 2880). Mutation-guard test must assert a 60-min result FAILS (proves the legacy default is gone).
> - **Substitution rule is same-ACRISS-class** (same operator, same pickup location, same class). Reject **different-ACRISS-class** vehicle (400) — there is no class rank order, so "same-or-better" is a post-MVP follow-up.
> - **Pricing is vehicle-level** (slice 4c dropped class pricing). `totalPrice` is computed server-side from the assigned vehicle's rates and is non-null on every submit. Surface the **#429** backfill guard test (assigning a vehicle to a legacy null-total booking backfills `totalPrice`).
> - **Notifications are slice 7, not here.** Slice 6 commits the booking + emits `BOOKING_CREATED` only. `ensureThread` (#335) is the existing post-commit seam — extend nothing else.
>
> **6. Merge gate (proposal §6.1).** Before opening the PR: full local CI gate green — run the complete `ci.yml` test-and-build list (`bun run test`, export-drift, fk-indexes, i18n-parity, **db-drift via `db:verify`**), plus `bun run lint` (whole repo, not file-scoped), `lint:boundaries`, `lint:modules`, `lint:size`. The **renter happy-path Playwright E2E** (search → result → vehicle → book → confirmation shows booking code + vehicle + selected insurance + potential additional charges) is a **hard merge gate**. Note `lint:deps` is continue-on-error (non-blocking).
>
> **7. Review before ship.** Run the `code-reviewer` and `architect-review` agents on the diff before the PR (per house rule). Add inline Learn-block notes for any named pattern you introduce.
>
> **8. PR & issue.** Open the PR against **`marketplace-pivot`** (squash merge). `Closes #392` will **not** auto-close (PR targets a non-default branch) — close #392 manually after merge and file follow-ups. Always rebase onto `origin/marketplace-pivot` before pushing; **never force-push**. Stay in scope — don't fix unrelated things.

---

## Quick facts for the agent

| Thing | Value |
|---|---|
| Issue | #392 (label `in-progress` on start, remove + close on done) |
| Base branch | `marketplace-pivot` |
| Worktree / branch | `../kuruma-slice6` / `feat/slice6-booking-events` |
| Depends on (all landed) | slice 1 #386, locations #387, ACRISS #388, insurance #404, fees #405, vehicle pricing 4c #406 |
| Blocks | slice 7 #393 (uses the `BOOKING_CREATED` post-commit seam), slice 8 #390 (consumes `booking_events`) |
| Follow-up to honor | #429 (null-`totalPrice` backfill guard) |
| New tables/cols | `booking_events` (new); `bookings`: +`operatorId`,`requestedVehicleId`, rename `vehicleId`→`assignedVehicleId` NOT NULL, +`pickup/dropoffLocationId`,`bookingCode`,`insuranceOptionId`,`insuranceSnapshot`,`feeSnapshot`; `locations`: +`defaultTurnaroundMinutes`; **drop** `vehicles.bufferMinutes` |
| New dep | `nanoid` (server-side `customAlphabet`, added to `@kuruma/api`) |
