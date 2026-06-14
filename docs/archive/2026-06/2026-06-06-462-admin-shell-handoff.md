# #462 Admin Portal Shell — Resume Handoff (2026-06-06)

**Worktree:** `/Users/jack/Dev/kuruma-admin-portal` · **Branch:** `feat/462-admin-portal-shell` (off `marketplace-pivot`)
**Plan (source of truth):** `docs/plans/2026-06-06-admin-portal-shell.md` — follow it slice by slice.
**Issue:** #462 (labeled `in-progress`). Decisions approved §6.1: prefix `/admin`, admit legacy `STAFF`/`ADMIN` via `PLATFORM_ADMIN_ROLES`, pure `decideAdminAccess()`, no `src/modules/admin/` yet.

## Done & committed (green)
- `66e1188` plan doc.
- `43fe8e7` **Slice 1** — `lib/platform-roles.ts` (`isPlatformAdmin`, narrower than BUSINESS_ROLES — no OPERATOR_*) + `classifyRoute('/admin') -> {type:'admin'}`. Tests: `tests/lib/platform-roles.test.ts`, extended `tests/lib/route-helpers.test.ts`.
- `d3f4f09` **Slice 2** — pure `decideAdminAccess(role) -> login|forbidden|allow` in `lib/route-helpers.ts`, wired into `middleware.ts` admin branch.
- 28 web lib tests pass; `bun run --filter @kuruma/web typecheck` clean.

## Remaining (TDD, plan §5)
- **Slice 3 — layout + sidebar (UI).** Create `components/nav/AdminSidebar.tsx` (copy `BusinessSidebar.tsx` verbatim incl. the `mounted`/`aria-current` #25 hydration pattern; `useTranslations('admin')`, items `nav.overview`→`/admin`, `nav.revenue`→`/admin/revenue`, icons `LayoutDashboard`/`Banknote`). Create `app/[locale]/(admin)/layout.tsx` (mirror `(business)/layout.tsx`: `await Promise.all([auth(), params])`, guard `!session?.user`→login, `!isPlatformAdmin(role)`→`/{locale}`). RED = component test (testing-library + NextIntlClientProvider) asserting the revenue link href.
- **Slice 4 — pages + i18n.** Create `app/[locale]/(admin)/admin/page.tsx` (overview) + `admin/revenue/page.tsx` (placeholder: title/subtitle + money-flow spec "platform keeps 4%, remittance = paid − 4%, per business, monthly" + "coming soon, gated on #461"). Add `admin` namespace to ALL THREE `messages/{en,ja,zh}.json` (shape in plan §3.5: `admin.nav.*` strings, `admin.home.*`/`admin.revenue.*` objects — do NOT collide `admin.revenue` object with a `nav` label). RED = page render test for "coming soon" + "4%".
- **Slice 5 — E2E** `e2e/admin-portal.spec.ts`: unauth `/en/admin`→login; (real-db lane) RENTER→`/en`; PLATFORM_ADMIN sees nav + revenue placeholder.

## Resume commands
```bash
cd /Users/jack/Dev/kuruma-admin-portal
git fetch origin && git rebase origin/marketplace-pivot   # stay current; no schema here so no migration-lock concern
bun install                                                # if fresh
# then TDD slice 3...
bun run --filter @kuruma/web test                          # web unit/component
```
## Gotchas
- **i18n parity is a CI gate** (`lint:i18n-parity`): every `en.json` key must exist in ja+zh. New `admin` namespace needs a dev restart: `rm -rf packages/web/.next && bun run dev` or it renders `MISSING_MESSAGE`.
- Full local gate before PR: `bun run lint` (whole repo), `lint:size`, `lint:modules`, `lint:i18n-parity`, `bun run --filter @kuruma/web test`.
- Next 16 + base-ui: no `asChild` (use `buttonVariants()`/`render`); `middleware.ts` not `proxy.ts`.
- #462 has **no schema/API change** — independent of slice 6's migration lock.
- PR targets `marketplace-pivot` (non-default → `Closes #462` won't auto-fire; close manually). Rebase before push; never force-push.

## Definition of done (plan §7)
All 5 slices green; full CI gate local; `/admin` reachable only by platform admins; working nav + revenue placeholder; no schema/API; aggregation follow-up captured (gated on #461).
