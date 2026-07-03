# Renter "Book a Class-Combo Deal" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last gap in #464. Let a renter **discover** a vehicle-CLASS deal on a store page and **book** it (no specific car chosen); the operator assigns a concrete car on/before pickup (already built). Delivers the renter create-flow that was explicitly deferred in `docs/plans/2026-06-25-464-assign-vehicle-to-float-plan.md` ("Out of scope: Renter 'book this class deal' UI").

**Architecture:** The server already accepts a `CLASS_COMBO` booking (`POST /bookings` discriminated union, advisory-lock supply guard, class-rate pricing) and already produces cross-operator combo search cards. Only the renter's **browse -> pick -> book** path is missing. Owner decision (2026-07-02): entry point is **via the store page (Option A)** — a class deal in search links to the store page, which now lists the store's class deals **alongside** its cars; picking one opens the reservation wizard. This is consistent with how booking a specific car already works (search -> store -> wizard) and lets renters who browse a store directly also discover deals.

The one piece of new server work: the storefront-detail endpoint must return the location's class offerings. We get this for free by **extracting the combo producer** (`findComboItems`/`toCombo`, today private to `FlatSearchService`) into a shared `ClassOfferingService`, injected into **both** `FlatSearchService` and `StorefrontDetailService` and wired in the composition root. Service->service injection has precedent here (`OperatorTeamService` takes `ProviderInviteService`; `ConsentGateService` takes `ConsentService`). No new endpoint, **no migration**.

**Tech Stack:** Hono (CF Workers), Drizzle/Postgres (neon), Zod, Vitest, Vite + TanStack Router/Query, use-intl. Bun.

**Spec / refs:** #464 (epic #385 §1.1/§4/§5). Prior slices merged: schema+supply-guard+route #1035, operator-assign #1143, search read-side #1058/#1077/#1094, capacity guards #1039/#1122. Read `docs/plans/2026-06-25-464-assign-vehicle-to-float-design.md` for the class-combo domain model first.

**Review:** Two architect passes 2026-07-02 — verdict *sound with changes*; all findings folded below. Pass 1: deploy-skew schema default, correct web render target, loader guard, offering scope hardening, ctor blast radius. Pass 2 (contract-level): renter confirmation needs an **expanded vehicle read** to show the assigned car (not render-only, Task 7), the sold-out RED test must pin existing behavior (**producer emits no offering when sold out**, Task 1/2), and `CreateBookingInput`'s union breaks the existing `Omit<…, 'disclaimerAccepted'>` callers (needs a distributive draft type, Task 4). No rework — plan edits only.

**Conventions:** TDD vertical slices — one failing test -> minimal impl -> green -> commit. API unit tests: `env -u DATABASE_URL bun run --filter @kuruma/api test`; real-pg integration needs a local `postgres:16` + `DATABASE_URL` (`bun run --filter @kuruma/api test:integration`). Web: `bun run --filter @kuruma/web test` (run from `packages/web`). After any web route/i18n change run `bun run scripts/lint-i18n-parity.ts`. **Storefront-detail changes an existing service contract — run the full API integration suite before pushing** (separate config, needs docker `DATABASE_URL`). Commit messages: `feat(#464): …` / `test(#464): …` / `refactor(#464): …`.

---

## Owner-locked decisions

| Decision | Choice | Note |
|----------|--------|------|
| Entry point | **Via store page (Option A)** | Class deal card -> store page -> pick deal -> wizard. Store page gains a "Class deals" section. |
| Offering type | Reuse `ClassComboSearchResult` | Accept the redundant `location`/`kind` fields; keeps the extracted producer's output directly usable (DRY over a trimmed parallel type). |
| Combo reuse | Extract `ClassOfferingService` | Inject into `FlatSearchService` + `StorefrontDetailService`; wire in `index.ts`. |
| Pricing | Reuse `estimateReservation` | A class's `{dailyRateJpy, hourlyRateJpy}` satisfies `VehicleRates` — **no new money math**. |
| Migration / endpoint | None | Storefront-detail extended in place; `POST /bookings` already accepts `CLASS_COMBO`. |

## Verified anchors (base facts)

