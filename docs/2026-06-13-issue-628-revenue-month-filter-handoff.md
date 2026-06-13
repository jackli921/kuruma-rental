# Handoff — #628 admin revenue `?month=YYYY-MM` filter

**State:** worktree `~/Dev/kuruma-628-revenue-month` · branch `feat/628-revenue-month` off
`marketplace-pivot@18bb94e` · commit **`c89d65e`** (1 commit). NOT pushed, no PR. #628 has the
`in-progress` label. Web + API + shared (no migration). Follow-up to merged #625 (#462 revenue tab).

## Done (committed, c89d65e)
Vertical slice, all 3 layers, TDD:
- **shared** `lib/admin-revenue.ts`: pure `filterEventsByMonth(events, month)` + `availableRevenueMonths(events)` (reuse existing `jstYearMonth`). `types/admin-revenue.ts`: new `AdminRevenueResponse = AdminRevenueReport & { availableMonths: string[]; selectedMonth: string|null }`. **Left `AdminRevenueReport` (the aggregate's return) untouched** — the frozen Next page imports it.
- **api** `services/admin-revenue.ts`: `getReport(ctx, month?)` filters events *before* aggregation (so partner subtotals + totals reflect only that month) and wraps in `AdminRevenueResponse`; `availableMonths` is always the full set. `routes/admin-revenue.ts`: parse `?month`, `MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/`, malformed → 400.
- **web** `revenue/api.ts`: `fetchAdminRevenue(month?)` (omits param when absent) + month-keyed `queryOptions`. `routes/.../revenue.tsx`: `validateSearch` + `loaderDeps` thread `?month`; `onSelectMonth` → `navigate`. `RevenueView.tsx`: stays pure (`report` + `onSelectMonth`), renders a `NativeSelect` picker (All months + each payout month) when `availableMonths.length>0`.
- **i18n** `admin.revenue.allMonths` + `monthFilterLabel` in en/ja/zh.

## Gates run (green)
typecheck 0 · shared 13 · api 20 · web views 8 + revenue-api 3 · pre-commit (biome+lint:size+lint:modules+tsc ×3 packages) all pass.

## Remaining (finish line)
1. Full suites: `bun run --filter @kuruma/api test` + `bun run --filter @kuruma/web test` + `bun run lint`.
2. `/code-review` (+ optional architect agent).
3. push `-u` → `gh pr create --base marketplace-pivot` body `Closes #628`.
4. `git fetch` + `gh pr update-branch` if BEHIND — **no rebase / no force-push** (swarm drains mp fast; re-check `git log HEAD..origin/marketplace-pivot` for any `(#628)` collision first — see #610 lesson).
5. CI 4/4 → `gh pr merge --squash` → manual close #628 + drop `in-progress` (base ≠ default) → teardown worktree+branch.

## Notes / gotchas
- **Do NOT touch** `packages/web/tests/app/admin-revenue.test.tsx` (frozen Next.js test) — it still uses unchanged `AdminRevenueReport`.
- Picker `<option>` text collides with table month rowheaders → assert with `getAllByRole('rowheader', {name})`, not `getAllByText`.
- Swarm hotspots to avoid: #616 + substitution area (3 worktrees); #632/#613 disclaimer actively edited in `~/Dev/kuruma-disclaimer-consent`.
- Manual browser smoke NOT done.
