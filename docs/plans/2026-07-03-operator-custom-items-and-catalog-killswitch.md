# Operator-authored custom items + a platform kill-switch for the shared catalog

Status: DESIGN DRAFT - v2.3 (3 agent-review rounds folded in; for owner final review)
Date: 2026-07-03
Supersedes: the v1 "decouple" draft (deleted). Amends the direction of `docs/plans/2026-06-30-operator-catalog-i18n-design.md` (slice 5 only - see §9).

## 1. Owner intent

Owner requirements, verbatim:

1. Operators must NOT share catalog items across businesses.
2. Only platform admins may create shared items all operators can see and use.
3. Translation must work for independent operators *independently* - an operator can give their own add-on its own en/ja/zh without waiting on the shared catalog.
4. We must be able to turn the shared catalog OFF platform-wide, without affecting anything operators created on their own.

Requirements 1 and 2 are already true today (add-ons are operator-private rows; templates are platform-global with admin-only writes). This design delivers 3 and 4.

**Confirmed interpretation of "off" (owner, option B):** a literal platform-wide switch that DISABLES the shared catalog for everyone. "Off" means **hidden and frozen, not deleted** - the switch hides the admin library and the operator picker and blocks new picks, but template rows stay in the database, so items operators already picked keep rendering and the switch is reversible. Physically deleting templates is explicitly rejected: it would break every item that ever picked one.

## 2. Design principle

Additive, not a rewrite. The shared catalog stays the translation-quality layer while it is ON (an admin fix to a curated ja/zh name still reaches every operator who picked it). We ADD a second, self-contained authoring path, and gate the catalog behind a server-enforced flag.

- No "snapshot on pick" (that would freeze admin fixes - rejected in review).
- No reversal of the template-first resolver - it is EXTENDED by one branch.
- No destructive migration, no backfill, no dropping columns, no flipping `templateId` NOT NULL.

An add-on row is therefore one of two shapes:

- **Picked:** `templateId` set, `nameI18n` null. Renders from the shared template (live link, admin-curated).
- **Self-authored:** `templateId` null, `nameI18n` set. Renders from the operator's own bundle (self-contained).

## 3. Current state (grounded, from code review)

- Add-ons: mandatory picker (`validators/add-on.ts` - `templateId` required uuid, no `name` field); template-first resolver (`services/add-on-resolve.ts:15-22` branches on the JOINed `templateName`); LEFT JOIN read (`repositories/drizzle/add-on.ts:21-26`); dup-check keyed on `templateId` (`services/add-on.ts:110-114`).
- `add_on_options` retains `name text NOT NULL` (stamped `template.name.en` on create) and `description text`; `templateId` is nullable; partial uniques `add_on_options_active_name_unique` (operatorId,name WHERE ACTIVE) AND `add_on_options_active_template_unique` (operatorId,templateId WHERE ACTIVE) both exist.
- Insurance: `insurance_options` free-text `name` (single-language, no locale resolution), no operator picker, `templateId` column present but unused by the app (seed stamps it; repo never selects/writes it).
- Feature flags: `feature_flags` table (global `key`/`enabled`, no operatorId, admin-gated `PATCH /admin/feature-flags/:key`). Every existing flag is web-visibility-only, defaulted from a `VITE_FEATURE_*` env with a bidirectional parity test; there is a server read seam (`FeatureFlagsService.getOverrides()`) but no caller that gates API behavior on a flag.
- Slice 5 (NOT-NULL `templateId` + drop `name`/`description`) has NOT shipped.

## 4. Target design

### 4.1 Self-authored items (the escape hatch)