- **API storefront-detail:** route `packages/api/src/routes/storefronts.ts:62` (`GET /storefronts/:locationId/vehicles`) -> `StorefrontDetailService.getDetail` `packages/api/src/services/storefront-detail.ts:185` (ctor `:116`, DTO `StorefrontDetailData` `:64`). It already fetches storefront (`findActiveStorefronts`, has lat/lng) + `findAvailableVehicles`; it does **not** inject `classRatePlanRepo`.
- **Combo producer:** `FlatSearchService.findComboItems` `packages/api/src/services/flat-search.ts:158`, `toCombo` `:173`, call-site `:128`. Takes `ClassRatePlanFilters { operatorId?, locationIds? }` (`packages/api/src/repositories/types-pricing.ts:8`) + `from/to` + `locationById`/`classById` maps + ACRISS `requested` set. `availableCount = max(0, countClassCapacity - countClassDemand)` (`repositories/drizzle/availability.ts:205`/`:156`). Rate = `plan.dayRateJpy`. **Scopes to one location by passing `locationIds: [locationId]`.**
- **Shared DTO:** `ClassComboSearchResult` `packages/shared/src/types/search-result.ts:52` (extends `SearchResultBase` `:27`).
- **Composition root:** `packages/api/src/index.ts:491` (storefrontDetailService), `:498` (flatSearchService).
- **Web store page:** `packages/web/src/routes/$locale/storefronts/$locationId.tsx` (renders specific-vehicle cards only). Web mirror `storefrontDetailResultSchema` `packages/web/src/vite/storefronts/schema.ts:91`.
- **Search combo card:** `ComboRow` `packages/web/src/vite/search/SearchResultRow.tsx:206`; CTA link `to="/$locale/storefronts/$locationId"` `:122` — already lands on the store page (no change needed to the card).
- **Reservation route loader:** `packages/web/src/routes/$locale/_renter/bookings/new.tsx:51` — reads `vehicleId/locationId/from/to`, calls `fetchStorefrontDetail(locationId)` `:62`, finds vehicle in `detail.vehicles` `:66`, redirects if absent.
- **Reservation wizard:** `packages/web/src/vite/reservation/ReservationWizard.tsx` — prop `vehicle: AvailableVehicleData` `:21`, estimate `:68`, SPECIFIC bookingInput `:77`.
- **Pricing:** `ReservationEstimateInput.vehicle: VehicleRates` `packages/web/src/vite/reservation/pricing.ts:12`; `VehicleRates = {dailyRateJpy, hourlyRateJpy}` `packages/shared/src/lib/pricing.ts:12`.
- **Web booking client:** `CreateBookingInput` (SPECIFIC-only) `packages/web/src/vite/bookings/api.ts:103`; `createBooking` `:126` (omits `fulfillmentMode`).
- **Shared validator:** `createBookingSchema` discriminated union `packages/shared/src/validators/booking.ts:65` — CLASS_COMBO arm `:59` needs `{fulfillmentMode:'CLASS_COMBO', classId, ...common}`. **Server already accepts it.**

---

## File map

