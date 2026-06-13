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
| `POST /bookings` | route | any authed user (books for self) | Instant-book. Only `STAFF_ROLES` may set `renterId` / `source=MANUAL` (on-behalf). Operators are excluded from on-behalf: `UserRepository` is not tenant-scoped, so letting an operator resolve an arbitrary `renterId` reopens the #396 cross-tenant user-enumeration vector. A `RENTER` must accept the liability disclaimer (#613). |
| `PATCH /:id/status` | route | `MANAGEMENT_READ_ROLES` | Lifecycle advance (`CONFIRMED → ACTIVE → COMPLETED`) is a physical pickup/return event — operational, so platform support (STAFF/ADMIN) is admitted alongside operators. Row-scoping alone would let a renter self-advance via the raw API and skew dashboards / settlement (#643). |
| `POST /:id/cancel` | service | renter (own) + management | Tiered cancellation (72h / 48h / 24h / same-day) is a renter-facing feature, so there is no route gate; the service authorizes renter-own plus management. |
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

`PARTNER` can `POST /bookings` (it is a booking source) but is excluded from
`/status`, `/substitute`, `/substitution-candidates`, and `/events`: a 3rd-party
caller books, it does not manage the order or read internal lifecycle data.