- Add `nameI18n jsonb $type<LocalizedText>()` (nullable) to `add_on_options`. `LocalizedText` requires `en`, so a self-authored item always has a floor.
- Self-authored description reuses the existing `descriptionOverride jsonb` bag, BUT resolution must not leave a reader-locale blank when text exists (see §4.3).
- `templateId` stays nullable; a self-authored item has `templateId = null`. Picking and self-authoring are mutually exclusive per row, enforced in TWO places: a validator (Zod schema) refine (exactly one of `templateId` / `nameI18n`) AND a DB `CHECK (NOT (templateId IS NOT NULL AND nameI18n IS NOT NULL))` on `add_on_options`. The CHECK forbids the ambiguous both-set row (which would hit the picked branch and silently discard the operator's `nameI18n`) while still permitting legacy both-null rows.
- The stored `name text` mirror is written = `nameI18n.en` for a self-authored row (keeps ordering, the name-unique seal, and booking snapshots working), and stays = `template.name.en` for a picked row.

### 4.2 Resolver: one added branch (not a reversal)

```
resolveAddOnName(row, locale) =
  row.templateName ? resolveLocalized(row.templateName, locale)   // picked (unchanged)
  : row.nameI18n   ? resolveLocalized(row.nameI18n, locale)       // self-authored (new)
  : row.name                                                       // legacy fallback
```

Picked items are unaffected; the new branch only fires for self-authored rows (`templateName` null because `templateId` is null).

### 4.3 Self-authored description resolution

`resolveDescription(override, template, locale)` today terminates at `override?.[locale] ?? template?.[locale] ?? template?.en ?? null`. For a self-authored row `template` is null, so a ja-only description renders blank to en/zh readers. Note the description bag is `LocalizedTextOverride`, where **`en` is optional** (`localized-text.ts:36-45`) - so `?? bundle.en` is NOT a guaranteed floor. Fix: encode a dedicated `resolveOwnDescription(bundle, locale)` that floors to ANY present locale, never terminating at a specific-locale miss while text exists:

```
resolveOwnDescription(bundle, locale) =            // bundle may be null (no description authored)
  bundle?.[locale] ?? bundle?.en ?? bundle?.ja ?? bundle?.zh ?? null
```

Used only on the self-authored branch; `resolveDescription` (the picked path, which always has a template `en` floor) is untouched. Description remains legitimately null when the operator authored none.

### 4.4 The kill-switch

- New global flag `SHARED_CATALOG`, default ON. The default lives in CODE (`SERVER_DEFAULT` / `serverDefault`, §6.2), NOT as a seeded row - the `feature_flags` table is override-only (a row IS an admin override), so no seed row exists or should be added.
- **Server-enforced** (this is new; existing flags are web-only): the operator template-picker endpoint (`GET /add-on-templates`) returns empty/410-style "catalog disabled" when off, and the operator create path rejects a `templateId` when off (must self-author). The admin template library routes are surfaced/hidden by the flag on the web, but their `requirePlatformAdmin` authz is unchanged - the flag controls surfacing, never authorization.
- Web hides the operator picker (create form shows only the self-author path) and the `_admin/admin/templates` surface when off.
- Existing picked items keep resolving because template rows persist; nothing an operator created is affected.

### 4.5 Uniqueness (no index changes)

- Picked rows keep being sealed by `add_on_options_active_template_unique` (Postgres treats NULL `templateId` as distinct, so many self-authored rows per operator do not collide there).
- Self-authored rows are sealed by the existing `add_on_options_active_name_unique` on the `name` mirror (= `nameI18n.en`). Both indexes coexist unchanged; no drop, no revert. Duplicate-name 409 for self-authored, duplicate-template 409 for picked - each with its own message.
- Cross-shape collision is intentional: because BOTH shapes write a non-null `name`, a self-authored "GPS" and a picked "GPS" collide on `active_name_unique`. This is desirable (an operator should not offer two identically-named add-ons regardless of shape); document it so it is not mistaken for a bug. Uniqueness is on `nameI18n.en` only - two items with distinct en but identical ja render duplicate labels to a ja renter; harmless, not worth per-locale uniqueness.

### 4.6 Translation-quality nudge

The self-author form encourages filling en+ja+zh and warns that tourists see English where ja/zh are blank (the platform serves international tourists; a blank ja/zh is a renter-facing downgrade). `en` required; ja/zh optional-but-nudged. Auto-translation (MT) is out of scope (already a deferred item).

## 5. Data model changes (all additive)

- `add_on_options`: add `nameI18n jsonb` (nullable). No drops, no NOT-NULL flips, no backfill: today's rows are template-picked (or legacy both-null, still covered by the `: row.name` branch in §4.2), so `nameI18n` stays null for them and the resolver falls through to the template/legacy column.
- (Insurance slice, §8): add `nameI18n jsonb` (nullable) to `insurance_options`; promote its wire contract from `name: string` to a resolved bundle (contract change - see §7).
- Migration discipline: `db:generate -> db:migrate -> db:verify` per additive column; `packages/shared/src/validators/` change is a danger-zone edit reviewed on its own.

## 6. Toggle server seam

This is the trickiest part, because the existing feature-flag system is **web-visibility-only** with two hard invariants that a naive `serverOnly` flag violates. The design must own that ripple.

### 6.1 Why a naive flag breaks (grounded)

- The web override map from `GET /feature-flags` is **sparse** - it carries only keys a platform admin explicitly set (`FeatureFlagsService.getOverrides()` -> `repo.getOverrides()`). `resolveFeatureFlag(overrides, key) = overrides[key] ?? isBuildTimeEnabled(key)` (`feature-flags-runtime.ts:46`). A flag defaulting ON has NO override row in the normal state, so `overrides[key]` is absent and web falls to the build-time reader. With no `VITE_FEATURE_*` env that reader yields `false` -> **the catalog hides itself in the default-ON state.** (Polarity trap: a sparse map only transmits the non-default value; a default-ON flag transmits nothing.)
- `BUILD_TIME_READERS: Record<FeatureFlagKey, () => boolean>` (`feature-flags-runtime.ts:20`) is EXHAUSTIVE, and `feature-flags-parity.test.ts:13` maps `FEATURE_FLAGS[k].env` for every key. A registry entry with no `.env` fails typecheck AND the parity assertion. So `serverOnly` is a shared-core (`packages/shared/src/feature-flags/registry.ts`) danger-zone edit, not a free attribute.

### 6.2 Design

- **Registry gains `serverOnly` + `serverDefault` (own the ripple, slice 2, danger zone).** Add `SHARED_CATALOG` to `FEATURE_FLAGS` as `{ serverOnly: true, serverDefault: true, label, runtimeControlled: true }` - NO `.env`. Required shared-core edits: make `env` optional and add `serverOnly?`/`serverDefault?` on the entry type (`registry.ts`); convert `BUILD_TIME_READERS` to `Partial<Record<...>>` + a missing-key guard in `isBuildTimeEnabled`; and update BOTH danger-zone tests - `feature-flags-parity.test.ts` (filter serverOnly keys from the env-parity map) AND `registry.test.ts` (its `entry.env` regex, distinct-env, and EXACT `runtimeControlled`-set assertions all break on a new envless key). Scope these in the slice-2 PR.
- **Keep the overrides map SPARSE; floor serverOnly keys to `serverDefault`, not to a build-time reader.** `resolveFeatureFlag(overrides, key)` for a serverOnly key returns `overrides[key] ?? entry.serverDefault` (true), NOT `isBuildTimeEnabled(key)` (which is `false` for an envless key). This kills the polarity trap at the root: every fail-safe path (`initialData: {}`, a non-ok fetch, a parse error - `feature-flags-runtime.ts:76,88`) floors to `serverDefault = true`, so the catalog shows (fail-OPEN to ON), matching the default. The map stays sparse (a key present IFF an admin set it), so the admin switchboard's `overridden = map[key] !== undefined` stays correct - no false "Overridden", no non-sparse channel overload.
- **Server owns enforcement.** Add `isEnabled('SHARED_CATALOG'): Promise<boolean>` to `FeatureFlagsService` = `override ?? FEATURE_FLAGS['SHARED_CATALOG'].serverDefault` over the wired `getOverrides()` (single-source the default from the registry so server enforcement and web flooring cannot drift). Inject a NARROW `isSharedCatalogEnabled: () => Promise<boolean>` (ISP) into `AddOnService` + the `add-on-templates` route (composition root `index.ts`). When off: the picker endpoint returns "catalog disabled" (empty) and add-on create rejects a `templateId` (must self-author).
- **Surfacing (flag), authz (guard) - never conflated.** The admin template library's `requirePlatformAdmin` authz is UNCHANGED; the flag only hides the web surface, never an authorization boundary (matching the documented "visibility-only, never authz" stance).

## 7. Blast radius

Changes:
- `services/add-on-resolve.ts`: +1 branch each in BOTH `resolveAddOnName` and `resolveAddOnDescription` (picked -> template, self -> own, legacy -> column); +`resolveOwnDescription` (§4.3).
- `validators/add-on.ts` (danger zone): `templateId` becomes optional; add optional `nameI18n`; a refine enforcing exactly one of `templateId` / `nameI18n`. **ZodEffects hazard:** a `.refine()` turns `createAddOnSchema` into a `ZodEffects`, which has no `.extend()` - so `platformAdminCreateAddOnSchema = createAddOnSchema.extend({operatorId})` stops compiling. Keep a raw `createAddOnObject` (ZodObject); derive `createAddOnSchema = object.refine(...)` and `platformAdminCreateAddOnSchema = object.extend({operatorId}).refine(...)` from the object (apply the refine to each leaf).
- `services/add-on.ts`: create branches on picked vs self-authored; writes `name` mirror from `nameI18n.en`; dup-check by name for self-authored. `AddOnCreate` type (`services/add-on.ts:26`) gains optional `nameI18n` AND `templateId` becomes optional (today required). The distinct 409 messages (§4.5) need a seam: a name pre-check via the existing `findActiveByOperatorAndName` for self-authored, plus constraint-name discrimination (`pgConstraintName`) in the unique-violation catch (`services/add-on.ts:48,132` today maps ANY unique violation to the duplicate-template message).
- `routes/add-ons.ts` (SILENT-GAP RISK): the POST handler (`add-ons.ts:88-97`) hardcodes the service input and must be updated to forward `nameI18n` and pass `templateId` as optional. Because `AddOnCreate.nameI18n` is OPTIONAL, tsc will NOT catch a dropped field - a self-authored create would silently persist `nameI18n = null` and brick the name-mirror write. Explicitly in slice-1 scope + covered by a route test.
- Self-authored EDITABILITY (intent #3 is create-AND-edit): the update path accepts `nameI18n` for self-authored rows (so an operator can add ja/zh later), re-sealing `active_name_unique` when `nameI18n.en` changes. `updateAddOnSchema` today carries only price + `descriptionOverride` (the picked model's fixed-identity rule). See D5 - confirm at review vs. blessing archive-and-recreate.
- Persistence plumbing (all additive, slice-1 PR must include): `stores.ts` `AddOn` (+`nameI18n`, propagates to `AddOnWithTemplate` via `extends`); `addOnOptionColumns` + `toAddOn` mapper (`drizzle/shared.ts`); `InMemoryAddOnRepository` `enrich`/`create` (`in-memory/add-on.ts`).
- Operator web `operator-add-ons/AddOnForm.tsx`: add a "custom item" path (multi-locale name + description) alongside the picker; hide the picker when the flag is off.
- New `SHARED_CATALOG` flag + server seam (§6); admin-template routes/web gated by surfacing.
- Insurance (its own slice, §8.3): `nameI18n` + multi-locale authoring + resolved wire contract.

Unchanged (deliberately):
- The LEFT JOIN and template-first resolution for picked items (quality preserved).
- The admin template library code and its `requirePlatformAdmin` authz.
- Booking snapshots (still freeze the resolved `name`; §11 non-goal). Note: `name` cannot be dropped while snapshots freeze it - another reason to keep it.
- `add_on_options_active_template_unique` and all existing migrations.

## 8. Execution slices (vertical, each shippable)

1. **Add-on self-authored path (escape hatch).** `nameI18n` column + the `CHECK` (§4.1); validator (optional `templateId` + `nameI18n`, exactly-one refine, ZodObject-derived per §7); create/resolve/dedupe branches + persistence plumbing (§7); operator form "custom item" path with the ja/zh nudge. Also in THIS slice: stop the ADD-ON audit flagging the now-legitimate null-`templateId` self-authored rows, WITHOUT breaking insurance. Do NOT drop the field from the SHARED `CatalogAuditReport` type (`backfill-catalog-templates.ts:242`) - it is reused by `auditInsuranceTemplates` (`backfill-insurance-templates.ts:3,94,121`), whose null gate is still genuine (insurance has no self-authored path; its NOT-NULL flip is not cancelled), and dropping the shared field breaks `scripts/audit-insurance-templates.ts` + `tests/integration/backfill-insurance-templates.test.ts` too. Instead SPLIT the type: give the add-on audit a narrowed `AddOnCatalogAuditReport = { duplicateActiveTemplateGroups }`, leaving `CatalogAuditReport` intact for insurance; update `scripts/audit-catalog-templates.ts` and delete the whole `nullTemplateIdRowIds` `it` block in `tests/integration/backfill-catalog-templates.test.ts:163-166`. Ship FIRST - creation must have a non-catalog path before the switch can hide the picker (else creation bricks when off).
2. **`SHARED_CATALOG` kill-switch.** Flag + server seam incl. the registry `serverOnly` shared-core edit (§6.2, danger zone); picker endpoint + create reject `templateId` when off; web hides picker + admin library. Depends on slice 1.
3. **Insurance independent translations** (defer per D1 - larger than it looks, and NOT needed for the switch since insurance has no catalog dependency today). Full blast radius: add `nameI18n` + a mandatory `name` mirror (= `nameI18n.en`, or `asc(name)` ordering + `insuranceSnapshot.name` at `booking-creation.ts:680` break); a NEW `resolveInsuranceName` + repo projection (insurance has no resolver/JOIN today, unlike add-ons); reshape/retire the `Jsonified<InsuranceOption>` wire fence (`wire-contract.test.ts:33` - add-ons already retired theirs, insurance is still fenced); promote the wire `name: string` -> `resolvedName`; a from-scratch multi-locale operator form (no picker to reuse). Its own multi-PR track.

## 9. What changes in the prior plan

- `2026-06-30-operator-catalog-i18n-design.md` slice 5: the `templateId NOT NULL` flip is **cancelled** (self-authored rows are legitimately null). Dropping the `name`/`description` columns is **deferred indefinitely** (`name` is the self-authored seal + snapshot source). Update that doc's slice-5 section and the schema/store "NOT NULL in PR2" comments to say "stays nullable."
- The ADD-ON `auditCatalogTemplates` "nullTemplateIdRowIds must be empty" gate existed to enable the NOT-NULL flip. After slice 1 it is worse than moot for add-ons - self-authored rows are legitimately null-`templateId`, so it would name them as offenders (a false alarm; not in CI, but misleading to the owner who runs it). Narrow the ADD-ON audit in slice 1 via the type split (§8.1); the INSURANCE audit keeps its null gate. The add-on `duplicateActiveTemplateGroups` half is also dead (the partial unique `add_on_options_active_template_unique` already makes a duplicate impossible), so the add-on audit effectively retires; fold into D2.
- #1319 slice 3b (merge synonyms) stays ALIVE - the catalog remains a first-class admin layer while ON, so template housekeeping still pays off. It is independent of this plan.

## 10. Open decisions / assumptions to confirm at final review

- A1 (assumption): "off" = hide/freeze, templates persist, reversible (owner confirmed option B with this reading). If the owner instead wants templates physically gone, that is a different, destructive design.
- D1: Insurance in scope now (slice 3) or deferred? It carries a wire-contract change and is not needed for the switch.
- D2: The `nullTemplateIdRowIds` audit half is deleted in slice 1 (§8.1, resolved). Still open: what to do with the now-unused map-or-mint backfills (`backfillCatalogTemplates`/`backfillInsuranceTemplates`) and `auditInsuranceTemplates` - leave as inert history, or delete? (Low stakes; recommend delete when insurance slice 3 lands or is cancelled.)
- D3: When the switch is OFF, should the admin library be read-only-visible (audit existing templates) or fully hidden? (Design assumes fully hidden.)
- D4: `name` mirror kept as an explicitly-written column vs a Postgres generated column. A generated `nameI18n->>'en'` would null out picked rows (their `nameI18n` is null), so it cannot be generated in this hybrid model - keep it explicitly written. (Recorded so review does not re-raise it.)
- D5 (needs one owner sentence): can an operator EDIT a self-authored item's `nameI18n` after create (e.g. add ja/zh later), or is name fixed at create (archive-and-recreate to change it)? Recommended: allow it (intent #3 reads as create-AND-edit) - update path accepts `nameI18n` for self-authored rows, re-sealing `active_name_unique` on an `en` change. Confirm. Either way, guard: reject `nameI18n` on a PICKED row at the validator/service (friendly 4xx) so it never reaches the DB `CHECK` and 500s as a 23514.

## 11. Non-goals

- No change to cross-operator isolation (already private).
- No renter-facing change for picked items when the catalog is ON (same resolved strings).
- No booking-snapshot redesign (snapshots stay single-language at booking time; a multi-locale receipt is a separate effort).
- No auto-translation / MT.