| File | Responsibility | Task |
|------|----------------|------|
| `packages/api/src/services/class-offering.ts` (new) | `ClassOfferingService.findOfferings(...)` extracted from FlatSearch combo producer | 1 |
| `packages/api/src/services/flat-search.ts` | delegate combos to injected `ClassOfferingService`; drop `classRatePlanRepo` dep | 1 |
| `packages/api/src/index.ts` | construct `ClassOfferingService`, inject into both services | 1,2 |
| `packages/api/src/services/storefront-detail.ts` | inject `ClassOfferingService`; add `classOfferings` to `StorefrontDetailData`; build `ResultLocation` from raw storefront (lat/lng) | 2 |
| `packages/api/src/routes/storefronts.ts` | pass `classOfferings` through (already returns `result.data`) | 2 |
| `packages/web/src/vite/storefronts/schema.ts` | add `classOfferings` to the mirror schema **as `.default([])`** (deploy skew) | 3 |
| `packages/web/src/vite/storefronts/StorefrontDetailView.tsx` | render a "Class deals" section (the card grid lives here, not the route file); card links to `bookings/new?classId=…` | 3 |
| `packages/web/src/vite/storefronts/ClassOfferingCard.tsx` (new) | class-deal card (mirror the specific-vehicle card) | 3 |
| `packages/web/src/vite/bookings/api.ts` | `CreateBookingInput` discriminated union; export distributive `CreateBookingDraft`; `createBooking` sends `fulfillmentMode`+discriminant | 4 |
| `packages/web/src/vite/reservation/PaymentStep.tsx` | repoint `Omit<CreateBookingInput,'disclaimerAccepted'>` prop (`:13`) to `CreateBookingDraft` | 4 |
| `packages/web/src/routes/$locale/_renter/bookings/new.tsx` | loader resolves a vehicle **or** class subject; add `classId` to search | 5 |
| `packages/web/src/vite/reservation/subject.ts` (new) | `ReservationSubject` union + `subjectRates`/`subjectDisplay` helpers | 6 |
| `packages/web/src/vite/reservation/ReservationWizard.tsx` | accept `subject` (vehicle-or-class); branch bookingInput; class label/photo; "car assigned before pickup" note | 6 |
| `packages/web/src/vite/bookings/api.ts` + confirmation view | expanded `?expand=vehicle,renter` read + optional `vehicle` on schema; render class + "assigned before pickup" then the concrete car post-assign (API already supplies via `findByIdWithVehicleAndRenter`) | 7 |
| `packages/web/messages/{en,ja,zh}.json` | i18n: class-deals heading, availability, confirmation note | 3,6,7 |
| `packages/web/tests/e2e/renter-combo-booking.spec.ts` (new) | search -> store -> pick deal -> book -> confirm | 8 |

---

## Slice 1 — Extract the combo producer (behavior-preserving)

### Task 1: `ClassOfferingService` extracted from `FlatSearchService`

**Files:** new `packages/api/src/services/class-offering.ts`; modify `flat-search.ts`, `index.ts`; new `packages/api/src/services/class-offering.test.ts`.

- [ ] **Step 1 (RED):** Write a unit test for `ClassOfferingService.findOfferings` that reproduces today's `toCombo` behavior: given one active rate plan + an own AVAILABLE road-legal vehicle of that class at the location, it returns one `ClassComboSearchResult` with the right `classId`, `dailyRateJpy = plan.dayRateJpy`, `hourlyRateJpy: null`, and `availableCount = capacity - demand`. Add a case where an overlapping CONFIRMED booking drops `availableCount`, and one where a **sold-out class (`capacity - demand <= 0`) yields NO offering** — the producer returns `null` and filters it out (`flat-search.ts:210`: `if (availableCount <= 0) return null`). This is behavioral preservation: pin what callers observe today (sold-out deals are never emitted; the web `ComboRow` at `SearchResultRow.tsx:203` documents this invariant), not a new zero-count edge.

```ts
it('produces a combo offering scoped to one location with correct availableCount', async () => {
  const offerings = await service.findOfferings(
    { locationIds: [location.id] }, from, to, locationById, classById, null,
  )
  expect(offerings).toEqual([
    expect.objectContaining({ kind: 'CLASS_COMBO', classId: klass.id, dailyRateJpy: 6000, availableCount: 2 }),
  ])
})
```

- [ ] **Step 2 (RED run):** `env -u DATABASE_URL bun run --filter @kuruma/api test class-offering` -> FAIL (module missing).
- [ ] **Step 3 (GREEN):** Move `findComboItems` + `toCombo` verbatim into `ClassOfferingService` (ctor: `classRatePlanRepo: ClassRatePlanRepository`, `availabilityRepo: AvailabilityRepository`). Public method `findOfferings(planFilters, from, to, locationById, classById, requested)`. Keep signatures identical.
- [ ] **Step 4 (GREEN):** In `FlatSearchService`: inject `classOfferingService` (drop `classRatePlanRepo` from its ctor — it was only used for combos), replace the `findComboItems(...)` call at `flat-search.ts:128` with `this.classOfferingService.findOfferings(...)`. Delete the moved private methods.
- [ ] **Step 5 (GREEN):** `index.ts` — construct `const classOfferingService = new ClassOfferingService(classRatePlanRepo, availabilityRepo)` and pass it into the `FlatSearchService` ctor (`:498`). **Ctor blast radius:** dropping `classRatePlanRepo` and adding `classOfferingService` changes the `FlatSearchService` arg list at every construction site — `index.ts:498` plus the test builders `flat-search.test.ts:68`/`:406`/`:500`. Behavior is preserved but these arg lists must be edited or the suite won't compile.
- [ ] **Step 6 (VERIFY):** `flat-search.test.ts` still green (behavior preserved). Run `env -u DATABASE_URL bun run --filter @kuruma/api test flat-search class-offering`.
- [ ] **Step 7:** `bun run --filter @kuruma/api lint:boundaries` (no concrete-repo construction outside `index.ts`). Commit `refactor(#464): extract ClassOfferingService from flat-search combo producer`.

