# #528 — Port operator vehicle classes CRUD to Vite — Handoff

**Status:** FEATURE COMPLETE 2026-06-12. All 6 slices done + committed, **NOT pushed**.
**Worktree:** `~/Dev/kuruma-528-operator-classes` · branch `feat/528-operator-classes-vite` · off `origin/marketplace-pivot@1cd08e4` · tip `d6cbace`.
**Issue/plan:** GitHub #528 (part of epic #523). Labeled `in-progress`.

## Remaining (all that's left)

1. Rebase onto latest `origin/marketplace-pivot` (#521 has merged since branch point). **No force-push** — if already pushed, reset→cherry-pick→ff-push.
2. Push, open PR `Closes #528`, then drop the `in-progress` label.
3. Manual browser smoke (not yet done): log in as an operator → `/<locale>/manage/classes` → add / edit / archive a class; confirm archived rows show the muted badge and the nav "Classes" link works.
4. Optional `/code-review` (user-triggered/billed).

## How to resume

```bash
cd ~/Dev/kuruma-528-operator-classes
git log --oneline -7   # d6cbace..d75b516 are the 6 #528 commits + this doc
bun install
git fetch origin && git rebase origin/marketplace-pivot
```

Test runners (NOT `bunx vitest` from root):
- api: `bun run --filter @kuruma/api test -- --run <file>`
- web: `bun run --filter @kuruma/web test -- --run tests/vite/operator-classes`

## Gate (last run, all green)
- api: **1079 passed** · web: **803 passed** · api `lint:boundaries` OK · web tsc clean.
- New tests: api +3 (route), web +26 (operator-classes) + Navbar nav-count updated.
- No migration (slice 1 is route-only). No `db:verify` needed.

## Key finding (scope note)

`GET /vehicle-classes` is the **public catalog**: `PUBLIC_CONTEXT`, ACTIVE-only,
edge-cached, registered **before** `requireAuth`. It silently ignores the
`includeArchived` param + token the frozen Next owner page sends — so the operator
"manage classes" list was never tenant-scoped and archived classes never showed.
`service.findAll(ctx, filters)` / `repo.findAll` already support scope +
includeArchived; only the route didn't expose it → slice 1 adds a protected list.
No schema/migration. Conflict-free vs #526/#549/#394 (#521 merged).

## What shipped (commits)

- `d75b516` **slice 1 (api):** protected `GET /vehicle-classes/manage` (session-scoped,
  honors `includeArchived`), registered before `/:id`. +3 route tests.
- `93f8f1e` **slice 2 (web):** `vite/operator-classes/api.ts` — cookie-auth client
  (`fetchOperatorClasses` → `/manage`, create/update/archive, `operatorClassesQueryOptions`,
  `OperatorClass` DTO). 6 tests.
- `6a2e5cc` **slice 3:** `OperatorClassesView` (pure list: name, status badge, slug,
  seats/luggage, ACRISS label w/ raw fallback, sortOrder sort, empty state) +
  `ClassStatusBadge` + route `routes/$locale/_business/manage/classes.tsx` (loader +
  useSuspenseQuery + pending/error, behind `_business` guard). routeTree regenerated.
- `5e78278` **slice 4:** `ClassForm` (RHF + zodResolver + use-intl; **operator picker
  dropped** — server infers operatorId) + `AddClassDialog` (POST, slug-409 inline,
  invalidate+close) + header "Add class" button.
- `e68742e` **slice 5:** `EditClassDialog` (PATCH via `updateOperatorClass(id, patch)`)
  + View `onEdit`/`onDelete` row affordances (Edit wired; Delete disabled on archived).
- `d6cbace` **slice 6:** `DeleteClassDialog` (soft-archive; **server-409 authoritative**,
  not fleet-stats pre-block; synchronous in-flight ref guards double-click) + business
  nav "Classes" link (Navbar + MobileMenu `NavTo` union).

## Decisions baked in
- **Operator picker removed:** operatorId is optional on create and inferred
  server-side (resolveWriteOperatorId) for OPERATOR_* callers. #456 "operator-scope
  edit options" is satisfied structurally (no picker; operatorId non-patchable).
- **Stats degraded:** per-class car/active-booking counts come from the un-ported
  fleet-overview (#526). View shows the class's own seats/luggage instead. Archive
  guard is server-side, so nothing depends on the missing stats.
- **#504 luggage:** capacity ("{n} bags") is shown on each row; luggageSize (S/M/L)
  badge not added (renter cards already show it) — minor follow-up if wanted.

## Gotchas hit (reusable)
- React Query passes a **second mutation-context arg** to `mutationFn`. A mutationFn
  bound as `useMutation({ mutationFn: createOperatorClass })` gets called
  `(payload, ctx)` → `toHaveBeenCalledWith(objectContaining(payload))` FAILS. Assert
  `mock.calls[0][0]` instead. (EditClassDialog binds `(data)=>update(id,data)`, so
  there the spy sees exactly `(id, patch)` — clean.)
- `mutate()` invokes `mutationFn` on a microtask — assert call counts under `waitFor`,
  not synchronously (the double-click guard test).
- routeTree.gen.ts isn't auto-built outside dev/build: boot `bun run dev` briefly and
  poll the file (no `tsr` CLI bin installed).
- Pre-commit runs biome + full web/api tsc → `bunx biome check --write <files>` first.
- No force-push (HARD-DENIED).
