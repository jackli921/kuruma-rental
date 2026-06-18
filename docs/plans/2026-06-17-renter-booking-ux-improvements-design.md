# Renter Booking-Flow UX Improvements — Design

- **Date:** 2026-06-17
- **Author:** Jack (with Claude)
- **Status:** Approved design — pending implementation
- **Trunk:** branch off `develop`; one PR per slice
- **Scope:** Renter-facing search → booking → confirmation flow. Four small, independent vertical slices filed as four linked GitHub issues.

## Context

User-reported UX gaps in the renter journey (search a car → book → confirm):

1. No clear **back** affordance at the start of the booking wizard — clicking "Book" on a car lands you on wizard step 1 with a dead-end empty back slot.
2. The cost breakdown collapses **add-on fees into a single subtotal** — the user wants a per-item line for each add-on.
3. The post-payment **confirmation receipt is bare** — the rental company name + store location aren't surfaced, and there's no link to the company's storefront.
4. Many **buttons don't show a pointer cursor** on hover/click (Tailwind v4 Preflight dropped the default `cursor: pointer`).

### What already exists (verified by exploration, 2026-06-17)

- **Booking wizard** — `packages/web/src/vite/reservation/ReservationWizard.tsx`. Steps `['dates','addOns','insurance','confirm','payment']`, tracked by local `useState`. Back buttons render on steps 2–5 (`stepIndex > 0`); **step 1 renders an empty `<span/>`** in the back slot (`ReservationWizard.tsx:134`).
- **Storefront detail page already exists** — route `/$locale/storefronts/$locationId` (`StorefrontDetailView.tsx`), public, shows operator name, store name, address, hours, and available cars. It has a styled "← back to search" link we can mirror.
- **Pre-payment review** — `ConfirmStep.tsx` already receives `selectedAddOns` (each with `name` + `priceJpy`) but renders only the names plus the aggregate `estimate.addOnsJpy`.
- **Post-payment receipt** — `BookingConfirmationView.tsx`. Shows booking code, dates, class, insurance name/rate, status, drop-off fees. **No itemized price block.** Operator name appears only inside a cancellation-contact string. The booking snapshot already stores per-add-on prices (`AddOnSnapshot { addOnId, name, priceJpy }`).
- **Pricing** — `composeBookingTotal` (`packages/shared/src/lib/pricing.ts`) returns a single number; `ReservationEstimate` (`packages/web/src/vite/reservation/pricing.ts`) carries only aggregate `addOnsJpy`. Per-add-on detail lives in `selectedAddOns` (pre-pay) and `AddOnSnapshot` (post-pay), so **no pricing-engine change is required**.
- **Buttons** — Tailwind v4. Shared `buttonVariants` (`packages/web/src/components/ui/button.tsx`) has no `cursor-pointer`. No global rule in `globals.css`. ~53 `Button` usages, 34 raw `<button>` across 29 files, plus `SelectTrigger` which doesn't route through `buttonVariants`.

## Decisions (from brainstorming)

- **Cost breakdown (per-item add-on prices)** applies to **both** the pre-payment review step (Slice B) and the post-payment receipt (Slice B).
- **Company/location info + storefront link** applies to the **post-payment receipt only** (Slice C). The original request scoped this to "the confirmation page … the car company and location, or a link to that store front." The renter reaches the wizard *from* that exact storefront moments earlier, so re-showing it pre-payment adds little — and would need the wizard loader to fetch storefront-summary data and thread it through `ConfirmStep` for marginal value. Out of scope unless requested. (This narrows the bundled "Both pages" brainstorming answer, which applies cleanly to the cost breakdown.)
- Structure as **4 linked issues**, worked **sequentially**, one PR each.
- Storefront: **link to the existing page only** — no schema change, no operator branding (logo/description) for now (YAGNI).

## Out of scope

- Operator branding fields (logo, description, website) — would need an `operators`/`locations` migration + seed + projection. Deferred.
- **Inline store name/address on the receipt** — the only piece that would require a new renter-safe location projection in `packages/api`. The storefront link (Slice C) already gets the renter to that detail, so this is deferred as a follow-up, not built now.
- Reworking `composeBookingTotal` or the pricing engine — per-item data already exists; Slice B adds only its pure inverse `deriveBaseJpy`.
- A real clickable step breadcrumb in the wizard — only the missing back affordance is in scope.
- The beta map feature (gated off) — untouched.

---

## Slice D — Pointer cursor on buttons (do first; trivial win)

**Problem:** Tailwind v4 Preflight removed the default `cursor: pointer` on `<button>`, so most interactive controls show the text/arrow cursor.