**Note (architect):** `ResultLocation` needs `latitude/longitude`. `findActiveStorefronts` returns storefronts carrying lat/lng (flat-search already builds `locationById` from them). Keep `findOfferings` taking the pre-built `locationById` map so it stays agnostic to caller context.

---

## Slice 2 — Store page surfaces class deals (server + web read)

### Task 2: storefront-detail returns `classOfferings`

**Files:** `storefront-detail.ts`, `index.ts`; tests `packages/api/src/services/storefront-detail.test.ts`, `packages/api/tests/routes/storefronts.test.ts`.

- [ ] **Step 1 (RED):** Extend the service test: seed a location with one specific AVAILABLE vehicle **and** one active class rate plan (own road-legal inventory). Assert `getDetail(...)` returns `classOfferings: [ClassComboSearchResult]` with correct `availableCount`, and that the `classes` (ACRISS) filter narrows offerings the same way it narrows vehicles. Add a case where a class is fully booked (`capacity - demand <= 0`) -> it does **not** appear in `classOfferings` (sold-out invariant carried through from the producer). The store-page card in Task 3 therefore needs no zero state — like `ComboRow`, it can assume `availableCount > 0`.

```ts
const res = await service.getDetail(PUBLIC_CONTEXT, { locationId, from, to, limit: 25 })
if (!res.ok) throw new Error('expected ok')
expect(res.data.classOfferings).toEqual([
  expect.objectContaining({ kind: 'CLASS_COMBO', classId: klass.id, availableCount: 1 }),
])
expect(res.data.vehicles).toHaveLength(1) // specific cars unchanged
```

- [ ] **Step 2 (RED run):** FAIL (`classOfferings` undefined).
- [ ] **Step 3 (GREEN):** Add `classOfferings: ClassComboSearchResult[]` to `StorefrontDetailData` (`storefront-detail.ts:64`). Inject `classOfferingService` into the ctor (`:116`) and wire it in `index.ts:491`. In `getDetail`, build `locationById` from the **raw storefront record** (`storefront-detail.ts:194`, which carries lat/lng — **not** the trimmed `StorefrontSummary` DTO, which drops them) and `classById` from the classes it already loads, then `const classOfferings = await this.classOfferingService.findOfferings({ operatorId: storefront.operatorId, locationIds: [locationId] }, from, to, locationById, classById, requested)`. Passing `operatorId` (already resolved from the active-only storefront read) forecloses a stray cross-operator rate plan surfacing a card under the wrong store — flat-search can't scope this way (multi-store), storefront-detail can. Return it alongside `vehicles`. Offerings are unpaginated (a handful per operator); `nextCursor` still paginates `vehicles` only.
- [ ] **Step 4 (RED->GREEN route):** In `storefronts.test.ts` (near `:206`) assert the JSON payload of `GET /storefronts/:locationId/vehicles` includes `classOfferings` and still sets the 10s cache header. Route already returns `result.data` verbatim — no route code change beyond the pass-through.
- [ ] **Step 5 (VERIFY):** `bun run --filter @kuruma/api lint:boundaries`; full API integration suite (contract change). Commit `feat(#464): storefront-detail returns class-combo offerings`.

### Task 3: store page renders a "Class deals" section

**Files:** `packages/web/src/vite/storefronts/schema.ts`, `.../$locationId.tsx`, new `ClassOfferingCard.tsx`, `messages/*`; web tests.

