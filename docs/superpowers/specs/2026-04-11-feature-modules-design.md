# Feature Modules & Fan-Out Discipline

**Date:** 2026-04-11
**Status:** Approved — ready for implementation plan
**Owner:** Jack

## Motivation

A veteran engineer's heuristic: *a healthy software project becomes more modular and stable over time, so late-stage small changes should touch only a few files. If small tweaks require edits across many files, the architecture is in trouble.*

Recent work on this repo confirms the pain. A single semantic change — adding vehicle pricing fields, adding rental rules, adjusting the fleet card — routinely touches 8–12 files across the schema, validators, API routes, repositories, web lib, components, and messages. The pain is small today because the codebase is small, but the scatter is already forming. We fix it now while the migration cost is cheap.

This spec defines:

1. A target feature-module layout for `packages/api` and `packages/web`
2. Concrete rules that enforce thin controllers, deep services, and single public surfaces
3. Mechanical enforcement via Biome lint rules, a file-size check, and a pre-commit hook
4. A sequenced migration plan that ships the rules first, then pilots on vehicles, then bookings, and grandfathers the rest

Out of scope: restructuring `packages/shared` (schema and validators already live in sensible per-feature files), design-system primitives in `components/ui`, and anything in `packages/api/src/repositories/drizzle.ts` that isn't tied to a feature being migrated.

## Principles

Drawn from John Ousterhout's *A Philosophy of Software Design* and the `bulletproof-react` reference architecture.

- **Healthy code gets more modular over time.** A mature feature should be editable by touching one folder.
- **Deep modules.** Simple public interface, rich hidden implementation. The `index.ts` is the only door; everything else is private.
- **Thin controllers, deep services.** Routes parse and delegate. Services own business rules. Repositories move data and nothing else.
- **One feature = one folder.** Every semantic change should have a natural home that is a single folder.
- **Rule of three for DRY.** Duplicate first, extract on the third use. Premature extraction is worse than duplication.
- **Explicit public surface.** Cross-module imports only go through `index.ts`. Internals are invisible to the rest of the codebase.

## Target Layout

### `packages/shared/` — unchanged

Schema and validators are already split per-feature-by-file. No moves.

```
packages/shared/src/
  db/schema.ts         # centralized Drizzle schema (intentional — enables migration generation)
  validators/          # already per-feature: auth.ts, vehicle.ts, booking.ts, …
  types/
  lib/                 # cross-package primitives
```

### `packages/api/` — grows `modules/<feature>/`

Existing `routes/` and `repositories/` fold into per-feature modules. The monolithic `repositories/drizzle.ts` is split by feature during each migration PR.

```
packages/api/src/
  modules/
    vehicles/
      routes.ts        # thin Hono controller: parse input, call service, shape response
      service.ts       # business rules, invariants, orchestration
      repo.ts          # Drizzle queries only, no logic
      index.ts         # public surface — typically { router, types }
      routes.test.ts
      service.test.ts
      repo.test.ts
    bookings/
    messages/
  lib/                 # cross-module helpers: auth middleware, error handlers, pagination helpers
  app.ts               # mounts each module's router
```

### `packages/web/` — grows `modules/<feature>/`

Feature code in `lib/*`, `components/*`, and `actions/*` folds into `modules/<feature>/`. Pages in `app/` stay thin.

```
packages/web/src/
  modules/
    vehicles/
      api.ts             # fetch calls to Hono API
      components/        # VehicleForm, VehicleCard, FleetFilters, …
      hooks.ts           # useVehicles, useVehicleFilters
      types.ts           # feature-local TS types
      index.ts           # public surface: components + hooks + types the rest of the app needs
      *.test.ts / *.test.tsx
    bookings/
    auth/                # already exists — the pattern in miniature
  lib/                   # cross-module primitives: api-client base, format, utils
  components/ui/         # shadcn design-system primitives — NOT a feature
  app/…/page.tsx         # thin composition: `import { X } from '@/modules/<feature>'` then render
```

### Key moves the migration PRs will perform

