# Feature Modules & Fan-Out Discipline

This is the canonical rules doc. The design rationale lives in
`docs/superpowers/specs/2026-04-11-feature-modules-design.md`.

## The one-line rule

**A small semantic change should touch few files.** If you can't make a small
change without editing a dozen files, the architecture is wrong — fix the
architecture, don't fight it.

## Target layout

Feature code lives under `src/modules/<feature>/` in each package.

### packages/api

    modules/<feature>/
      routes.ts      # thin Hono controller: parse, call service, respond
      service.ts     # business rules, invariants, orchestration
      repo.ts        # Drizzle queries only, no logic
      index.ts       # public surface (usually { router, types })
      *.test.ts

Cross-module helpers live in `packages/api/src/lib/`. `app.ts` mounts each
module's router.

### packages/web

    modules/<feature>/
      api.ts         # fetch calls to the Hono API
      components/    # feature components (VehicleForm, BookingCard, …)
      hooks.ts       # feature-specific hooks
      types.ts       # feature-local types
      index.ts       # public surface
      *.test.ts / *.test.tsx

Pages in `src/app/.../page.tsx` stay thin and import from
`@/modules/<feature>`. Cross-module primitives go in `src/lib/`. Design-system
primitives stay in `src/components/ui/`.

### packages/shared

No changes. Schema and validators already live in per-feature files.

## The rules

| # | Rule | Enforced by |
|---|---|---|
| R1  | Feature = one folder under `src/modules/<feature>/` | convention + review |
| R2  | Single public surface: import only from `@/modules/<feature>` (the barrel) | `scripts/lint-module-boundaries.ts` |
| R3  | No cross-module internal imports | `scripts/lint-module-boundaries.ts` |
| R4  | `routes.ts` contains no business logic, max 150 lines | `scripts/lint-file-size.ts` |
| R5  | `service.ts` has one responsibility, no "misc" or "utils" services | review |
| R6  | `repo.ts` is pure data access, no validation, no side effects | review |
| R7  | `page.tsx` is thin composition, max 80 lines | `scripts/lint-file-size.ts` |
| R8  | Source files: soft warn at 400 lines, hard fail at 800 lines | `scripts/lint-file-size.ts` |
| R9  | Rule of three for DRY: duplicate first, extract on the third use | convention |
| R10 | Cross-module helpers live in `lib/`, never inside another module | R3 + review |
| R11 | Tests colocate with the code they test | convention |
| R12 | `index.ts` exports only what the outside actually uses | review |

## Grandfather policy

Legacy files under `lib/` and `components/<feature>/` are exempt from
R2/R3/R4/R7 until they are migrated. R8 (file size) applies everywhere.

**Migrate before you modify.** Before making any non-trivial change to a
grandfathered feature, land a standalone migration PR that moves it into
`modules/<feature>/`. The feature-change PR builds on top. Migrations and
feature changes never share a PR.

Trivial exceptions: typo fixes, one-line string tweaks, dependency bumps.

## How to add a new feature

1. Create `packages/api/src/modules/<feature>/` with `routes.ts`,
   `service.ts`, `repo.ts`, `index.ts`, and tests.
2. Mount the router in `packages/api/src/app.ts`.
3. Create `packages/web/src/modules/<feature>/` with `api.ts`,
   `components/`, `hooks.ts`, `types.ts`, `index.ts`, and tests.
4. Import from `@/modules/<feature>` in pages. Never reach into internals.
5. Run `bun run lint` before committing.

## How to migrate a grandfathered feature

1. Create the `modules/<feature>/` folders in api and web.
2. Move files into their new homes (one commit per logical move).
3. Update imports across the monorepo (can be done in the same commit as
   the move, since the move would break the build otherwise).
4. Move tests alongside the code they test.
5. Run `bun run lint`, `bun run test`, `bun run --filter @kuruma/api test:integration`,
   and the relevant builds. All must pass.
6. Open the migration PR. It should contain only file moves and import
   updates — no logic changes.