- [ ] **Step 1 (RED):** Web test for the store-detail route: given a `classOfferings` entry, the page renders a class card showing the class label, seats, `availableCount` ("N available"), price, and a CTA linking `to="/$locale/_renter/bookings/new"` with `search` carrying `classId`, `locationId`, `from`, `to` (and no `vehicleId`).

```tsx
expect(screen.getByRole('link', { name: /book/i })).toHaveAttribute(
  'href', expect.stringContaining('classId=' + klass.id),
)
```

- [ ] **Step 2 (RED run):** FAIL.
- [ ] **Step 3 (GREEN):** Add `classOfferings` (array of the combo member) to `storefrontDetailResultSchema` (`schema.ts:91`) as **`z.array(...).default([])`** — the web/api workers deploy independently, so a required field would parse-error the store *and* reservation loaders if new web hits old API mid-rollout (the schema's own rule: "never stricter than the wire"). Build `ClassOfferingCard.tsx` mirroring the specific-vehicle card. Render the "Class deals" section in **`StorefrontDetailView.tsx`** (`:39`/`:88` — the card grid lives there, not the route file) when `classOfferings.length > 0`. Render the section header from `detail.storefront` (the store's own identity); use each offering only for `classId`/rates/`availableCount`/label — do **not** treat the redundant `offering.location` as a source of truth. Link target: `bookings/new` with `classId` in search.
- [ ] **Step 4 (i18n):** add `storefront.classDeals` heading, `storefront.classAvailable` ("{count} available"), reuse `search.classDeal` badge. Run `bun run scripts/lint-i18n-parity.ts`.
- [ ] **Step 5 (VERIFY):** `bun run --filter @kuruma/web test`; `bun run lint:modules`. Commit `feat(#464): render class-deal cards on the store page`.

---

## Slice 3 — Book a class deal (web write path)

### Task 4: web booking client — CLASS_COMBO variant

**Files:** `packages/web/src/vite/bookings/api.ts`; tests co-located.

