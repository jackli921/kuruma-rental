# Slice 8 — i18n sweep checklist (#390, plan §6)

Tracking artifact for the §6 i18n sweep. Source: `docs/plans/2026-06-02-slice8-demo-seed-e2e.md` §6 (proposal §8.2 hard requirement, #375 parity + #364 quality). Ships with the slice-8 PR. Re-run the machine half and re-audit the manual half **after each of slices 5/6/7 merges into `marketplace-pivot`** — conflict resolution silently drops i18n keys (CLAUDE.md i18n gotcha).

Locales: `packages/web/messages/{en,ja,zh}.json`. Lint: `bun run lint:i18n-parity`.

## (a) Machine — parity (CI-enforced via `lint:i18n-parity`)

- [x] `bun run lint:i18n-parity` green — **651 keys × 3 locales** (as of 2026-06-07). Trajectory: 603 (2026-06-04, pre-slice-5) → 632 (slice-5 `search` namespace) → 651 (slice-6/7 booking/confirmation/notification keys merged).
- [x] Slice-5 `search` namespace present in en/ja/zh. (Storefront strings live under `search`/`catalog`, not a separate `storefront` namespace — verify they stay in parity.)
- [ ] Slice-6 `bookings.confirmation` subtree present in all three. (`bookings` namespace exists; confirmation keys pending slice 6.)
- [ ] Slice-7 notification/email strings present in all three. (No notification namespace yet.)
- [ ] `acriss` namespace (shipped slice 3) still in parity and covers every ACRISS code the slice-8 seed uses.
- [ ] Re-run `lint:i18n-parity` after each slice 5/6/7 merge; confirm still green.

Current top-level namespaces (12): `common, errors, auth, nav, acriss, catalog, vehicles, business, messaging, bookings, landing, search`.

## (b) Manual — quality (the #364 half the lint does NOT cover)

> Slices 6/7 now merged into `marketplace-pivot`, so the previously-blocked surfaces exist. **Mechanical sweep performed 2026-06-07** across all 651 keys × 3 locales (untranslated-value detection + ICU placeholder parity). Scope limit: this catches EN-copied-into-JA/ZH and ICU-arg drift; it is **not** native-fluency proofreading (a JA/ZH speaker should still spot-check tone before the customer demo, #488).

- [x] **Renter-facing en/ja/zh** (proposal §8.2) — no EN values left in JA/ZH across search / storefront / vehicle / booking / confirmation namespaces. (Booking + confirmation namespaces present post-slice-6.)
- [x] **Operator portal en/ja/zh** — locations, vehicles, insurance, fees, bookings, notification: all translated; no untranslated values.
- [x] **ACRISS class labels** — `acriss.*` present in all three; `SUVR = "SUV"` intentionally identical (it is the standard code label, not prose).
- [x] **ICU plural parity** — JA/ZH correctly collapse `{count, plural, one/other}` to CJK form (`{count} 台`, `{count, plural, other {#時間}}`); the `count` arg is preserved in all three. (A naive `{…}`-token diff falsely flags these — verified not real.)
- [x] **Outbound email templates** (operator notification + renter confirmation) — present and translated en/ja/zh post-slice-7.
- [x] **Intentionally-identical values are not defects:** brand names (`auth.google`/`auth.apple` = "Google"/"Apple"), pure interpolation (`{open}–{close}`, `¥{price}`), and input placeholders (`72`, `24`, sample URL) are correctly identical across locales.
- [ ] **Restart dev server after adding any new namespace** — `rm -rf packages/web/.next && bun run dev` (CLAUDE.md i18n gotcha).
- [ ] Operator-entered free-text is single-language per field by design (§9 item 4) — do **not** flag those as "missing translation".

**Sweep result: no translation defects.** Machine parity green (651 keys × 3). `auth.apple` may be dead post-Apple-drop — cosmetic, out of slice-8 scope.