- `lib/vehicle-api.ts` + `lib/vehicles.ts` + `lib/fleet-filters.ts` + `components/vehicles/*` → `modules/vehicles/*`
- `lib/booking-api.ts` + `lib/bookings.ts` + `lib/calendar.ts` + `components/bookings/*` + `components/calendar/*` → `modules/bookings/*`
- `api/routes/vehicles.ts` + vehicle queries from `repositories/drizzle.ts` → `api/modules/vehicles/*`
- `api/routes/bookings.ts` + booking queries from `repositories/drizzle.ts` → `api/modules/bookings/*`

## The Rules

| # | Rule | Mechanism |
|---|---|---|
| R1 | **Feature = one folder.** New features live under `src/modules/<feature>/`. | Convention + code review |
| R2 | **Single public surface.** Outside code may only import from `@/modules/<feature>` (resolves to `index.ts`). Reaching into `@/modules/<feature>/anything-else` is forbidden. | Biome `noRestrictedImports` |
| R3 | **No cross-module internal imports.** `modules/bookings/*` cannot import from `modules/vehicles/components/*`. Must go through the `index.ts` barrel. | Biome `noRestrictedImports` |
| R4 | **Thin controllers.** `routes.ts` may not contain business logic — only parse input, call service, shape response. Hard cap: 150 lines. | File-size lint |
| R5 | **Deep, single-responsibility services.** Each `service.ts` owns one domain. No "misc" or "utils" services. | Code review |
| R6 | **Repositories are pure data access.** No validation, no side effects, no cross-table business rules. | Code review |
| R7 | **Pages are thin.** `app/.../page.tsx` contains no business logic — only composition from `@/modules/*`. Hard cap: 80 lines. | File-size lint |
| R8 | **File size caps.** Source files (`.ts`/`.tsx`, excluding tests and generated code): soft warn at 400 lines, hard fail at 800 lines. | Custom line-count script |
| R9 | **Rule of three for DRY.** Extract a helper only when the same logic appears three or more times. Inline duplication is allowed until then. | Convention |
| R10 | **Cross-module helpers live in `lib/`,** never inside another module. If `modules/bookings` needs something from `modules/vehicles`, either (a) vehicles exports it from `index.ts`, or (b) it is actually a generic helper and belongs in `lib/`. | Code review, reinforced by R3 |
| R11 | **Tests colocate with the code they test.** `modules/vehicles/service.test.ts` sits next to `service.ts`. | Convention |
| R12 | **`index.ts` exports only what is needed outside the module.** If nothing outside uses a symbol, it does not belong in `index.ts`. | Code review |

## Enforcement

Three layers, all three land in PR-1 (the scaffolding PR):

### 1. Documentation

- New file `docs/architecture/modules.md` containing the rules table, the target layout, one worked example per rule, and the grandfather policy.
- Short pointer in `CLAUDE.md` directing future sessions to the architecture doc.

### 2. Biome lint rules

- **`noRestrictedImports`** configured with glob patterns forbidding imports matching `**/modules/*/!(index)` from outside that module directory. Implements R2 and R3. Biome's support for deep-glob patterns in `noRestrictedImports` must be verified during implementation — see "Implementation risks" below.
- **Custom line-count script** (`scripts/lint-file-size.ts`) run via `bun run lint:size` and wired into `bun run lint`. Warns at 400 lines, fails at 800 lines for general source. Tighter caps for files matching `**/routes.ts` (150) and `**/app/**/page.tsx` (80). Implements R4, R7, R8. Skips tests, generated code, `.next/`, and legacy-grandfathered paths.

### 3. Pre-commit hook

- `.husky/pre-commit` (or plain `.git/hooks/pre-commit`) runs `bun run lint` and `bunx tsc --noEmit` on staged files via `lint-staged`. Stays fast because it only checks changed files. Target: under 5 seconds for a typical commit.

## Implementation risks

