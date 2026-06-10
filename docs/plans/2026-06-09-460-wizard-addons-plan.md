# #460 — Multi-step reservation wizard + paid add-ons (plan)

Branch off `marketplace-pivot`. Epic #385, demo #488. Source of truth: `docs/plans/2026-05-25-marketplace-mvp-proposal.md` §1.4, §5, §9.19 + 2026-06-05 addendum.

## Design summary
- **Add-on = operator-owned, priced, selectable item** (baby seat, ETC card…). Mirrors `insurance_options` exactly (the proven slice-4a vertical). Distinct from `fee_schedules` (potential post-rental charges — informational).
- **Snapshot pattern**: chosen add-ons snapshot onto the booking as `jsonb[]` (`addOnSnapshot`), like `feeSnapshot`. Add-on prices **add to `totalPrice`** (they are charged via Stripe in MVP, §9.19).
- **Pricing**: add-on `priceJpy` is **flat per booking** (NOT per-day). Quantity is **out of scope** (one of each). [DECISION 1]
- **Wizard culminates in payment (#461)** — pay step is a **stubbed seam** (`<PaymentStep>` placeholder), rebase once #461 lands. Booking POST is shared with #459/#461 → keep changes additive.

## Slice A — Add-on entity (shared + api)  [DB + API, no UI]
| File | Change |
|------|--------|
| `packages/shared/src/db/schema.ts` | `addOnStatusEnum`, `addOnOptions` table (operatorId FK, name, description, priceJpy, status), indexes + active-name unique + composite-unique + price≥0 check. `AddOnSnapshot` type. |
| `packages/shared/src/validators/add-on.ts` | `createAddOnSchema` / `platformAdmin…` / `update…` (mirror insurance-option.ts). |
| `packages/shared/src/validators/index.ts` (or barrel) | export add-on validators. |
| `packages/api/src/stores.ts` | `AddOn` interface. |
| `packages/api/src/repositories/types.ts` | `AddOnRepository` interface (+ `findActiveByOperator` public read). |
| `packages/api/src/repositories/drizzle/add-on.ts` | Drizzle impl (clone insurance). |
| `packages/api/src/repositories/in-memory/add-on.ts` | InMemory impl. |
| `packages/api/src/repositories/{drizzle,in-memory}/index.ts` | barrel exports. |
| `packages/api/src/services/add-on.ts` | `AddOnService` (clone InsuranceOptionService). |
| `packages/api/src/routes/add-ons.ts` | CRUD routes (FLEET_WRITE for write, management-read for list). |
| `packages/api/src/routes/storefronts.ts` | `GET /storefronts/:locationId/add-ons` public read (mirror insurance-options). |
| `packages/api/src/index.ts` | DI wiring (repo override/drizzle/inmemory, service, mount routes). |
| migration | `bun run db:generate --name add_on_options` on **disposable Neon branch** → migrate → verify. |

## Slice B — Booking integration  [shared snapshot + api pricing]
| File | Change |
|------|--------|
| `packages/shared/src/db/schema.ts` | bookings: `addOnSnapshot jsonb[] NOT NULL DEFAULT []`. (No selected-id FK col — snapshot carries ids; add-ons can be multi.) |
| `packages/shared/src/validators/booking.ts` | `createBookingSchema`: add `addOnIds: z.string().uuid().array().default([])`. |
| `packages/api/src/services/booking.ts` | resolve add-ons by id (tenant-scoped to derived operatorId), build `addOnSnapshot`, `totalPrice += sum(priceJpy)`. Reject add-on not belonging to operator / archived. |
| `packages/api/src/stores.ts` | `Booking.addOnSnapshot: AddOnSnapshot[]`. |
| migration | same disposable branch, `--name booking_add_on_snapshot`. |

## Slice C — Reservation wizard (Vite/TanStack shell)  [UI]
Locked patterns: shell owns DTOs (`src/vite/<area>/api.ts`), `loader → ensureQueryData` + `useSuspenseQuery`, fetch via `getApiBaseUrl()`. STAGE `routeTree.gen.ts`.
| File | Change |
|------|--------|
| `packages/web/src/routes/$locale/_renter/bookings/new.tsx` | wizard route; gated by `_renter` (login required to book). [DECISION 2] `validateSearch` = {vehicleId, locationId, from, to}. loader prefetches add-ons + insurance. |
| `packages/web/src/vite/reservation/api.ts` | DTOs + fetchers (add-ons list, insurance list, createBooking POST). |
| `packages/web/src/vite/reservation/*` | `ReservationWizard`, step components: `DateRangeStep` (read-only from search), `AddOnsStep`, `InsuranceStep`, `ConfirmStep` (price breakdown incl. add-ons+insurance+fees), `PaymentStep` (**stub seam → #461**). |
| `packages/web/src/vite/storefronts/AvailableVehicleCard.tsx` | book CTA: inert button → `<Link to="/$locale/bookings/new" search={…}>`. |
| i18n | `messages/{en,ja,zh}.json` wizard namespace keys. |

## TDD order (vertical, RED→GREEN each)
1. shared add-on validator test → validator
2. api add-on service test (InMemory) → service + repos
3. api add-on routes test (auth/tenancy) → routes + storefront public read + DI
4. schema/migration (disposable Neon) → db:verify
5. booking service test: add-on snapshot + totalPrice → booking service change
6. vite: api fetchers test + wizard step component tests + route test → UI
7. wire book CTA + e2e (deferred to demo)

## Coordination / risk
- **Booking POST shared with #459/#461** — my edits to `booking.ts`/`createBookingSchema` are additive (new optional `addOnIds`, new snapshot col). Rebase frequently; resolve in favor of additive.
- **Pay step behind seam** — `PaymentStep` renders a disabled "Continue to payment" until #461; booking submit happens at confirm OR pay depending on #461 contract. MVP: submit at confirm, pay deferred. [DECISION 3]
- **Neon**: own disposable branch off staging (`marketplace-pivot`), never root `.env` (production).

## Decisions (locked 2026-06-09)
1. **Add-on pricing = flat per booking** (single `priceJpy`, charged once). Japan norm: optional equipment (child seat, ETC) is flat per-rental; per-day is the insurance model (already built). Quantity deferred.
2. **Wizard behind `_renter` guard** — login required to book.
3. **Hold live web submit until #461.** Wizard ends at `PaymentStep` stub; no `POST /bookings` from web yet (wires in during #461 rebase). API-side add-on snapshot + pricing still land now so #461 can call them.

## Out of scope / follow-ups
- Operator-facing add-on CRUD UI (entity is API + seed only this slice; renter wizard is the UI consumer). File follow-up.
- Add-on quantity (>1 of an item).
- Live `POST /bookings` from the wizard (lands with #461).

## CI gate before PR
`bun run lint` · `tsc --noEmit` (all pkgs + frozen) · `lint:boundaries` · `lint:modules` · `lint:fk-indexes` · `export-drift` · `i18n-parity` · shared+api+web vitest · `vite build` (regen routeTree) · `lint:dist-size`.
PR → marketplace-pivot (squash), `Closes #460`, close manually after merge.