**Approach (≈95% coverage in three edits):**
1. Add `cursor-pointer` to the `buttonVariants` base class — `packages/web/src/components/ui/button.tsx`. Covers all `Button` + `buttonVariants()`-on-`Link` usages, including `size="icon"`.
2. Add a base-layer fallback in `packages/web/src/styles/globals.css`:
   ```css
   @layer base {
     button:not(:disabled):not([aria-disabled="true"]),
     [role="button"]:not([aria-disabled="true"]) {
       @apply cursor-pointer;
     }
   }
   ```
   Covers the 34 raw `<button>` tags and badge-rendered buttons. Both `:disabled` **and** `[aria-disabled="true"]` are excluded so a real `<button>` that is only ARIA-disabled (still focusable, `pointer-events` intact) keeps the default cursor instead of inviting a click.
3. Add `cursor-pointer` to `SelectTrigger` — `packages/web/src/components/ui/select.tsx` (doesn't route through `buttonVariants`).

**Test plan:** Unit/snapshot assertion that `buttonVariants()` output contains `cursor-pointer`; a base-style presence check. Manual hover pass on: primary buttons, icon buttons, select trigger, a raw `<button>` (e.g. `SearchMapList` "Show on map"), dropdown/dialog triggers.

**Files:** `button.tsx`, `globals.css`, `select.tsx`.

---

## Slice A — Wizard back navigation

**Problem:** Step 1 of the wizard (`dates`) has no back control (`ReservationWizard.tsx:134` renders `<span/>`), so after pressing "Book" the only way back to the car listing is the browser button.

**Approach:** The wizard route (`/$locale/_renter/bookings/new`) is reached with `locationId`, `from`, `to` (and `vehicleId`) in its **search params**. Replace the empty step-1 back slot with a styled "← Back to listing" `Link` to the storefront route, mapping those onto the destination's shape: `params={{ locale, locationId }}` (the storefront's **route** param) and `search={{ from: formatJstDateTimeLocal(from), to: formatJstDateTimeLocal(to) }}`. **These dates must be reformatted to JST `datetime-local` first — same as Slice C** (corrected 2026-06-17; an earlier draft wrongly claimed the wizard's `from`/`to` were already JST strings needing no reformatting): the wizard holds them as `Date` objects (props `readonly from: Date`/`to: Date`, sourced from the route's `parseSearchRange`), and a raw `Date` serialized into a search param becomes an ISO instant that `parseSearchRange` → `parseJstDateTimeLocal` rejects (→ redirect to `/search`). Mirror the existing `StorefrontDetailView` back-link styling (`ArrowLeft` icon + muted text). Steps 2–5 keep their in-wizard `Back` button unchanged. Net effect: every wizard screen has a back affordance, and step 1 returns the renter to the exact storefront they came from.

**i18n:** add a `nav.backToListing` key to en/ja/zh booking messages.

**Test plan:** Render wizard at step 1 → assert a link to `/$locale/storefronts/$locationId` with `from`/`to` search params is present (not an empty span). Render at step 2 → assert the existing `Back` button still steps the index down. No regression to the step counter.

**Files:** `ReservationWizard.tsx`; booking message catalogs (en/ja/zh).

---

## Slice B — Per-item cost breakdown

**Problem:** Add-on fees collapse into one `addOnsJpy` subtotal; the post-payment receipt shows no breakdown at all.

**Approach (presentation-only; data already present):**
- **Pre-payment** (`ConfirmStep.tsx`): render one `<div>` row per entry in `selectedAddOns` with its `name` and `formatJpy(addOn.priceJpy)`, replacing the single collapsed "Add-ons" row. Keep base, insurance, and total rows as-is.
- **Post-payment** (`BookingConfirmationView.tsx`): add an itemized "Price breakdown" block — base, insurance (name + amount), one line per `AddOnSnapshot`, and the total — sourced from the booking DTO the view already loads.

**Base price is derived, not stored (resolves review P2).** `BookingDto` (`packages/web/src/vite/bookings/api.ts:19-42`) carries `totalPrice`, `insuranceSnapshot`, `addOnSnapshot`, and `feeSnapshot` — but **no base field**. `composeBookingTotal` is `base + insurancePerDay*days + sum(addOns)` and **excludes fees**, so `totalPrice` is exactly those three components. Base is therefore an exact inverse, computed by a new pure, null-safe helper `deriveBaseJpy({ totalPrice, insuranceSnapshot, addOnSnapshot, days })` placed next to `composeBookingTotal` in `@kuruma/shared/lib/pricing` (the inverse of its sibling, DRY, unit-tested). Returns `null` when `totalPrice` is null → the receipt then omits the breakdown block rather than rendering a wrong number. `days` comes from `startAt`/`endAt` (already on the DTO). Fees stay in their own existing "fees" section (drop-off etc.), since they are not part of `totalPrice`. No migration, no API change — this slice is web + shared only.

**i18n:** reuse existing `confirm.*` keys; add receipt keys (`priceBreakdown`, per-line labels) in en/ja/zh as needed.

