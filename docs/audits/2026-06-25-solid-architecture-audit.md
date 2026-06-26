# SOLID / Architecture & Maintainability Audit — 2026-06-25

Read-only audit by 5 parallel `architect` agents across `packages/api` (services / data+DI / routes+auth), `packages/web`, and `packages/shared`. Lenses: SOLID, Functional Core/Imperative Shell, DDD-lite (aggregates, primitive obsession, bounded contexts), deep modules. Report-only — no code changed.

## Verdict

**Architecturally strong.** SOLID's highest-value outcomes are already enforced *structurally*, so this is not a "refactor for SOLID's sake" list:

- **DIP** — the only `new Drizzle*`/`new InMemory*` live in the 4 sanctioned files; the only Stripe import is the one gateway; services depend on repo *interfaces*. `lint:boundaries` keeps it honest.
- **SRP** — the #713 split of the `BookingService` god-class into `booking-query` / `-creation` / `-lifecycle` behind a zero-logic facade is exemplary; no god-components in web.
- **ISP** — tx bundles narrow via `Pick<>`; `NotificationDispatcher` takes a function, not the whole membership repo.
- **FC/IS** — real decisions (`composeBookingTotal`, `calculateCancellationFee`, `checkRentalRules`, `one-way.ts` fold) are pure in `@kuruma/shared/lib`, take `now`/`t` as args, do zero I/O.
- **Type design** — discriminated unions over flag-bags throughout; `enums.ts` as a zero-import SSoT feeding both `pgEnum` and `z.enum`, order-pinned by test.

Findings: **1 HIGH, 7 MEDIUM, 9 LOW.**

## Cross-cutting themes (the real signal)

1. **Policy/scoping decisions live at the route, copy-pasted, instead of in the service/repo.** The single most valuable structural theme — it's both a DRY problem and a defence-in-depth gap. (Findings M3, M4, L4, L7.) *Heuristic: if deleting one route's `if`-block would leak data or mis-authorize, the invariant belongs below the route.*
2. **InMemory↔Drizzle behavioral parity is asserted by wiring, not behavior (LSP).** Services branch on Postgres constraint names, so every InMemory repo hand-mirrors PG error shapes — but only the *key-set* is tested, never equivalence. This gap is exactly what lets H1 reach prod. (Findings H1, M2.) *Heuristic: if services distinguish errors by constraint name, you owe a `describe.each([inMemory, drizzle])` conformance suite.*
3. **Duplicated pipelines/tails.** Booking submit tails, the two search services, the per-entity write-route branches. (Findings M5, L1, L4.) *Heuristic: same source + same paging, different shape = share the scaffold, vary the projector.*
4. **Invariants enforced by comment, not by type.** Integer-yen money and `Session.user.role` cross boundaries as bare `number`/`string`. (Findings M6, L8.) *Heuristic: when several same-typed values mean different things and one is money/identity, brand it so a mistake is a compile error.*
5. **SSoT drift.** `messaging.ts` hides its indexes in migrations; the web module-barrel boundary the docs promise is an unenforced lint no-op. (Findings M7, M5-web.) *Heuristic: a schema module or a lint rule that doesn't describe the thing it owns is lying.*

---

## HIGH

### H1 — InMemory exclusion check rejects overlapping CLASS_COMBO floats that Postgres allows
`packages/api/src/repositories/in-memory/booking.ts:173-185` vs `drizzle/0037_booking_exclusion_assigned_vehicle.sql:48-51`
- **Pattern:** LSP Violation (constraint-emulation drift)
- **Problem:** The DB `bookings_no_overlap` is `EXCLUDE USING gist ("assignedVehicleId" WITH =, tstzrange &&)`; Postgres never conflicts NULL keys, so two overlapping combo floats (`assignedVehicleId: null`, `CONFIRMED`) both insert. The InMemory mirror guards with `if (existing.assignedVehicleId !== data.assignedVehicleId) continue` — and `null !== null` is `false`, so it does *not* skip; any two time-overlapping floats (even across classes) throw `EXCLUSION_VIOLATION` → spurious 409 "Vehicle is already booked". Reachable the moment a class has capacity ≥2; masked today only because the combo test uses capacity 1. Local dev + every in-memory route test diverges from prod on the #464 headline feature.
- **Heuristic:** A `!== continue` guard over a nullable key inverts Postgres NULL-exclusion — null operands must `continue` (skip), not fall through.
- **Direction:** In InMemory `create`/`reassignVehicle`, short-circuit `if (data.assignedVehicleId === null)` before the overlap loop. Ship with a reproduction test (capacity-2 class, two overlapping floats → both succeed).