| Risk | Mitigation |
|---|---|
| Biome `noRestrictedImports` may not support the deep-glob pattern needed for R2/R3 in the current version. | Verify during PR-1 spike. Fallback option A: tiny custom Node script that walks the AST and runs in the lint pipeline. Fallback option B: add ESLint alongside Biome for this single rule. Either fallback is acceptable — do not delay the PR waiting for upstream Biome support. |
| Pre-commit hook adds friction to commits that are intentional WIP. | `lint-staged` only checks staged files, keeping runtime low. `git commit --no-verify` is always available as an escape hatch for genuine WIP commits, but it should be rare. |
| PR-2 (vehicles pilot) touches many files at once, which feels like a violation of the rules we are introducing. | This is a one-time migration, not a "small change". Call it out explicitly in the PR description. Future vehicles changes should touch few files — that is the success criterion we measure the pilot against. |
| Splitting `repositories/drizzle.ts` into per-feature repo files during PR-2 and PR-3 may change query behavior subtly. | Integration tests for vehicles and bookings must stay green through each migration PR. Run `bun run --filter @kuruma/api test:integration` before merging. |

## Migration Plan

Sequenced as four independently-mergeable PRs.

### PR-1 — Scaffolding and rules

- `docs/architecture/modules.md` created.
- `CLAUDE.md` pointer added.
- Biome config updated with `noRestrictedImports` rules (or fallback).
- `scripts/lint-file-size.ts` added and wired into `bun run lint`.
- `.husky/pre-commit` + `lint-staged` config added.
- Empty `modules/` directories created in `packages/api/src` and `packages/web/src` with placeholder `.gitkeep` files.
- No source file moves.

Acceptance: `bun run lint` passes on current code (with legacy paths exempted via Biome `overrides`), pre-commit hook fires and runs quickly, docs merged.

### PR-2 — Vehicles pilot

- `packages/web/src/modules/vehicles/` created, absorbs `lib/vehicle-api.ts`, `lib/vehicles.ts`, `lib/fleet-filters.ts`, and `components/vehicles/*`.
- `packages/api/src/modules/vehicles/` created, absorbs `routes/vehicles.ts` and the vehicle-related queries from `repositories/drizzle.ts`.
- All imports across the monorepo updated.
- Tests move with code. Integration tests stay green.
- Legacy paths removed from Biome `overrides` for vehicles only.

Acceptance: `bun run lint`, `bun run test`, `bun run --filter @kuruma/api test:integration`, and `bun run --filter @kuruma/web build` all pass. A re-running of the "add a pricing field" exercise touches noticeably fewer files than it did before.

### PR-3 — Bookings migration

- Same shape as PR-2 for the bookings feature, including `lib/booking-api.ts`, `lib/bookings.ts`, `lib/calendar.ts`, `components/bookings/*`, `components/calendar/*`, `api/routes/bookings.ts`, and booking-related queries from `repositories/drizzle.ts`.
- Legacy paths removed from Biome `overrides` for bookings and calendar.

Acceptance: same gates as PR-2.

### Grandfather — messaging, dashboard, misc

- Messaging, dashboard stats, and anything else not under `modules/<feature>/` remain in place.
- `CLAUDE.md` gains a short note: *"When you next make a non-trivial change to messaging, dashboard, or any feature still under `lib/` or `components/<feature>/`, migrate it into `modules/<feature>/` in the same PR. Do not open a standalone migration PR."*
- R8 (file-size cap) applies globally — no grandfather exemption for size. R2/R3/R4/R7 only apply to code inside `modules/`.

## Grandfather Policy

Legacy files are exempt from R2/R3/R4/R7 via a Biome `overrides` block that targets everything outside `**/modules/**`. R8 (file size) applies globally with no exemption, because size discipline is independent of modularization and applies to every file.

When a grandfathered feature is touched for any non-trivial change, the touching PR migrates it to `modules/<feature>/` in the same commit. The `CLAUDE.md` note above is the trigger for future sessions.

## Success Criteria

- A typical "add a field to vehicles" change touches ≤ 4 files after PR-2 lands.
- A typical "add a booking status" change touches ≤ 4 files after PR-3 lands.
- `bun run lint` catches cross-module internal imports with a clear error message.
- Pre-commit hook runs in under 5 seconds on a typical commit.
- No regression in test pass rate, build success, or deploy health through the migration sequence.

## References

- John Ousterhout, *A Philosophy of Software Design* — deep modules, interface vs. implementation complexity
- `bulletproof-react` — canonical feature-folder layout for production React apps
- Existing `packages/web/src/modules/auth/` — the pattern already in use, in miniature
- `CLAUDE.md` "Vertical Slice TDD" section — philosophically aligned: this spec extends vertical slicing from the delivery layer down into the code layer
