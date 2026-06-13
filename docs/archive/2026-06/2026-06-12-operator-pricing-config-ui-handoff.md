# Handoff: Complete the operator pricing & booking-options config UI

**Date:** 2026-06-12
**Trunk:** `marketplace-pivot` @ `029155b` (after #530 merge)
**Prompted by:** Operator dashboard showed no way to set the prices/options a renter pays at booking. This handoff maps the full surface, the one verification fix, and the two remaining work items.

---

## The question this answers

> "Where does the operator set the options and prices renters see when booking?"

A renter pays for up to four things; each is configured in a different operator surface:

| Renter-facing booking input | Schema | Operator config UI | Status |
|---|---|---|---|
| **Base car rate** (daily/hourly) | `vehicles.dailyRateJpy` / `hourlyRateJpy` | Fleet -> vehicle add/edit (`VehicleForm`) | ⏳ form built (#555/#570), **not yet mounted** -> **#560** (claimed, built, unpushed) |
| **Insurance options** (add-on cover) | `insurance_options.dailyPriceJpy` / `deductibleJpy` | `/manage/insurance` | ✅ #530 (merged `029155b`) |
| **Fees** (cleaning / overtime / no-fuel, by type & unit) | `fee_schedules.amountJpy` | `/manage/fees` | ✅ #530 (merged `029155b`) |
| **Paid add-ons** (child seat, ETC, snow tires) | `add_ons.priceJpy` | `/manage/add-ons` | ❌ **missing UI -> #585 (new)** |
| Vehicle classes (browse grouping) | `vehicle_classes` | `/manage/classes` | ✅ #528 |
| Locations / storefronts | `locations` | `/manage/locations` | ✅ #529 |

Notes:
- **Insurance & add-ons are operator-wide** (`operatorId` FK only — no per-vehicle/class assignment). The renter wizard picks one insurance option + N add-ons; no assignment UI is needed.
- **Fees** are operator- or class-scoped (optional `vehicleClassId` UUID; the dropdown must use the operator-scoped `/vehicle-classes/manage`, not the public catalog).
- **Per-vehicle price override was NOT deferred to a separate feature** — base rates live on the vehicle and are edited in `VehicleForm`. ("Defer to #555" in the #530 notes meant the rate control belongs in #555's `VehicleForm`, which is now closed/merged. It becomes reachable once #560 mounts it.)

---

## Step 0 — verification fix (why Insurance/Fees don't show locally)

The local checkout running the dev server (`~/Dev/kuruma-marketplace-pivot`) was at `eca12d6`, **2 commits behind** trunk — it has `locations.tsx` but not `insurance.tsx`/`fees.tsx`, so the nav showed Classes + Locations but no Insurance/Fees.

```bash
cd ~/Dev/kuruma-marketplace-pivot && git pull --ff-only origin marketplace-pivot   # -> 029155b
# restart the Vite dev server (it regenerates routeTree.gen.ts on boot)
```

After restart the business nav has 7 links: Dashboard · Bookings · Fleet · Classes · Locations · Insurance · Fees.

---

## Work item 1 — land #560 (unblocks base-rate editing)

**#560** "mount fleet CRUD slices into `OperatorFleetView`" is **already claimed and built but unpushed** on `feat/560-fleet-integration` (worktree `~/Dev/kuruma-560-fleet-integration`, another session). It mounts `VehicleForm` (which carries `dailyRateJpy` / `hourlyRateJpy`) + `EditVehicleSheet` into the Fleet page. **Until it lands, there is no UI to set a car's base rental rate** — prices come only from seed data.

- Do **not** recreate or touch that worktree (foreign session — see `feedback_never-reclaim-foreign-worktree`).
- Remaining per that session's handoff: push -> PR `Closes #560` -> browser smoke -> squash -> manual close + drop label -> worktree rm.
- This handoff just records that #560 is the gate for base-rate config.

---

## Work item 2 — build #585 (add-ons management UI) — NEW, unclaimed

**Issue:** #585 `feat(operator): add-ons management UI (Vite)`. Labels: enhancement, slice, P1. **Not claimed.**

**Why it's a real gap:** the renter wizard already has a paid add-ons step (`AddOnsStep`, `ReservationWizard.selectedAddOnIds`, #460) and the API is fully built — `packages/api/src/routes/add-ons.ts` exposes operator-private CRUD. But operators have **no UI**, so the add-on step only ever shows seeded rows. This is web-only work.

### API contract (already shipped — just consume it)
- `GET /add-ons?includeArchived=true` — auto operator-scoped (cookie), lists archived too.
- `GET /add-ons/:id`
- `POST /add-ons` — `createAddOnSchema` = `{ name, description, priceJpy }`; server stamps `operatorId`.
- `PATCH /add-ons/:id` — `updateAddOnSchema` = `createAddOnSchema.partial()`.
- `DELETE /add-ons/:id` — soft-archive.
- Auth: `requireAuth()` on `/add-ons` + `/add-ons/*`. Bypass roles (STAFF/ADMIN/PLATFORM_ADMIN) need `operatorId` or `includeAll=true` on reads.

### Implementation — port the #530 insurance slice 1:1
The cleanest reference is `packages/web/src/vite/operator-insurance/` (merged in #530). New dir `packages/web/src/vite/operator-add-ons/`:

- `api.ts` — `fetchAddOns()`, `createAddOn`/`updateAddOn`/`archiveAddOn` (CSRF via `X-CSRF-Token`), `ADDON_QUERY_KEY`; write types from `@kuruma/shared/validators/add-on`.
- `OperatorAddOnsView.tsx`, `AddOnForm.tsx`, `AddOnRow.tsx`, `AddOnStatusBadge.tsx`, `AddAddOnDialog.tsx`, `EditAddOnDialog.tsx`, `ArchiveAddOnDialog.tsx`.
- Form fields: `name`, `description`, `priceJpy` (flat). No class/vehicle scope.
- Route `/$locale/_business/manage/add-ons` behind `_business`.
- Nav link `Add-ons` in `Navbar.tsx` + `MobileMenu.tsx` (`NavTo` union) + bump `data-nav-count` 7 -> 8.
- i18n `business.addOns.*` + `nav.addOns` in en/ja/zh.

### TDD slices (mirror #530)
1. `api.ts` data layer + CSRF writes (+ `api.test.ts`).
2. View + form + Add/Edit/Archive dialogs (+ view/form tests).
3. Route under `_business` (+ route test).
4. Nav link (+ Navbar.test nav-count -> 8).

### Acceptance
- Operator lists (incl. archived), adds, edits, archives add-ons at `/manage/add-ons`.
- Writes thread CSRF; reads auto-scope (no operatorId sent).
- Renter `AddOnsStep` shows operator-created add-ons.
- tsc / lint / web suite green; nav test asserts link + count.

---

## Gotchas (carry forward from #528/#529/#530)

- **CSRF on every cookie write** — thread `session.csrfToken` via `X-CSRF-Token` (DocumentUploadCard pattern). Do NOT copy `operator-fleet/writeJson` — it omits the header (latent 403).
- **Nav-link conflict tax** (`feedback_nav-link-conflict-tax`): each new `/manage` route 3-way-conflicts `Navbar.tsx` + `MobileMenu.tsx` + `Navbar.test.tsx` (data-nav-count). When you add the Add-ons link, **extract a shared `manageNavItems` array** to retire this for good (would also de-risk the next route).
- **`routeTree.gen.ts`** — regenerate by booting the Vite dev server (`bun run --filter @kuruma/web dev`, ~12s, then `lsof -ti:3001 | xargs kill`). Never hand-merge it.
- **Merge discipline** — base is `marketplace-pivot` (not `main`); `Closes #N` won't auto-close, do it manually. Repo has **auto-merge disabled** + require-up-to-date, so on a busy trunk: poll CI green while current, then `gh pr merge --squash`. Never rebase a pushed branch — merge trunk in.
- **Local dev DB** (`feedback_local-dev-db-devvars`): a `column X does not exist` 500 means the dev DB is behind on migrations — `bun --env-file=packages/api/.dev.vars run db:migrate`.

---

## Out of scope for this handoff (adjacent operator-portal issues, separately tracked)

These are other operator surfaces, **not** booking pricing/options config:
- **#524** operator dashboard (overview stats) — in progress
- **#525** operator bookings (calendar + detail) — in progress
- **#527** operator vehicle detail (calendar-lite + utilization)
- **#583** read-only-for-bypass gating for fleet & classes
- **#561** fleet grouped/grid toggle (deferred)
- **#504** luggage display port to operator forms

---

## Summary for the next session

1. `git pull` the mp worktree + restart dev server -> Insurance/Fees appear (step 0).
2. Land **#560** (claimed elsewhere) -> base-rate editing in Fleet.
3. Build **#585** (unclaimed, full plan above) -> add-ons management. After this, the operator can configure **every** price/option a renter sees at booking.
