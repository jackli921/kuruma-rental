# Booking-Write Authorization Model

Canonical rules for who may invoke each booking endpoint, and why the gates are
**not uniform**. The booking routes carry a deliberate asymmetry — the read-feed
and status routes admit platform staff, but `/substitute` is operator-only. This
doc records the intent (#647) so a later reader does not "harmonize" the gates
into one set and silently change behavior.

The route gate is **not** the tenant boundary. Every booking query is row-scoped
by `CallerContext` in the repository (#386 F2 / #397): an operator only ever sees
or mutates its own tenant's bookings, a renter only its own. The gates below are
correct-actor semantics plus defense-in-depth on top of that scoping — never the
thing that stops a cross-tenant read.

## Role sets

Defined in `packages/api/src/middleware/auth.ts`:

| Set | Members |
|-----|---------|
| `isOperatorRole` (`OPERATOR_ROLES`) | `OPERATOR_OWNER`, `OPERATOR_STAFF` |
| `STAFF_ROLES` | `STAFF`, `ADMIN`, `PLATFORM_ADMIN` |
| `MANAGEMENT_READ_ROLES` | `STAFF_ROLES` ∪ operators — everything except `RENTER` and `PARTNER` |

`RENTER` is the customer. `PARTNER` is a 3rd-party API caller (Trip.com).

## The map

| Route | Enforced at | Gate | Rationale |
|-------|-------------|------|-----------|
| `POST /bookings` | route (PARTNER 403) | any authed user **except PARTNER** (books for self) | Instant-book. Only `STAFF_ROLES` may set `renterId` / `source=MANUAL` (on-behalf). Operators are excluded from on-behalf: `UserRepository` is not tenant-scoped, so letting an operator resolve an arbitrary `renterId` reopens the #396 cross-tenant user-enumeration vector. A `RENTER` must accept the liability disclaimer (#613). #1440: a `PARTNER` is rejected 403 at the route — a channel books through its integration, not this manual-create endpoint; the previous pass-through was only *accidentally* safe (its synthetic `partner:api-key` renterId FK-fails), so the exclusion is now explicit (see PARTNER section). |
| `PATCH /:id/status` | route + service | `MANAGEMENT_READ_ROLES`, then operator-bound | Lifecycle advance (`CONFIRMED → ACTIVE → COMPLETED`) is a physical pickup/return event — operational, so platform support is admitted alongside operators. Row-scoping alone would let a renter self-advance via the raw API and skew dashboards / settlement (#643). #1260: a bypass admin (`bookingReadScope = all`) reads every tenant's bookings, so the service binds the write to the operator it picked via `?operatorId=` — unbound → 422 `OPERATOR_REQUIRED`, non-owning → 404 (no oracle). Tenant operators are clamped by read scope and ignore it. |
| `POST /:id/cancel` | route (PARTNER 403) + service | renter (own) + operator + bypass-admin operator-bound; PARTNER excluded | Tiered cancellation (72h / 48h / 24h / same-day) is a renter-facing feature, so there is **no management route gate**; the service authorizes renter-own and operator-tenant. #1260: because there is no management gate, a bypass admin could otherwise cancel ANY tenant's booking by raw id (a refund-moving cross-tenant write), so it must bind to the operator it picked via `?operatorId=` — same 422/404 contract as `/status`. Renters (renter scope) and operators (tenant scope) are already clamped by `findById`, so they need no `operatorId`. #1367: a PARTNER's `partner` read scope resolves any `source=TRIP_COM` booking across operators, which the operator-binding guard cannot clamp (a channel is not one operator), so the PARTNER is rejected 403 at the route — cancelling is *managing the order*, which a channel does not do (see PARTNER section). |
| `POST /:id/substitute` | route | `isOperatorRole` | Choosing which car serves a booking is a **fleet-ownership** decision, named to the operator in the marketplace proposal (§321 / §345). There is no admin substitute UI and the audit `actorId` assumes an operator, so platform staff are deliberately excluded. |
| `GET /:id/substitution-candidates` | route | `isOperatorRole` | Feeds the substitute write only — inherits its gate (see below). |
| `GET /:id/events` | route | `MANAGEMENT_READ_ROLES` | The lifecycle log exposes `actorId`, internal vehicle ids and substitution reasons. No renter UI consumes a timeline, so renters are rejected (403) rather than served a sanitized projection (§549). |

## Two principles

**A feeder-read inherits its write's gate.** `GET /:id/substitution-candidates`
exists solely to populate the operator's substitute dialog. It is gated
`isOperatorRole`, identically to the `POST /:id/substitute` it feeds — never
looser. When you add a read that exists only to drive one write, gate it like
the write.

**The status/substitute asymmetry is intentional.** `/status` admits
`MANAGEMENT_READ_ROLES` while the more-destructive `/substitute` is
`isOperatorRole`-only. This is not an oversight. The two gates encode different
concerns: status advance is *operational* (support coordinates pickup / return,
so platform staff are in); substitution is *fleet ownership* (only the operator
that owns the car decides, so platform staff are out). Operators are in both
sets — the only difference is whether platform staff are admitted, and that
tracks operational-support vs. ownership, not "how destructive." Do not collapse
the two onto one set.

## PARTNER (Trip.com)

`PARTNER` is a 3rd-party booking channel: it does not manage orders or read
internal lifecycle data, so it is excluded from `POST /bookings`, `/status`,
`/cancel`, `/substitute`, `/substitution-candidates`, and `/events`. `/status`,
`/substitute`, `/substitution-candidates`, and `/events` enforce this through
their `MANAGEMENT_READ_ROLES` / `isOperatorRole` gates. Two routes have **no
management gate** (they serve renter self-service), so each rejects a PARTNER with
an explicit 403:

- `POST /bookings` (#1440) — renters self-book, so the route admits any authed
  user. A PARTNER's create was only *accidentally* safe: `resolveBookingActor`
  forces its synthetic `partner:api-key` id as `renterId` (no user row → renter FK
  fails) and the inventory bind passes partners through (`bookingReadScope =
  partner`, never `all`). The route 403 makes the exclusion designed rather than an
  FK accident. A partner-initiated create is a future channel integration, not this
  endpoint.
- `POST /:id/cancel` (#1367) — otherwise a PARTNER's cross-operator `partner` read
  scope would let it cancel any `TRIP_COM`-sourced booking (a channel is not one
  operator, so the operator-binding guard cannot clamp it).

## Cross-tenant references resolve to the caller's own not-found (#1440)

When a write names inventory (a vehicle, a pickup location, a booking) the caller
cannot see, the refusal must be **indistinguishable from a genuinely unknown id** —
never a distinct 403 that confirms "this exists, but not for you" (an existence
oracle). How the booking-create path (`packages/api/src/services/booking-creation.ts`,
`submitInTx`) enforces it:

- **The anchor read is caller-scoped (#1417 / #1439).** The requested vehicle is
  read with the caller's own `ctx` (`vehicleRepo.findById(ctx, …)`), so
  `operatorReadScope` clamps a tenant operator to its own fleet: a foreign car
  returns `undefined` → a plain `400 'Vehicle not found'`, identical to a truly
  unknown id. The marketplace tiers (renter, PARTNER, bypass admin) resolve `all` and
  read any public vehicle, unchanged.
- **The bypass `all` tier binds to a named operator — still no oracle.** A platform
  admin reads every tenant's inventory, so it must name the operator it acts as via
  `?operatorId=` (#1260). Only that `all` reader is bound:
  `assertBookingWriteWithinOperator` short-circuits to `null` for every non-`all`
  caller, and `fleetWriteDenialResult` maps a non-owning pick to **404**
  `not-in-scope` (the caller's own not-found) and an absent pick to **422**
  `OPERATOR_REQUIRED`. Renters and operators are already clamped by the read scope;
  a PARTNER never reaches here (route 403, above).

There is **no 403 existence oracle** in the inventory path: a cross-tenant vehicle
reference is always a not-found (`400`/`404`), never a distinguishable "forbidden".
#1439 removed the earlier explicit-403 branch by moving the clamp into the
`ctx`-scoped anchor read. (The only 403 in create is a different axis — a manual
booker naming a `renterId` outside its own customer scope, `booking-creation.ts`
`assertRenterWithinScope` — not an inventory reference.) Do not reintroduce a
403 for an unreachable-inventory reference: it hands an attacker an id-enumeration
oracle. Cross-ref `operatorReadScope`, `assertBookingWriteWithinOperator`, and
`fleetWriteDenialResult` in `tenancy.ts`.

## Why `/substitute` and `/assign` carry no service-level operator bind (#1440)

`/status` and `/cancel` bind the write to the picked operator at the *service*
(the #1260 `assertBookingWriteWithinOperator` guard) because they admit the
bypass-admin `all` reader, which `findById` hands every tenant's booking. `POST
/:id/substitute` and `POST /:id/assign` do **not** need that bind: both are gated
`isOperatorRole` at the route, so the only callers are tenant-scoped operators that
`findById` already clamps to their own fleet (foreign id → 404, no oracle). There
is no `all`-scope caller to bind, so the single route seal is sufficient. If a
future change admits platform staff (an `all` reader) to either route, add the
service-level operator-bind then — the route gate alone would no longer clamp them.