---

## MEDIUM

### M1 — Duplicated money-path tail across the two booking submit modes
`packages/api/src/services/booking-creation.ts:373-498` (SPECIFIC) vs `:642-746` (CLASS_COMBO)
- **Pattern:** DRY / SRP — divergent-copy of pricing-snapshot logic
- **Problem:** Insurance/fee/add-on snapshot, `composeBookingTotal`, walk-in mint, `bookingRepo.create`, `BOOKING_CREATED` append are near-identical in both `submit*InTxLocked`; they differ only in base-price source and `fulfillmentMode`. Largest service (712 lines, near cap). A fee fix applied to one path silently mis-prices the other — and it's money.
- **Heuristic:** When two methods differ only at the head (resolve+price) and share the tail (snapshot+insert+append), extract the tail.
- **Direction:** Private `snapshotAndInsert(ctx, repos, {...})` both locked paths call; each keeps only its mode-specific price derivation. No interface change.

### M2 — Cross-impl constraint behavior is conformance-tested for key-set, not behavior
`packages/api/src/pg-errors.ts:52-82` (consumed by 12 services); `composition/repositories.test.ts:30-70`
- **Pattern:** Backing Service Coupling (leaky infra abstraction)
- **Problem:** 12 services branch on PG codes + constraint-name constants, so every InMemory repo hand-replicates the postgres-js error shape. The only cross-impl test asserts the bundle *key set* matches, never that the two impls *behave* the same on a clash — which is exactly the failure mode H1 exploits.
- **Heuristic:** If services distinguish errors by constraint name, you owe a behavioral conformance suite — a key-set test proves wiring, not equivalence.
- **Direction:** `describe.each([inMemory, drizzle])` running the same overlap/idempotency/bookingCode scenarios against both (Drizzle arm behind the real-pg CI lane).

### M3 — Cross-operator read-scope guard lives only at the route, copy-pasted 5×
`routes/fee-schedules.ts:58-65`, `insurance-options.ts:51-58`, `add-ons.ts:51-58`, `locations.ts:42-49`, `notifications.ts:38-45`
- **Pattern:** DRY + Defence-in-Depth Gap
- **Problem:** The identical "bypass role + no `operatorId`/`includeAll` → 400" block is the *only* thing stopping a PLATFORM_ADMIN/PARTNER from reading every operator's private config (services are pass-throughs; repo defaults a bypass caller to all tenants). Any new caller that forgets the guard silently leaks cross-tenant data; a policy change is a 5-file edit.
- **Heuristic:** If removing one route's `if`-block would leak data, the invariant belongs in the service.
- **Direction:** Push "bypass caller must scope explicitly" into each service's `findAll` (safe default independent of caller), or at minimum extract `applyCrossOperatorReadScope(c, ctx, filters)` into `tenancy.ts`.

### M4 — `POST /bookings` reshapes the create command by role inside the handler
`routes/bookings.ts:157-211`
- **Pattern:** SRP / Business Logic in Route Handler
- **Problem:** The route computes `isManualBooker`, then overrides `renterId`/`source`/`walkInCustomer` and gates the disclaimer; the service trusts the resolved values. "Who may book on behalf of whom and force `source=MANUAL`" is domain authz, not reusable or unit-testable outside Hono.
- **Heuristic:** A route may *reject* on role; the moment it *rewrites the payload* on role, that's the service's job.
- **Direction:** Pass `ctx` + raw input to `service.create`; a `resolveBookingActor(ctx, input)` policy derives the fields (mirror the consent gate, already service-side).

