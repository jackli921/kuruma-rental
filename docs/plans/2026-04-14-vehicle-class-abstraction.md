# Vehicle Class Abstraction — Design Spec

> **Goal:** Decouple the renter-facing catalog from the owner's physical fleet by introducing a Vehicle Class layer. Renters browse and book *classes* (e.g. "Compact — 5 seats"); the owner manages individual cars tagged to those classes. Inspired by NicoNico Rent-a-Car's catalog model.

---

## Problem

Today, renters browse individual vehicles and book a specific car. This creates several issues:

1. **Renter friction** — tourists don't care which exact Toyota Aqua they get; they care about size, seats, and luggage capacity.
2. **Owner inflexibility** — if a booked car goes into maintenance, the booking is stuck. The owner can't swap in another car of the same type without cancelling/rebooking.
3. **Catalog mismatch** — the owner wants a clean public page like NicoNico (browse by class), not a list of 40 individual cars.
4. **3rd-party integration** — Trip.com and similar aggregators list by vehicle *category*, not by VIN.

## Solution

Introduce `vehicle_classes` as the renter-facing interface. Individual `vehicles` become the concrete implementations, tagged with a `classId`. Bookings are placed against a class; a specific vehicle is assigned later.

```
Renter → books a Class (interface)
Owner  → assigns a Vehicle (implementation) before pickup
```

---

## Schema Changes

### New table: `vehicle_classes`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUIDv7 |
| name | text | not null | e.g. "Compact", "SUV", "K-Car" |
| slug | text | unique, not null | URL-friendly: "compact", "suv" |
| description | text | | Renter-facing prose (i18n key or raw text TBD) |
| photos | text[] | not null, default '{}' | Representative class photos (not a specific car) |
| seats | integer | not null | Passenger capacity |
| luggageCapacity | integer | not null | Number of standard suitcases |
| transmission | transmission enum | not null | AUTO or MANUAL |
| fuelType | text | | Petrol, Hybrid, EV, etc. |
| dailyRateJpy | integer | | Whole JPY, class-level pricing |
| hourlyRateJpy | integer | | Whole JPY |
| sortOrder | integer | not null, default 0 | Display order on catalog page |
| status | text | not null, default 'ACTIVE' | ACTIVE or ARCHIVED |
| createdAt | timestamptz | not null, default now() | |
| updatedAt | timestamptz | not null, default now() | |

**CHECK:** at least one rate must be set (same pattern as current `vehicles` table).

### Changes to `vehicles`

| Change | Detail |
|--------|--------|
| Add `classId` | text, FK → vehicle_classes.id, **not null** |
| Keep all existing columns | licensePlate, make, model, year, color, shaken, insurance, status, bufferMinutes, etc. |
| Pricing columns become optional override | If null, inherit from class. If set, override class rate for this specific car. |
| `seats`, `transmission` stay | Denormalized for fleet management; class values are the renter-facing source of truth. |

The vehicle retains its own `name` (e.g. "Aqua 3-456") for owner identification. The renter never sees this.

### Changes to `bookings`

| Change | Detail |
|--------|--------|
| Add `classId` | text, FK → vehicle_classes.id, **not null** — what the renter chose |
| `vehicleId` becomes nullable | null = class booked, car not yet assigned |
| `totalPrice` computed from class rate | Unless vehicle has an override rate |

**State flow:**
```
Renter books "Compact" for Apr 20-22
  → booking created: classId=Compact, vehicleId=NULL, status=CONFIRMED

Owner assigns Aqua (or system auto-assigns)
  → booking updated: vehicleId=aqua-uuid

Pickup day
  → booking transitions: status=ACTIVE, specific car handed over
```

---

## Availability Logic

**Current:** "Is vehicle X free for these dates?"

**New:** "How many vehicles in class Y are free for these dates?"

```sql
-- Count of vehicles in the class
-- minus vehicles with overlapping non-CANCELLED bookings
-- minus vehicles in MAINTENANCE or RETIRED status
-- = available count for the class
```

A class is bookable if available count > 0. The renter never sees which specific cars are free.

### Auto-assignment strategy

When a booking is confirmed, the system can optionally auto-assign a vehicle:

1. Query all AVAILABLE vehicles in the class
2. Exclude vehicles with overlapping bookings (using existing exclusion constraint logic)
3. Pick one (round-robin, least-recently-used, or random)
4. Set `vehicleId` on the booking

The owner can always manually reassign before pickup. Auto-assignment is a convenience, not a requirement for MVP.

---

## Migration Path

This is **additive** — no destructive changes to existing data.

### Phase 1: Schema
1. Create `vehicle_classes` table
2. Add `classId` column to `vehicles` (nullable initially for migration)
3. Add `classId` column to `bookings` (nullable initially)
4. Backfill: create classes from existing vehicle data, assign classIds
5. Make `classId` not-null on both tables after backfill
6. Make `bookings.vehicleId` nullable

### Phase 2: API
1. New CRUD routes for vehicle classes (`/api/vehicle-classes`)
2. Update vehicle routes to include classId
3. Update booking creation to accept classId instead of vehicleId
4. Add availability endpoint per class
5. Update fleet overview to group by class

### Phase 3: Web (renter-facing)
1. New catalog page: browse by vehicle class (like NicoNico)
2. Booking flow: select class → pick dates → confirm
3. Remove individual vehicle browsing for renters

### Phase 4: Web (owner-facing)
1. Vehicle class management UI (CRUD)
2. Fleet view: group vehicles by class, show class-level stats
3. Booking detail: vehicle assignment UI (dropdown of available cars in class)

---

## What Stays the Same

- Owner's fleet management (individual cars, maintenance, status)
- Booking lifecycle (CONFIRMED → ACTIVE → COMPLETED / CANCELLED)
- Exclusion constraint for double-booking (still per-vehicle)
- 3rd-party booking flow (now easier — they book by class, which is how aggregators work)
- Auth, messaging, maintenance logs — untouched

---

## Open Questions

1. **Pricing:** Class-level only, or per-vehicle overrides? (Proposed: class-level default, per-vehicle optional override)
2. **i18n for class descriptions:** Use next-intl namespace keys, or store translated text in DB?
3. **Auto-assignment timing:** At booking time, or deferred to owner? (Proposed: deferred for MVP, auto-assign as enhancement)
4. **Existing bookings migration:** Backfill classId from vehicle's class, keep vehicleId as-is (already assigned)
5. **Buffer minutes:** Class-level or vehicle-level? (Proposed: keep per-vehicle, as physical cars have different turnaround needs)
