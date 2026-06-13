# Handoff — #583 operator classes read-only-for-bypass (PR #587)

**Date:** 2026-06-13 · **Status:** built, gates green, pushed, PR open, CI in flight — awaiting review + merge.

## TL;DR
Follow-up to #581 (same fix on the operator **locations** page). The operator **classes** page (`/manage/classes`) let bypass-scope roles (PLATFORM_ADMIN / legacy STAFF·ADMIN — no `operatorId`, admitted by the `_business` guard) see an ungated **Add** button + row Edit/Delete, but the API rejects their writes (needs an `operatorId` the no-picker form never sends). Now the page is **read-only** for them; operators keep full CRUD. The cross-operator oversight read is unchanged.

## Where it lives
- Worktree: `~/Dev/kuruma-583-classes-readonly` · branch `fix/583-classes-readonly` (in sync with origin)
- Base: `origin/marketplace-pivot` (base ≠ default branch)
- Commit: `de9e12c` · **PR #587** → marketplace-pivot, body has `Closes #583`
- Issue **#583** is OPEN with `in-progress` label

## What changed (3 files, no backend, no migration)
- `packages/web/src/routes/$locale/_business/manage/classes.tsx` — **exported** `OperatorClassesRoute`; reads `sessionQueryOptions()`; `canWrite = isOperatorSession(session)` gates the Add button, the `onEdit`/`onDelete` callbacks, and the 3 dialogs.
- `packages/web/src/vite/operator-classes/OperatorClassesView.tsx` — props `onEdit?`/`onDelete?` made explicit `| undefined` (exactOptionalPropertyTypes); view already rendered row actions conditionally.
- `packages/web/tests/vite/operator-classes/OperatorClassesRoute.test.tsx` (new) — seeds `['session']` + classes query key into a QueryClient (no router needed); operator → Add+Edit+Delete present; bypass → none, rows still list.

`isOperatorSession(session) = !!session.user.operatorId` is the existing pure helper from #581 in `packages/web/src/vite/guards.ts`.

## Verification (all green locally)
- web tsc 0 · api tsc 0 · biome clean · i18n-parity 812×3
- classes suite 28 passed · **full web suite 956 passed**
- pre-commit gate passed (biome + size + boundaries + tsc web×2 + api)
- CI on PR #587: db-drift / e2e / e2e-real-db green; `test-and-build` was still pending at handoff — confirm it passes.

## Remaining steps (in order)
1. Watch CI on #587 to completion (`gh pr checks 587 --watch`).
2. Optional: `/code-review` — **user-triggered/billed**, not yours to launch autonomously (the #581 review came back clean; this is a near-identical mirror).
3. If mergeState is `BEHIND`: `gh pr update-branch 587` (re-runs CI), wait green.
4. Squash-merge: `gh pr merge 587 --squash`.
5. **Verify the fix actually landed on mp** (this exact step bit us on #529 — a PR got merged at a pre-fix tip): `git show origin/marketplace-pivot:packages/web/src/routes/$locale/_business/manage/classes.tsx | grep canWrite`.
6. Manual close #583 + drop `in-progress` label if the non-default base didn't auto-close.
7. Cleanup: `git worktree remove ~/Dev/kuruma-583-classes-readonly`; delete local branch `fix/583-classes-readonly` (remote lingers per ruleset). Touch **only** this worktree.

## Still open after this
- **#560 (fleet integration)** must gate the fleet CRUD on `isOperatorSession` when it mounts VehicleForm/FleetRowActions/BulkActionBar — fleet has the same latent gap but its affordances aren't mounted yet, so #583 deliberately left it. Coordination comment posted on #560.

## Gotchas
- Non-default base: `Closes #583` may not auto-close on merge — close manually.
- Route gen not needed (no route added/removed — only edited an existing route component + exported it).
- Memory updated: `project_528-operator-classes.md` (folded in), links `project_529-operator-locations.md`.
