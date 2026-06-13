# #504 — Luggage on Vite operator forms + booking summary — Handoff

**Status:** CLAIMED (`in-progress`) 2026-06-12, **no code yet.** Fresh agent: make a worktree, implement via TDD, open a PR `Closes #504`.

## TL;DR — scope is SMALLER than the issue body
The #504 body says these surfaces "exist only in the frozen Next.js tree." **That is stale.** The frozen Next.js tree is gone, and #528 (classes) + #560 (fleet) already shipped the live Vite operator CRUD. So this is **net-new field wiring on existing Vite forms, not a port.** The shared validators, API, and i18n (all 3 locales) already support luggage — don't touch the contract.

## Verified remaining gaps (read each file before editing — concurrency is high)

| Surface | File | State | Work |
|---|---|---|---|
| Operator **VehicleForm** | `packages/web/src/vite/operator-fleet/VehicleForm.tsx` | **no luggage** | Add `luggageCapacity` (nullable int, blank ⇒ inherit class) + `luggageSize` **override** `<select>` (blank ⇒ inherit). Main work. |
| Operator **ClassForm** | `packages/web/src/vite/operator-classes/ClassForm.tsx` | has `luggageCapacity` (line ~124), **no `luggageSize`** | Add **required** `luggageSize` `<select>`, default `MEDIUM` |
| **EditClassDialog** | `packages/web/src/vite/operator-classes/EditClassDialog.tsx` | threads `luggageCapacity` into defaults only (line ~60) | Add `luggageSize` to the defaults it seeds |
| **ClassRow** stat | `packages/web/src/vite/operator-classes/OperatorClassesView.tsx:76` | capacity stat **DONE** | Optional: add a size badge (minor) |
| Booking-create **summary** | `packages/web/src/vite/reservation/` (likely `ConfirmStep.tsx`) | **no luggage; surface unconfirmed** | **Lowest priority** — locate the vehicle summary, add a luggage line, or defer to a follow-up issue. The renter already sees luggage on the class detail before booking, so value is low. |

## Contract already shipped — DO NOT change
- `validators/vehicle.ts`: `luggageCapacity: int.nullish()`, `luggageSize: enum(LUGGAGE_SIZES).nullish()` — vehicle is an **override**, `null` = inherit class.
- `validators/vehicle-class.ts`: `luggageCapacity: int` (required), `luggageSize: enum.default('MEDIUM')`.
- `@kuruma/shared/lib/luggage.ts`: `LUGGAGE_SIZES`, `LuggageSize`, `resolveLuggage(vehicle, class)` (override `??` class-default). Use it for any "effective luggage" display.
- i18n keys already in **en/ja/zh** (`...form.luggageCapacity` / `luggageSize` / `luggageInheritPlaceholder` / `luggageSizeInherit`, the `luggageSize` enum labels, and the plural `luggage` key). Add only what's genuinely new — and in all 3 locale files.

## Gotchas
- **ICU plural (from #457):** any luggage **count** string MUST be `{count, plural, one {# bag} other {# bags}}` — never `"{count} bags"` (broke as "1 bags" for a 1-bag Kei class). The existing keys are already plural; keep them.
- **Inherit semantics:** a blank vehicle override means *inherit* — send `null`/`undefined`, **not** `0`/`MEDIUM`. Mirror how VehicleForm handles its other nullable fields.
- **No frozen reference to copy:** build the `luggageSize` `<select>` fresh by mirroring an existing enum `<select>` already in these forms (e.g. transmission/fuel/insurance selects).
- **RQ v5:** mutationFn receives a 2nd context arg — assert `mock.calls[0][0]` in tests.
- No new route ⇒ Navbar/`data-nav-count` tests are untouched.

## Conflict awareness
These files are stable (operator-fleet merged via #560, operator-classes since #528). In-flight PRs — #586 (#524 dashboard), #590 (#525 bookings), #585 (add-ons), #591 (#574 geocode) — don't touch them. **Base off the latest `marketplace-pivot`; low conflict risk.**

## Workflow
- Base branch = **`marketplace-pivot`** (NOT `main`). Worktree `../kuruma-504-luggage-vite`, branch `feat/504-luggage-vite`. `bun install` + `tsc --noEmit` in the fresh worktree first.
- **TDD per surface:** field renders → submit payload includes luggage → blank override sends `null` (inherit). Use the existing operator-form test files as harness templates.
- Gates before PR: `bun run --filter @kuruma/web test`, `tsc`, `biome`, i18n parity (en/ja/zh key counts match).
- PR `Closes #504`. Base ≠ default branch ⇒ after merge: **manually** close #504, drop the `in-progress` label, and `git worktree remove`.