- [ ] **Step 1 (RED):** Test that `createBooking` with a `CLASS_COMBO` input POSTs a body containing `fulfillmentMode: 'CLASS_COMBO'` + `classId` (and **no** `requestedVehicleId`); and that a `SPECIFIC` input still posts `fulfillmentMode:'SPECIFIC'` + `requestedVehicleId`.
- [ ] **Step 2 (RED run):** FAIL (type has no `classId`).
- [ ] **Step 3 (GREEN):** Turn `CreateBookingInput` (`:103`) into a discriminated union mirroring the shared validator: `{ fulfillmentMode:'SPECIFIC'; requestedVehicleId } | { fulfillmentMode:'CLASS_COMBO'; classId }` + shared common fields. Update `createBooking` (`:126`) to send `fulfillmentMode` explicitly and the correct discriminant. Keep `bookingDtoSchema` unwrap unchanged.
- [ ] **Step 3b (GREEN) — fix the `Omit` callers (TS union trap):** `Omit<CreateBookingInput, 'disclaimerAccepted'>` is **non-distributive** — over a union it computes `keyof (Specific | Combo)` = the common keys only, silently dropping `requestedVehicleId`/`classId`. Two callers use it: `PaymentStep.tsx:13` (prop type) and `ReservationWizard.tsx:77` (local `bookingInput`). Export a distributive draft type from `bookings/api.ts` — `type CreateBookingDraft = CreateBookingInput extends infer T ? T extends unknown ? Omit<T, 'disclaimerAccepted'> : never : never` (or a named `DistributiveOmit<T, K>`) — and repoint both callers to `CreateBookingDraft`. The wizard then adds `disclaimerAccepted` when handing the draft to `createBooking`.
- [ ] **Step 4 (VERIFY):** `bun run --filter @kuruma/web test bookings` **and** `bun run --filter @kuruma/web typecheck` (the union/Omit change is a typecheck-surface change — unit tests alone won't catch the dropped discriminant fields). Commit `feat(#464): booking client supports CLASS_COMBO create`.

### Task 5: reservation loader resolves a vehicle-or-class subject

**Files:** `packages/web/src/routes/$locale/_renter/bookings/new.tsx`; route test.

- [ ] **Step 1 (RED):** Loader test: with `classId` in search (no `vehicleId`), the loader returns a `subject` of kind `CLASS_COMBO` resolved from `detail.classOfferings` by `classId`; with an unknown `classId` it redirects to the store page; the existing `vehicleId` path still returns a `SPECIFIC` subject. (Web `tests/**` is not typechecked — cast `Route.options.loader` as the loader fn, as in prior route tests.)
- [ ] **Step 2 (RED run):** FAIL.
- [ ] **Step 3 (GREEN):** Add `classId?: string` to `NewBookingSearch` (`:9`) — **distinct from the existing `class` ACRISS filter param (`:16`); do not overload it.** Widen the early redirect guard at `new.tsx:58` from `!deps.vehicleId` to `(!deps.vehicleId && !deps.classId)`, else a `classId`-only entry bounces to `/search` before it can resolve. In the loader (`:51`), after `fetchStorefrontDetail`: if `deps.classId`, find it in `detail.classOfferings` -> `{ kind:'CLASS_COMBO', offering }`; else resolve the vehicle as today -> `{ kind:'SPECIFIC', vehicle }`. Redirect to the store page when neither resolves. Return `subject` (replacing the bare `vehicle`).
- [ ] **Step 4 (VERIFY):** `bun run --filter @kuruma/web test`. Commit `feat(#464): reservation loader resolves class-combo subject`.

### Task 6: ReservationWizard books a class subject

**Files:** new `packages/web/src/vite/reservation/subject.ts`; `ReservationWizard.tsx`; `messages/*`; wizard test.

- [ ] **Step 1 (RED):** Wizard test: rendered with a `CLASS_COMBO` subject, it (a) displays the class label + photo, (b) prices via `estimateReservation` using the class's rates, (c) on submit builds a `CLASS_COMBO` bookingInput (`classId`, no `requestedVehicleId`), and (d) shows the "a specific car will be assigned before pickup" note. Assert the exact submitted input shape (mutation-resistant).
- [ ] **Step 2 (RED run):** FAIL (prop is `vehicle`).
- [ ] **Step 3 (GREEN):** Add `subject.ts`: `type ReservationSubject = { kind:'SPECIFIC'; vehicle } | { kind:'CLASS_COMBO'; offering }` with `subjectRates(subject): VehicleRates` and `subjectDisplay(subject): { label; photo; seats }`. Change the wizard prop from `vehicle` to `subject` (`:21`); feed `subjectRates(subject)` to `estimateReservation` (`:68`); branch the bookingInput (`:77`) on `subject.kind`. Add the assignment note for CLASS_COMBO to the confirm step.
- [ ] **Step 4 (i18n):** `reservation.classAssignmentNote` (en/ja/zh). Parity script.
- [ ] **Step 5 (VERIFY):** `bun run --filter @kuruma/web test`. Commit `feat(#464): reservation wizard books a class-combo deal`.

---

## Slice 4 — Renter sees the assigned car (verify + patch)

### Task 7: renter confirmation reflects float -> assigned (read-contract, not render-only)

**Contract note:** the assigned car's name does **not** cross the wire on the base read. `fetchBookingById` (`bookings/api.ts:153`) calls `GET /bookings/:id` with no `expand`, and `bookingDtoSchema` (`:76`) carries `vehicleClassId` but **no vehicle name/object** — the name is only attached via `expand`. Pre-assign already works: the confirmation loader fetches the class label separately (`classByIdQueryOptions` when `booking.classId`, `confirmation.tsx:31`). The gap is the post-assign concrete car. **The API already supplies it** — `GET /bookings/:id?expand=vehicle,renter` -> `findByIdWithVehicleAndRenter` (`routes/bookings.ts:101`, `services/booking-query.ts` #549) enriches the scope-checked booking with renter-safe `vehicle: { name, photos }`. **The single read requires BOTH `vehicle` and `renter`** (no vehicle-only branch, unlike the list) — so request `expand=vehicle,renter`. No API change.

**Files:** `packages/web/src/vite/bookings/api.ts` (expanded read + schema), `confirmation.tsx` / `BookingConfirmationView.tsx`; tests.

- [ ] **Step 1 (RED):** Web test for the confirmation view of a `CLASS_COMBO` booking: pre-assign (`assignedVehicleId: null`, `vehicle` absent) shows the class label + "a specific car will be assigned before pickup"; post-assign (`vehicle: { name }` present) shows the concrete vehicle name. Mock the `GET /bookings/:id?expand=vehicle,renter` response both ways.
- [ ] **Step 2 (RED run):** FAIL (no `vehicle` on the read).
- [ ] **Step 3 (GREEN):** Add optional `vehicle?: { name: string; photos: string[] }` to `bookingDtoSchema` (additive/back-compat) — or a dedicated `renterBookingDetailSchema`. Point the confirmation's `bookingByIdQueryOptions` read at `?expand=vehicle,renter` (a variant query so the base `fetchBookingById` used elsewhere, e.g. the self-cancel re-read, is untouched). Render `booking.vehicle?.name` when present, else the class label + assignment note. `findByIdWithVehicleAndRenter` calls `findById` first, which enforces renter scope — no new authz.
- [ ] **Step 4 (VERIFY):** `bun run --filter @kuruma/web test`. Commit `feat(#464): renter confirmation shows the assigned car once the operator assigns`.

---

## Slice 5 — End-to-end journey

### Task 8: Playwright e2e

**Files:** new `packages/web/tests/e2e/renter-combo-booking.spec.ts`.

- [ ] **Step 1:** E2E: search (location + dates) -> class-deal card -> store page "Class deals" -> pick deal -> wizard (dates/insurance/add-ons) -> confirm; assert the confirmation shows the class + the "assigned before pickup" note. Mock or seed a location with an active class rate plan + road-legal inventory.
- [ ] **Step 2 (optional):** extend with operator assign -> renter refresh -> concrete car shown (covers Task 7 through the UI).
- [ ] **Step 3 (VERIFY):** `bun run test:e2e renter-combo-booking`. Commit `test(#464): e2e renter class-combo booking journey`.

---

## Acceptance criteria

1. A class deal in search links to the store page; the store page lists the store's class deals (label, seats, availability, price) alongside its cars.
2. Picking a class deal opens the reservation wizard priced off the class rate plan (no per-vehicle rate).
3. Confirming posts a `CLASS_COMBO` booking (`classId`, no `requestedVehicleId`); the server's advisory-lock supply guard still gates sold-out classes (409 `CLASS_COMBO_SOLD_OUT`).
4. The renter's booking detail shows "car assigned before pickup" until the operator assigns, then the concrete vehicle.
5. `bun run --filter @kuruma/api lint:boundaries`, full API integration suite, web unit suite, i18n parity, and the new e2e all green.

## Out of scope / follow-ups

- Operator assign flow, supply guard, class-rate pricing, search read-side — all already merged.
- No schema migration; no new API endpoint.
- Regions / nationwide search extension — separate issue #1276.
- Prune stale remote branches `feat/464-combo-web`, `feat/464-class-combo` after merge.

## Design questions — resolved by architect review (2026-07-02)

1. **`ClassOfferingService` as an injected service — yes.** Matches precedent (`OperatorTeamService`←`ProviderInviteService`), passes `lint:boundaries`, and is the better ISP outcome: `StorefrontDetailService` depends on a narrow one-method `findOfferings` capability, not on the raw `classRatePlanRepo`. A pure module would force both consumers to hold + thread the repos for no gain.
2. **Reuse `ClassComboSearchResult` — yes.** One type end-to-end (the producer already emits it); a trimmed type costs a mapping step + a second Zod mirror + divergence risk. Guardrail folded into Task 3: render the store header from `detail.storefront`, use the offering only for `classId`/rates/`availableCount`/label so a future `location`-vs-`storefront` mismatch can't become a silent UI bug.
3. **Keep offerings separate and unpaginated.** `vehicles` is `AvailableVehicle[]`, offerings are `ClassComboSearchResult[]`; folding into the `vehicles` cursor is a category error. Return them whole (mirrors `insuranceOptions`/`addOns`); `nextCursor` keeps paginating `vehicles` only. Bounded at ~one row per class at 40-50 cars.
4. **Apply the ACRISS filter to offerings — yes.** A filter that hides matching cars but leaves matching deals visible is incoherent; `toCombo` already applies the identical gate, so passing the same `requested` set through `findOfferings` is free.
