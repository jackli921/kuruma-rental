# Handoff — #610 operator vehicle substitution UI · IMPLEMENTED, pre-PR

> Continues `docs/2026-06-13-operator-substitution-ui-handoff.md`. **Code is done + all
> local gates green.** What's left is review → push → PR → merge.

## State
- Worktree `~/Dev/kuruma-610-substitution-ui` · branch `feat/610-substitution-ui` off
  `marketplace-pivot@946a5e7` · commit **`5ad0462`** · **NOT pushed, no PR**.
- #610 has the `in-progress` label. Web-only; no API/schema/migration.
- Gates: web **1050 pass** (+18 new), `typecheck` 0, biome clean, i18n parity **858×3**.

## What was built (TDD, RED→GREEN each slice)
1. `vite/operator-bookings/api.ts` → `substituteBooking(bookingId, newVehicleId, reason, csrf)`
   POSTs `/bookings/:id/substitute`, CSRF header, drops empty reason. (api.test.ts +4)
2. `lib/substitution.ts` → pure `selectSubstitutionCandidates(fleet, booking)` mirroring the
   server rules (same class + pickup location, AVAILABLE, excl. assigned car). (substitution.test.ts +6)
3. `vite/operator-bookings/SubstituteVehicleAction.tsx` → candidate radio picker + reason
   dialog. Gated: `isOperatorSession` → write; bypass role → read-only note; terminal status
   → unavailable note. Invalidates detail + events on success. (SubstituteVehicleAction.test.tsx +8)
4. Wired into `$locale/_business/manage/bookings/$bookingId.tsx`: loader prefetches fleet +
   session; Actions placeholder replaced. `substitute.*` i18n in en/ja/zh.

## Remaining (the finish line)
1. `/code-review` + `architect` (user-launched billed review is theirs; the agent reviews are yours).
2. `git push -u origin feat/610-substitution-ui` → `gh pr create --base marketplace-pivot`
   body `Closes #610`.
3. `git fetch` + `gh pr update-branch` if BEHIND (swarm drains mp fast). **No rebase / no force-push.**
4. CI 4/4 (test-and-build, db-drift, e2e, e2e-real-db) → `gh pr merge --squash`.
5. Manual close #610 + drop `in-progress` (base ≠ default → no auto-close) → teardown worktree+branch.

## Notes / gotchas
- The route component itself is NOT unit-tested (router-coupled `useLoaderData`/`useParams`,
  same as #549). All gating (operator sees / admin doesn't / terminal disables) is covered by
  the prop-driven `SubstituteVehicleAction.test.tsx`. Mention in PR.
- **Manual browser smoke NOT done** — verify the dialog opens + a real substitute round-trips.
- Sibling worktree `~/Dev/kuruma-525-operator-bookings` also edits `operator-bookings/api.ts`
  (append-only; my addition is at the file end) — fetch + update-branch before merge; don't touch it.
- CSRF is global (`app.use('*', csrf())`); the write echoes `session.csrfToken`.