**Test plan:**
- `deriveBaseJpy` (shared, pure): round-trips `composeBookingTotal` — given a base, insurance, days, add-ons → compose → derive returns the original base. Null `totalPrice` → `null`. Mutation-resistant exact-yen assertions.
- `ConfirmStep` with two add-ons → assert two distinct price rows with the correct per-item yen, not one summed row.
- `BookingConfirmationView` with a booking carrying two add-on snapshots + insurance + a non-null total → assert the base, insurance, each add-on line, and the total render with exact yen; with null `totalPrice` → assert the breakdown block is absent.

**Files:** `packages/shared/src/lib/pricing.ts` (+ test); `ConfirmStep.tsx`, `BookingConfirmationView.tsx`; booking/confirmation message catalogs.

---

## Slice C — Confirmation: rental company + storefront link

**Problem:** The receipt doesn't clearly surface who you're renting from or offer a path to the company's storefront.

**Approach (zero-API — resolves the review Open Question):** the existing `BookingDto` already carries everything the requirement needs: `operator.name` (the company) and `pickupLocationId` + `startAt`/`endAt` (enough to build the storefront link). Add a "Rental company" block to `BookingConfirmationView.tsx` showing `booking.operator?.name` and a prominent `Link` to the existing storefront page:

```tsx
import { formatJstDateTimeLocal } from '@/lib/datetime'
// ...
<Link
  to="/$locale/storefronts/$locationId"
  params={{ locale, locationId: booking.pickupLocationId }}
  search={{
    // MUST be JST datetime-local — NOT the raw ISO instant (see below).
    from: formatJstDateTimeLocal(new Date(booking.startAt)),
    to: formatJstDateTimeLocal(new Date(booking.endAt)),
  }}
>{t('viewStorefront')}</Link>
```

**The `search` range is mandatory AND must be reformatted (resolves review P1 + a parser-format trap).** The storefront route loader (`packages/web/src/routes/$locale/storefronts/$locationId.tsx:46-59`) throws `redirect({ to: '/$locale/search' })` when `parseSearchRange(from, to)` returns null — a link with only `to`/`params` bounces to search. **And** `parseSearchRange` → `parseJstDateTimeLocal` (`packages/web/src/lib/datetime.ts:15-24`) only accepts wall-clock JST `datetime-local` strings (`YYYY-MM-DDTHH:mm`); a full ISO string (`…:00.000Z`) fails its regex, becomes `new Date("…Z+09:00")` → `NaN` → throws → null → redirect. So the booking's ISO `startAt`/`endAt` must be passed through `formatJstDateTimeLocal(new Date(...))` (the documented inverse) first. Use `endAt` (the renter's return), not `effectiveEndAt` (which adds turnaround buffer).

The storefront page itself already shows store name, address, and hours — so a link satisfies the user's stated requirement ("…or a link to that store front, so user can click on it and view the details"). Rendering the store **name/address inline on the receipt** is deferred (see Out of scope) because it is the only piece needing a new renter-safe API projection (`booking-query.ts:143-154` enriches only `operator:{name,preAuthHandoffUrl}` today).

**i18n:** add `rentalCompany`, `viewStorefront` keys (en/ja/zh).

**Test plan:** `BookingConfirmationView` renders the company name and a link whose `to`/`params`/`search` resolve to `/$locale/storefronts/<pickupLocationId>` carrying `from`/`to`; assert `parseSearchRange(from, to)` is non-null for those values (proves no redirect). No API test — no API change.

**Files:** `BookingConfirmationView.tsx`; confirmation message catalogs. **No `packages/api` / `@kuruma/shared` change.**

---

## Sequencing & issue linking

Order: **D → A → B → C** (trivial-first; B and C both touch `BookingConfirmationView` so C follows B to minimize churn). Each slice is an independent GitHub issue; a short tracking note links the four. Each ends in its own TDD-built, reviewed, mergeable PR based on `develop`.

## Risks

- **No API change in any slice** — all four are `packages/web` + `packages/shared` only (verified against `booking-query.ts`, `booking/api.ts`, the storefront route). This removes the earlier cross-package risk: no migration, no renter-safe projection work, no `@kuruma/shared` schema churn beyond the `deriveBaseJpy` helper.
- **Storefront-link redirect (Slice C)** — the storefront route bounces to `/search` without a valid date range, and its parser only accepts JST `datetime-local` (not ISO). Mitigated by converting the booking's ISO `startAt`/`endAt` with `formatJstDateTimeLocal` and asserting `parseSearchRange` returns non-null for the link's actual `search` values in the test.
- **i18n key drift on merge** — verify en/ja/zh parity after each slice (known repo gotcha).
- **Cursor base-layer rule over-reaching** — scoped with `:disabled` **and** `[aria-disabled="true"]` guards so disabled (real or ARIA) controls keep the default cursor.