### M5 — Web `@/modules/<feature>` barrel boundary is unenforced; all code lives in `src/vite/` and the cross-module guard is a no-op
`scripts/lint-module-boundaries.ts:28,85,190-195`; 207 deep `@/vite/<feature>/<internal>` imports across 100 files
- **Pattern:** Missing Abstraction Boundary / doc-vs-reality drift
- **Problem:** `INTERNAL_ALIAS_RE` only matches `@/modules/<feature>/…`, but there are zero files under `src/modules/`; the whole web is `src/vite/`. Cross-feature reach-ins (`reservation/ReservationWizard.tsx:3` → `@/vite/bookings/api`) aren't caught, and the deprecation ratchet is count-based (delete+add nets zero). Cross-feature coupling grows with no gate. (The separate "no web DB access" rule *does* cover `vite/`.)
- **Heuristic:** A lint rule that matches a directory you don't use protects nothing.
- **Direction:** Point `INTERNAL_ALIAS_RE` at `@/vite/<feature>/` and add per-feature `index.ts` barrels so reach-ins fail CI today; or drain one feature into `src/modules/` to prove the intended path.

### M6 — `Session.user.role` typed as bare `string`; the typed-literal fix is applied at only one of several sites
`vite/session.ts:13`, `vite/guards.ts:38`, `vite/nav/Navbar.tsx:30`, `vite/operator-team/TeamView.tsx:113` vs the remedy at `vite/consent/ConsentGate.tsx:20`
- **Pattern:** Primitive Obsession / inconsistent type-safety
- **Problem:** `role: string` means `=== 'OPERATOR_OWNER'` compiles even on a typo or after a role rename. `ConsentGate.tsx` already shims this (`const RENTER_ROLE: UserRole`), but the fix wasn't pushed to the source type, so guard/nav sites stay unguarded.
- **Heuristic:** If one file needs a typed-literal shim to be safe, the field type is wrong — fix it at the source.
- **Direction:** Type `role: UserRole` in `session.ts` (the JSON value is already in the union); comparisons then check for free and the shim becomes redundant.

### M7 — `messaging.ts` is the one schema module that hides its own indexes in migrations
`packages/shared/src/db/messaging.ts:1-48` vs `drizzle/0010_add-fk-indexes.sql` and `0022_messaging-idempotency-unique-indexes.sql`
- **Pattern:** Dual Source of Truth / Schema-Migration Drift
- **Problem:** Every sibling context declares FK/unique indexes inline; `messaging.ts` declares only one, its 5 FK indexes + 2 idempotency uniques live only in hand-written SQL. The module — the documented per-context SSoT — understates the real table, and `lint:fk-indexes` can't catch it (it parses `drizzle/*.sql`). A future snapshot rebuild / `drizzle-kit pull` trusting the module would regenerate without those covering indexes → seq-scan at scale.
- **Heuristic:** The schema module must describe the table it owns — if an index lives only in a migration, the module is lying.
- **Direction:** Back-port the `.index()` + `uniqueIndex(...where IS NOT NULL)` declarations into `messaging.ts`; `db:generate` and confirm a no-op diff.

---

## LOW

### L1 — Search scaffold cloned between the two public search services
`services/flat-search.ts:77-108,228-231,306-315` vs `storefront-search.ts:101-123,155-158,247-256`
- **Pattern:** OCP / DRY. Both re-implement the same scan scaffold + byte-identical `clampLimit`/`encodeCursor`/`decodeCursor`; differ only in projection. Scan-bounding or cursor changes must be applied in lockstep.
- **Direction:** Lift the paging helpers into `services/search-paging.ts`; optionally a shared `scanAvailability(ctx, params)` both projectors consume.

