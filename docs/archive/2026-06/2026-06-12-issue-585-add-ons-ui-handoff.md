# Handoff — #585 Operator Add-Ons UI (Vite)

**State:** Plan written + architect-reviewed + committed. **No implementation code yet.**
**Next action:** implement via TDD (plan is approved, just build it).

## Where things are
- **Worktree:** `~/Dev/kuruma-585-operator-add-ons`, branch `feat/585-operator-add-ons`
  (off `marketplace-pivot` @ `c34df23`, tracks origin/marketplace-pivot).
- **Plan (READ FIRST):** `docs/plans/2026-06-12-issue-585-operator-add-ons-ui.md` —
  committed `16daaa4`. It is the full spec; this handoff is the summary.
- **Issue #585** claimed (`in-progress` label) + start comment posted. No PR yet.
- Base branch is **`marketplace-pivot`**, NOT `main`. Never rebase — merge base in if behind
  (project convention; renumber-not-rebase for migrations, but there are none here).

## What this is
Web-only UI slice: operators have no UI to manage paid add-ons (child seat, ETC card…),
though the API (`packages/api/src/routes/add-ons.ts`) is fully built. **1:1 port of the
merged #530 insurance slice**, simplified for the add-on shape. No schema/migration/API change.

## The port (template → target)
Copy `packages/web/src/vite/operator-insurance/` → `packages/web/src/vite/operator-add-ons/`
(8 files) and the route `routes/$locale/_business/manage/insurance.tsx` → `.../add-ons.tsx`.
Rename Insurance→AddOn throughout. Tests: copy the 4 in
`packages/web/tests/vite/operator-insurance/` → `tests/vite/operator-add-ons/`.

**Key shape difference:** add-on has ONE flat `priceJpy` (per-booking) — NO `dailyPriceJpy`,
NO `deductibleJpy`. So `AddOnForm` drops the entire deductible toggle/NaN-guard block;
it is just name / description / priceJpy.

## TDD order (RED→GREEN each; `/verify` before commit)
1. `api.test.ts` — assert full URL `'/api/add-ons?includeArchived=true&includeAll=true'`
   AND that it sends NO `operatorId=` (the #529 bypass-role lesson, test-enforced);
   writes send `X-CSRF-Token`.
2. `AddOnForm.test.tsx` — name/description/price; reject empty name + negative price;
   submit gives `priceJpy` as a **number** `1500` (not `'1500'`) — proves `valueAsNumber`.
3. `OperatorAddOnsView.test.tsx` — empty state; sorted rows; archived badged; Add opens dialog.
4. `add-ons.route.test.ts` — route renders view from prefetched data.
5. `tests/vite/nav/Navbar.test.tsx` (EDIT) — bump `data-nav-count` `'7'`→`'8'` + add a
   `data-to` assertion for `/$locale/manage/add-ons` (mirror the fees one at line 118).

## Load-bearing gotchas (from architect review)
- **CSRF:** copy insurance `api.ts` `writeJson` (threads `X-CSRF-Token`). Do NOT copy
  `operator-fleet/writeJson` — it omits the header → latent 403 on every write.
- **Bypass-role read 400:** `fetchAddOns()` MUST send `includeAll=true`. Operators ignore it;
  STAFF/ADMIN/PLATFORM_ADMIN 400 without it. (`add-ons.ts:51-56`.)
- **Form coercion:** `register('priceJpy', { valueAsNumber: true })` + `defaultValues.priceJpy: 0`
  + the `useForm<z.input, unknown, z.output>` 3-generic shape (mirror InsuranceForm). Empty
  number input is `NaN`; the `0` default + valueAsNumber avoid a rejected submit.
- **AddOnArchiveDialog:** keep the `inFlightRef` synchronous double-click guard.
- **routeTree.gen.ts:** regenerate by booting the Vite dev server — never hand-edit/merge.
- **i18n:** add `nav.addOns` + a `business.addOns.*` block (mirror `business.insurance` minus
  deductible keys) in en/ja/zh. Existing `addOns` keys are all under `reservation.*`/
  `booking.detail` — `business.addOns` is collision-free. Parity test needs all 3 locales.
- **Biome** reorders imports / drops unused — re-read files after format before next Edit.
- **`data-nav-count`** is emitted by a test MOCK of MobileMenu (`Navbar.test.tsx:43`), not the
  real source — so the real Navbar/MobileMenu only get the new nav item; only the TEST count moves.

## Nav edits (3 files)
- `vite/nav/MobileMenu.tsx` — add `'/$locale/manage/add-ons'` to the `NavTo` union.
- `vite/nav/Navbar.tsx` — add `{ to: '/$locale/manage/add-ons', label: t('addOns') }` to the
  `viewMode === 'business'` array, after fees.
- `tests/vite/nav/Navbar.test.tsx` — count + data-to (see TDD step 5).
- (Deferred: the optional `manageNavItems` shared-array refactor — out of scope, file as follow-up.)

## API contract (already built — do not change)
`GET /add-ons?includeArchived=true&includeAll=true` → `AddOn[]` (name-asc; mgmt-role only,
RENTER/PARTNER→403). `POST /add-ons`→201. `PATCH /add-ons/:id`→200. `DELETE /add-ons/:id`→200
(soft-archive). `AddOn` = `{id, operatorId, name, description|null, priceJpy, status, createdAt,
updatedAt}` (dates ISO strings over the wire). Validators: `@kuruma/shared/validators/add-on`
(`createAddOnSchema`, `updateAddOnSchema`, `CreateAddOnInput`, `UpdateAddOnInput`).

## Gates before PR
`bun run --filter @kuruma/web test`, `tsc --noEmit`, i18n parity (813×3), `bun run lint`.
Then `/code-review` + `architect-review`. PR `Closes #585` → `marketplace-pivot`. Close #585.

## Acceptance
Operator lists (incl archived)/adds/edits/archives add-ons at `/manage/add-ons`; writes thread
CSRF; reads auto-scope; renter wizard `AddOnsStep` shows operator-created add-ons (existing wiring,
manual check); nav link in desktop + mobile; all gates green.
