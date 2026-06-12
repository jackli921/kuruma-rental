# #528 — Port operator vehicle classes CRUD to Vite — Handoff

**Status:** IN PROGRESS 2026-06-12. Slices 1-2 DONE + committed, NOT pushed.
**Worktree:** `~/Dev/kuruma-528-operator-classes` · branch `feat/528-operator-classes-vite` · off `origin/marketplace-pivot@1cd08e4` · tip `93f8f1e`.
**Issue/plan:** GitHub #528 (part of epic #523). Labeled `in-progress`.

## How to resume

```bash
cd ~/Dev/kuruma-528-operator-classes
git log --oneline -3            # expect 93f8f1e (slice 2), d75b516 (slice 1)
# rebase onto latest mp when ready (NO force-push — reset/cherry-pick/ff per repo rule)
git fetch origin && git rebase origin/marketplace-pivot
bun install                    # fresh worktree hygiene
```

Test runners (NOT `bunx vitest` from root):
- api: `bun run --filter @kuruma/api test -- --run <file>`
- web: `bun run --filter @kuruma/web test -- --run <path>`

## Key finding (the reason this slice exists / scope note)

`GET /vehicle-classes` is the **public catalog**: `PUBLIC_CONTEXT`, ACTIVE-only,
edge-cached, registered **before** `requireAuth`. It silently ignores the
`includeArchived` param + bearer token the frozen Next.js owner page sends. So
the operator "manage classes" list was never tenant-scoped and archived classes
never appeared. `service.findAll(ctx, filters)` / `repo.findAll` already support
scope + includeArchived — only the route didn't expose it. Hence slice 1 adds a
protected list endpoint. **No schema/migration.** Conflict-free vs #526/#549/#394.

## Done

### Slice 1 — backend (`d75b516`)
- `packages/api/src/routes/vehicle-classes.ts`: added protected
  `GET /vehicle-classes/manage` (session-scoped via `toCallerContext`, honors
  `?includeArchived=true`). Registered **before** `/:id` so the static segment
  wins over the param route.
- `packages/api/tests/routes/vehicle-classes.test.ts`: +3 tests (archived
  inclusion, default-excludes-archived, tenant isolation OP_A vs OP_B). 47/47 green.

### Slice 2 — Vite api client (`93f8f1e`)
- `packages/web/src/vite/operator-classes/api.ts`: cookie-auth client
  (`credentials:'include'`, no token). `fetchOperatorClasses` → `/vehicle-classes/manage`;
  `createOperatorClass` (POST), `updateOperatorClass` (PATCH), `archiveOperatorClass`
  (DELETE = soft archive); `operatorClassesQueryOptions` keyed on `includeArchived`;
  `OperatorClass` DTO. Mirrors `vite/operator-bookings/api.ts`; never imports the
  frozen Next module.
- `packages/web/tests/vite/operator-classes/api.test.ts`: 6 unit tests. Green.

## Remaining — slices 3-6 (web port). Mirror `vite/operator-bookings/`.

Route file to create: `packages/web/src/routes/$locale/_business/manage/classes.tsx`
(copy `bookings.tsx`: `loader: ensureQueryData(operatorClassesQueryOptions({includeArchived:true}))`,
`pendingComponent: PageSkeleton`, `errorComponent`, `useSuspenseQuery`). Behind the
existing `_business.tsx` membership guard. Regen routeTree after adding the file.

Port-source components in `packages/web/src/modules/classes/components/` (translate
next-intl → use-intl, server-actions → the slice-2 client, keep shadcn/Zod):
`ClassList.tsx` → `OperatorClassesView`, plus `ClassForm`, `AddClassDialog`,
`EditClassDialog`, `DeleteClassDialog`, `ClassRow`, `ClassStatusBadge`.

- **Slice 3 — list render:** `OperatorClassesView` + route; tests for data / empty /
  error / `_business` guard redirect (mirror operator-bookings route test).
- **Slice 4 — add:** AddClassDialog → `createOperatorClass`; slug-collision 409
  surfaced in form; list refetch/invalidate `['operator-classes']`.
- **Slice 5 — edit:** EditClassDialog → `updateOperatorClass`; preserve operator-scope
  edit options + archived `classId` assignment (**#456 parity**).
- **Slice 6 — archive + polish:** DeleteClassDialog → `archiveOperatorClass`; surface
  server 409 "Cannot archive a class with active bookings" (guard is server-side
  authoritative — `extras.activeBookingsCount`). Luggage on `ClassRow` (**#504**).
  Add "Classes" link to business nav.

### Decisions baked in
- **Stats degrade:** Next.js `ClassList` shows per-class car/active-booking counts
  from `fetchFleetOverviewAction` (fleet-overview not yet ported; #526 not landed).
  **Degrade to 0 / omit** rather than depend on #526 — keeps this slice independent.
  Archive guard is server-side anyway.
- **i18n:** port the `business.classes` namespace into the Vite use-intl messages
  (new namespace → may need dev-server restart per repo gotcha).

## Gotchas
- Pre-commit runs biome + full web/api tsc. Run `bunx biome check --write <files>`
  before committing to avoid the format-fail revert cycle.
- Route ordering: any new static `/vehicle-classes/<x>` must be registered before `/:id`.
- No force-push (HARD-DENIED). Rebase via reset→cherry-pick→ff-push; clear BEHIND
  with `gh pr update-branch`.

## Definition of done
All 6 slices green; `bun run --filter @kuruma/api test` + `--filter @kuruma/web test`
+ `lint:boundaries` + tsc pass; push; open PR `Closes #528`; drop `in-progress`.