### L2 — Cancellation email over-fetches four unused reads
`services/notification-dispatcher.ts:206-215` — `buildMessage` eagerly `Promise.all`s operator+vehicle+pickup+dropoff for every kind, but `RENTER_CANCELLATION` uses none of them. 4 throwaway reads per cancellation email.
- **Direction:** Move the 4-read block into the branches that consume it.

### L3 — `createApp` mixes infra-resolution policy with composition wiring
`index.ts:154-203, 575-638` (716 lines) — inlines geocoder throttle/cache assembly + payment/email/translation sentinel resolution + env parsing alongside DI wiring.
- **Direction:** Continue the `composition/repositories.ts` pattern — move the geocoder stack + gateway/email resolvers into `composition/services.ts`; leave `createApp` as middleware + `.route()`.

### L4 — Write routes duplicate the bypass-vs-operator schema selection + operatorId resolution
`routes/fee-schedules.ts:87-101`, `insurance-options.ts:81-95`, `add-ons.ts:81-95`, `locations.ts:72-86` — each `POST` repeats the same schema-pick + `resolveWriteOperatorId`. The planned class-rate-plan CRUD will copy it again.
- **Direction:** Same extraction as M3 — `parseScopedCreate(c, ctx, { operatorSchema, adminSchema }, resolveWriteOperatorId) → { data, operatorId }`.

### L5 — Consent-evidence `:id` reaches the service unvalidated
`routes/admin.ts:47-50` — `getConsentEvidence(c.req.param('id'))` skips `parseId`; breaks the "malformed input = clean 400" contract (not a leak — unknown id 404s).
- **Direction:** `const idR = parseId(c); if (!idR.ok) return idR.response`.

### L6 — `admin.ts` ships a second `requirePlatformAdmin`
`routes/admin.ts:55-64` vs `auth/guards.ts:150-154` — a local middleware re-implements the canonical guard; two same-named gates invite drift.
- **Direction:** Drop the local fn; call the canonical guard.

### L7 — `customers.ts` authorizes on a request-path string match
`routes/customers.ts:20-25` — operator carve-out is `c.req.path.endsWith('/customers/search')`. Fail-closed (low risk) but binds authz to a string; a future `/customers/search-*` route is a silent policy shift.
- **Direction:** Move the operator-allowed exception onto the `/customers/search` handler, not a prefix middleware.

### L8 — Money crosses every boundary as an unbranded `number`
`lib/commission.ts:29`, `lib/cancellation-policy.ts:46-54`, `lib/pricing.ts:87-95,104-113` — integer-yen invariant is comment-enforced; a float or yen×100 (the Stripe trap) type-checks clean. Codebase already shipped one silent-undercharge bug (#855).
- **Direction:** Accepted convention — don't churn wholesale. If you want the guard, a `Jpy` brand with a validating smart constructor at the `lib/` money signatures, propagating as call sites touch it.

### L9 — `consent-canonical.ts` pulls a Node builtin into the edge-portable shared core
`lib/consent-canonical.ts:1,66` — imports `node:crypto` (`createHash`); functions stay pure, but the subpath is now un-importable from CF Pages edge without `nodejs_compat`. Latent (consent signing is API-only today).
- **Direction:** When web needs hashing, swap to `globalThis.crypto.subtle` (already used for Stripe webhook verify); until then, a one-line "API-only subpath" note.

---

## Suggested triage

| Priority | Finding | Why now |
|---|---|---|
| **Fix next** | H1 + M2 | Real parity bug on the #464 headline feature + the test gap that let it through. One slice: fix the guard, add the `describe.each` conformance suite. |
| **High-ROI refactor** | M3 + L4 (+ M4) | Collapses a cross-tenant defence-in-depth gap and 9 copies into one service-level seam. Security-adjacent. |
| **Cheap, do opportunistically** | M6, M7, L5, L6 | Small, isolated, each a clear win (type-safety, SSoT, boundary hygiene). |
| **Deliberate, optional** | M1, M5, L1, L3, L8, L9 | Larger or accepted-convention; schedule, don't rush. |
| **Leave** | — | LSP/OCP for their own sake. The codebase already earns the structure it has. |
