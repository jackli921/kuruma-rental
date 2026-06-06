# Slice 8 — i18n sweep checklist (#390, plan §6)

Tracking artifact for the §6 i18n sweep. Source: `docs/plans/2026-06-02-slice8-demo-seed-e2e.md` §6 (proposal §8.2 hard requirement, #375 parity + #364 quality). Ships with the slice-8 PR. Re-run the machine half and re-audit the manual half **after each of slices 5/6/7 merges into `marketplace-pivot`** — conflict resolution silently drops i18n keys (CLAUDE.md i18n gotcha).

Locales: `packages/web/messages/{en,ja,zh}.json`. Lint: `bun run lint:i18n-parity`.

## (a) Machine — parity (CI-enforced via `lint:i18n-parity`)

- [x] `bun run lint:i18n-parity` green — **632 keys × 3 locales across 12 namespaces** (as of 2026-06-06). Baseline in plan was 603 × 3 / 11 ns (2026-06-04); the delta is the slice-5 `search` namespace landing.
- [x] Slice-5 `search` namespace present in en/ja/zh. (Storefront strings live under `search`/`catalog`, not a separate `storefront` namespace — verify they stay in parity.)
- [ ] Slice-6 `bookings.confirmation` subtree present in all three. (`bookings` namespace exists; confirmation keys pending slice 6.)
- [ ] Slice-7 notification/email strings present in all three. (No notification namespace yet.)
- [ ] `acriss` namespace (shipped slice 3) still in parity and covers every ACRISS code the slice-8 seed uses.
- [ ] Re-run `lint:i18n-parity` after each slice 5/6/7 merge; confirm still green.

Current top-level namespaces (12): `common, errors, auth, nav, acriss, catalog, vehicles, business, messaging, bookings, landing, search`.

## (b) Manual — quality (the #364 half the lint does NOT cover)

> Blocked: the renter booking/confirmation + operator-notification surfaces below do not exist until slices 6/7 land. Audit each as its slice merges.

- [ ] **Renter-facing en/ja/zh** (proposal §8.2 hard requirement) — every value actually translated, not EN copied into JA/ZH:
  - [ ] search form
  - [ ] storefront card
  - [ ] vehicle selection
  - [ ] booking form _(slice 6)_
  - [ ] confirmation page incl. selected insurance + "potential additional charges" block _(slice 6)_
  - [ ] confirmation email body _(slice 7)_
- [ ] **Operator portal en/ja minimum** (zh optional per §8.2): locations, vehicles, insurance, fees, bookings list + notification badge _(bookings/notification: slice 6/7)_.
- [ ] **ACRISS class labels** translated in all three (proposal §4 platform item 2) — verify `acriss` covers every code in the slice-8 seed.
- [ ] **Outbound email templates** (operator notification + renter confirmation) translated en/ja/zh _(slice 7)_.
- [ ] **Restart dev server after adding any new namespace** — `rm -rf packages/web/.next && bun run dev` (CLAUDE.md i18n gotcha).
- [ ] Operator-entered free-text is single-language per field by design (§9 item 4) — do **not** flag those as "missing translation".
