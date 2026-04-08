# Schema + API Contract Design Spec

> **Goal:** Define the complete Drizzle schema and Hono API contract for Kuruma Rental — all 6 business entities, Auth.js integration, scheduling constraints, and translation model.

---

## Architecture Context

```
Browser → Next.js (Auth.js JWT cookie) → Hono API (verify JWT) → Neon Postgres
Trip.com → Hono API (verify API key) → Neon Postgres
```

- **Next.js (packages/web):** UI, SSR, i18n, Auth.js session management. No direct DB access.
- **Hono (packages/api):** All business logic, REST API. Single source of truth for data operations.
- **Shared (packages/shared):** Drizzle schema, Zod validators, TypeScript types.
- **Auth:** JWT strategy (no database sessions). Auth.js manages `users` + `accounts` tables only.
- **IDs:** UUIDv7 for all primary keys (time-ordered, B-tree friendly). Auth.js `users.id` remains `crypto.randomUUID()` (v4) as Auth.js manages that table.
- **CF Workers note:** `packages/api` must use `@neondatabase/serverless` (HTTP driver) instead of `postgres.js` (TCP) for Cloudflare Workers compatibility. Local dev and migrations can continue using `postgres.js`.

---

## Database Tables

### 1. users (Auth.js managed + app fields)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | crypto.randomUUID() (Auth.js managed) |
| email | text | unique, not null | |
| name | text | | |
| emailVerified | timestamp | | Auth.js field |
| image | text | | Auth.js field (avatar URL) |
| role | enum | not null, default 'RENTER' | RENTER, STAFF, ADMIN |
| language | text | not null, default 'en' | UI + translation target |
| country | text | | |
| createdAt | timestamptz | not null, default now() | |
| updatedAt | timestamptz | not null, default now() | |

### 2. accounts (Auth.js managed)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| userId | text | not null, FK → users.id (cascade) | |
| type | text | not null | Auth.js adapter type |
| provider | text | composite PK | e.g. "google", "apple" |
| providerAccountId | text | composite PK | Provider's user ID |
| refresh_token | text | | |
| access_token | text | | |
| expires_at | int | | |
| token_type | text | | |
| scope | text | | |
| id_token | text | | |
| session_state | text | | |

**Removed tables:** `sessions` and `verification_tokens` — not needed with JWT strategy. No server-side session storage.

### 3. vehicles

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUIDv7 |
| name | text | not null | e.g. "Toyota Prius 2022" |
| description | text | | |
| photos | text[] | | CF R2 storage URLs |
| seats | int | not null | |
| transmission | enum | not null | AUTO, MANUAL |
| fuelType | text | | |
| status | enum | not null, default 'AVAILABLE' | AVAILABLE, MAINTENANCE, RETIRED |
| bufferMinutes | int | not null, default 60 | Turnaround time between bookings |
| minRentalHours | int | | Business-configurable minimum |
| maxRentalHours | int | | Business-configurable maximum |
| advanceBookingHours | int | | How far ahead booking is required |
| createdAt | timestamptz | not null, default now() | |
| updatedAt | timestamptz | not null, default now() | |

### 4. bookings

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUIDv7 |
| idempotencyKey | text | unique | UUIDv7, prevents duplicate creation on retry |
| renterId | text | not null, FK → users.id | |
| vehicleId | text | not null, FK → vehicles.id | |
| startAt | timestamptz | not null | Stored UTC, displayed JST (UTC+9) |
| endAt | timestamptz | not null | Stored UTC, displayed JST (UTC+9) |
| effectiveEndAt | timestamptz | not null | endAt + vehicle.bufferMinutes (used in exclusion constraint) |
| status | enum | not null, default 'CONFIRMED' | CONFIRMED, ACTIVE, COMPLETED, CANCELLED |
| source | enum | not null, default 'DIRECT' | DIRECT, TRIP_COM, MANUAL, OTHER |
| externalId | text | | 3rd-party booking reference |
| notes | text | | |
| createdAt | timestamptz | not null, default now() | |
| updatedAt | timestamptz | not null, default now() | |

**Scheduling constraint (Postgres exclusion):**
```sql
EXCLUDE USING gist (
  "vehicleId" WITH =,
  tstzrange("startAt", "effectiveEndAt") WITH &&
) WHERE (status IN ('CONFIRMED', 'ACTIVE'))
```
Buffer time is baked into `effectiveEndAt` (= `endAt` + `vehicle.bufferMinutes`), so the exclusion constraint is the single source of truth for conflict prevention. No application-level race condition possible.

**Idempotency:**
- `idempotencyKey` is unique — duplicate inserts are rejected at DB level
- For DIRECT bookings: frontend generates UUIDv7 on form mount, sends with request
- For 3rd-party bookings: `(source, externalId)` unique partial index provides additional dedup

**Booking state machine:**
```
CONFIRMED → ACTIVE → COMPLETED
    ↓          ↓
  CANCELLED  CANCELLED
```

Valid transitions enforced server-side:
```typescript
const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}
```

- No PENDING state — bookings are confirmed instantly
- Cancellation policy is tiered: 72h+ free, 72-48h 30%, 48-24h 70%, same-day 100%
- Cancelling an already-cancelled booking returns success (idempotent)

### 5. threads

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUIDv7 |
| bookingId | text | FK → bookings.id, nullable, unique | Optional — DMs can exist without booking |
| renterId | text | not null, FK → users.id | |
| staffId | text | not null, FK → users.id | |
| renterUnreadCount | int | not null, default 0 | |
| staffUnreadCount | int | not null, default 0 | |
| createdAt | timestamptz | not null, default now() | |
| updatedAt | timestamptz | not null, default now() | |

**Design decisions:**
- 1:1 threads only (renter + staff). No group chat. Unread counts stored directly on the thread.
- **Unread count updates must use atomic SQL increment:** `SET "renterUnreadCount" = "renterUnreadCount" + 1`. Do NOT read-then-write in application code (lost update race condition).
- **Staff assignment:** For MVP, assign to a configurable default staff user. Document as a `DEFAULT_STAFF_ID` env var or config value. Can be extended to round-robin or per-vehicle assignment later.

### 6. messages

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUIDv7 |
| threadId | text | not null, FK → threads.id | |
| senderId | text | not null, FK → users.id | |
| content | text | not null | Original message text |
| sourceLanguage | text | | Sender's `language` preference (skip auto-detection) |
| translations | jsonb | | Cached translations keyed by language code |
| createdAt | timestamptz | not null, default now() | |

**Translation model:**
- On-demand: user clicks "Translate" button
- Cache check: look in `translations` JSONB for target language key
- Cache miss: call Google Cloud Translation API (with 3s timeout), store result in JSONB
- Translations accumulate lazily — only languages actually requested are translated
- Each user's `language` preference determines their translation target
- `sourceLanguage` is set from the sender's `language` field (no auto-detection API call on every message send)

Example `translations` field:
```json
{
  "ja": "明日午後3時に関西空港に到着します",
  "en": "I will arrive at Kansai Airport at 3pm tomorrow"
}
```

---

## Enums

| Enum | Values |
|------|--------|
| role | RENTER, STAFF, ADMIN |
| transmission | AUTO, MANUAL |
| vehicleStatus | AVAILABLE, MAINTENANCE, RETIRED |
| bookingStatus | CONFIRMED, ACTIVE, COMPLETED, CANCELLED |
| bookingSource | DIRECT, TRIP_COM, MANUAL, OTHER |

---

## Indexes

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| bookings | (vehicleId, tstzrange(startAt, effectiveEndAt)) | GiST exclusion | Prevent double-booking (includes buffer) |
| bookings | (idempotencyKey) | btree unique | Prevent duplicate bookings |
| bookings | (renterId) | btree | Renter's booking history |
| bookings | (vehicleId, status) | btree | Vehicle availability queries |
| bookings | (status) | btree | Staff dashboard: all bookings by status |
| bookings | (source, externalId) WHERE externalId IS NOT NULL | btree unique partial | 3rd-party dedup |
| messages | (threadId, createdAt) | btree | Chat history pagination |
| threads | (renterId) | btree | Renter's thread list |
| threads | (staffId) | btree | Staff's thread list |
| threads | (bookingId) WHERE bookingId IS NOT NULL | btree unique partial | One thread per booking |

---

## Hono API Routes

### Auth Middleware

Two auth strategies, applied per-route:
- **JWT middleware:** Verifies Auth.js JWT from cookie/header. Extracts `userId` and `role`. Used by web frontend. Shares `AUTH_SECRET` with Next.js for JWT verification.
- **API key middleware:** Verifies `X-API-Key` header against stored keys. Used by 3rd-party callers (Trip.com).

### Pagination (all list endpoints)

All list endpoints support cursor-based pagination:
- `limit` — max items per page (default 50, max 100)
- `cursor` — opaque cursor (UUIDv7 of last item from previous page)

Response includes:
```typescript
{
  success: true,
  data: T[],
  nextCursor: string | null  // null = no more pages
}
```

### Vehicles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/vehicles | public | List available vehicles (paginated, filterable) |
| GET | /api/vehicles/:id | public | Get vehicle detail |
| POST | /api/vehicles | JWT (STAFF, ADMIN) | Create vehicle |
| PATCH | /api/vehicles/:id | JWT (STAFF, ADMIN) | Update vehicle |
| PATCH | /api/vehicles/:id | JWT (ADMIN) | Retire vehicle (status=RETIRED) |

**GET /api/vehicles query params:**
- `limit`, `cursor` — pagination
- `seats` — minimum seats filter
- `transmission` — AUTO or MANUAL
- `availableFrom` — ISO datetime (UTC)
- `availableTo` — ISO datetime (UTC)
- `status` — filter by vehicle status (default: AVAILABLE)

**POST /api/vehicles request:**
```typescript
{
  name: string
  description?: string
  photos?: string[]
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType?: string
  bufferMinutes?: number     // default 60
  minRentalHours?: number
  maxRentalHours?: number
  advanceBookingHours?: number
}
```

**Response format (all endpoints):**
```typescript
// Success (single item)
{ success: true, data: T }

// Success (list)
{ success: true, data: T[], nextCursor: string | null }

// Error
{ success: false, error: string, code?: string }
```

### Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/bookings | JWT | List bookings (paginated, role-filtered) |
| GET | /api/bookings/:id | JWT | Get booking detail |
| POST | /api/bookings | JWT (RENTER) or API key | Create booking (instant-book) |
| PATCH | /api/bookings/:id/status | JWT (STAFF, ADMIN) | Update status (validated transitions only) |
| POST | /api/bookings/:id/cancel | JWT | Cancel booking (idempotent, tiered fee) |

**GET /api/bookings query params:**
- `limit`, `cursor` — pagination
- `vehicleId` — filter by vehicle
- `status` — filter by status
- `from` / `to` — date range filter
- `source` — filter by booking source

**POST /api/bookings request:**
```typescript
{
  idempotencyKey: string     // UUIDv7, generated by client
  vehicleId: string
  startAt: string            // ISO datetime (UTC)
  endAt: string              // ISO datetime (UTC)
  notes?: string
  source?: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'  // default DIRECT
  externalId?: string        // required if source != DIRECT
}
```

**Booking creation logic (wrapped in DB transaction):**
1. Validate input (Zod — startAt < endAt, externalId required for non-DIRECT)
2. Check idempotencyKey — if booking exists with same key, return existing booking
3. Check vehicle exists and status = AVAILABLE
4. Check rental duration meets min/max hours
5. Check advance booking requirement
6. Compute `effectiveEndAt` = endAt + vehicle.bufferMinutes
7. Insert with status = CONFIRMED (exclusion constraint is the final guard)
8. Auto-create DM thread linking renter + default staff
9. Return booking

Steps 2-8 are wrapped in a single database transaction. If thread creation (step 8) fails, the booking insert rolls back.

### Availability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/availability | public | Check which vehicles are available for a time range |
| GET | /api/availability/:vehicleId | public | Check if a specific vehicle is available |

**GET /api/availability query params:**
- `from` — ISO datetime (UTC), required
- `to` — ISO datetime (UTC), required
- `seats` — minimum seats filter
- `transmission` — AUTO or MANUAL

**Availability query pattern:**
```sql
SELECT v.* FROM vehicles v
WHERE v.status = 'AVAILABLE'
AND NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b."vehicleId" = v.id
  AND b.status IN ('CONFIRMED', 'ACTIVE')
  AND tstzrange(b."startAt", b."effectiveEndAt")
    && tstzrange($from, $to)
)
```

### Threads + Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/threads | JWT | List user's threads (paginated, with last message + unread count) |
| GET | /api/threads/:id | JWT | Get thread detail |
| POST | /api/threads | JWT | Create thread (renter or staff initiates) |
| GET | /api/threads/:id/messages | JWT | List messages (paginated, cursor-based, oldest first) |
| POST | /api/threads/:id/messages | JWT | Send message |
| POST | /api/messages/:id/translate | JWT | Translate message to user's language |
| PATCH | /api/threads/:id/read | JWT | Mark thread as read (reset unread count to 0) |

**POST /api/threads/:id/messages request:**
```typescript
{
  content: string
}
```

**Message creation logic:**
1. Validate sender is a participant (renterId or staffId on thread)
2. Insert message with `senderId`, set `sourceLanguage` from sender's `language` field
3. Atomically increment the other participant's unread count (SQL: `SET "xxxUnreadCount" = "xxxUnreadCount" + 1`)
4. Return message

**POST /api/messages/:id/translate response:**
```typescript
{
  success: true,
  data: {
    translation: string,
    targetLanguage: string
  }
}
```

**Translation logic:**
1. Check `translations` JSONB for user's language key
2. Cache hit → return cached translation
3. Cache miss → call Google Cloud Translation API (3s timeout)
4. Store result in `translations` JSONB
5. Return translation

### 3rd-Party Integration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/bookings | API key | Create booking (same endpoint, different auth) |
| GET | /api/bookings/:id | API key | Check booking status |
| POST | /api/bookings/:id/cancel | API key | Cancel booking |

3rd-party callers use the same booking endpoints but authenticate via `X-API-Key` header instead of JWT. The `source` field tracks which platform created the booking. The `(source, externalId)` unique partial index prevents duplicate external bookings.

---

## Zod Validators (packages/shared)

```typescript
// vehicles
const createVehicleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  photos: z.array(z.string().url()).optional(),
  seats: z.number().int().min(1),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().optional(),
  bufferMinutes: z.number().int().min(0).default(60),
  minRentalHours: z.number().int().min(1).optional(),
  maxRentalHours: z.number().int().min(1).optional(),
  advanceBookingHours: z.number().int().min(0).optional(),
})
const updateVehicleSchema = createVehicleSchema.partial()

// bookings
const createBookingSchema = z.object({
  idempotencyKey: z.string().uuid(),
  vehicleId: z.string().uuid(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().optional(),
  source: z.enum(['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER']).default('DIRECT'),
  externalId: z.string().optional(),
}).refine(d => new Date(d.startAt) < new Date(d.endAt), {
  message: 'startAt must be before endAt',
}).refine(d => new Date(d.startAt) > new Date(), {
  message: 'startAt must be in the future',
}).refine(d => d.source === 'DIRECT' || d.externalId, {
  message: 'externalId required for non-DIRECT bookings',
})

const updateBookingStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED']),
})

const cancelBookingSchema = z.object({
  reason: z.string().optional(),
})

// threads
const createThreadSchema = z.object({
  bookingId: z.string().uuid().optional(),
  renterId: z.string().uuid(),
  staffId: z.string().uuid(),
})

// messages
const createMessageSchema = z.object({
  content: z.string().min(1).max(5000),
})
const translateMessageSchema = z.object({
  targetLanguage: z.string().min(2).max(5),
})

// availability
const availabilityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  seats: z.number().int().min(1).optional(),
  transmission: z.enum(['AUTO', 'MANUAL']).optional(),
}).refine(d => new Date(d.from) < new Date(d.to), {
  message: 'from must be before to',
})

// pagination (reusable)
const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
})
```

---

## Design Decisions Summary

| Decision | Choice | Why |
|----------|--------|-----|
| Auth strategy | JWT (no sessions table) | Stateless CF Workers, no DB lookup per request |
| Thread model | 1:1 (renterId + staffId on thread) | Matches real workflow, simpler schema |
| Message storage | Postgres + JSONB translations | Low volume (200-2000 users), relational joins needed |
| Translation | On-demand, cached in JSONB per language | Only translate what's read, accumulate lazily |
| Source language | Sender's `language` preference (no auto-detection) | Avoids external API call on every message send |
| Booking flow | Instant-book, no approval | Owner never rejects bookings, approval adds friction |
| Scheduling | Hourly (timestamptz), exclusion constraint | Owner needs flexible time-based scheduling |
| Double-booking prevention | DB-level exclusion constraint on `effectiveEndAt` | ACID guarantee, buffer baked in, no app-level race |
| Buffer time | Stored in `effectiveEndAt`, used in constraint | Eliminates check-then-act race condition |
| Idempotency | `idempotencyKey` column (UUIDv7) + unique constraint | Prevents duplicate bookings on retry, audit trail |
| External dedup | Unique partial index on `(source, externalId)` | Prevents Trip.com webhook double-sends |
| IDs | UUIDv7 (time-ordered) | B-tree friendly, no index fragmentation |
| Timestamps | UTC storage, JST display | Japan has no DST, conversion is always +9 |
| API response format | `{ success, data }` / `{ success, error }` | Consistent, type-safe with discriminated union |
| Pagination | Cursor-based (UUIDv7 cursor) | Works with lazy loading, no offset performance issue |
| Soft delete | Status enum (RETIRED/CANCELLED) | Preserve referential integrity, audit trail |
| Booking creation | Wrapped in DB transaction (steps 2-8) | Atomic: booking + thread created together or not at all |
| Unread counts | Atomic SQL increment | Prevents lost update race condition |
| Staff assignment | Configurable default (DEFAULT_STAFF_ID) | Simple for MVP, extensible later |
| CF Workers DB driver | `@neondatabase/serverless` for api package | `postgres.js` uses TCP, CF Workers require HTTP |

---

## Architect Review Resolutions

Issues identified and resolved from the architect review (2026-04-07):

| Priority | Issue | Resolution |
|----------|-------|------------|
| CRITICAL | `postgres.js` incompatible with CF Workers | Noted: switch to `@neondatabase/serverless` in packages/api (deferred to deployment) |
| CRITICAL | Buffer time race condition (check-then-act) | Added `effectiveEndAt` column, baked into exclusion constraint |
| CRITICAL | No idempotency on booking creation | Added `idempotencyKey` column + unique constraint |
| CRITICAL | Unbounded list responses | Added cursor-based pagination to all list endpoints |
| CRITICAL | Spec vs DBML thread model divergence | Unified: flat columns on threads (no join table) |
| MEDIUM | Booking creation not transactional | Wrapped steps 2-8 in DB transaction |
| MEDIUM | Unread count lost update race | Specified atomic SQL increment |
| MEDIUM | Status transitions not validated | Added VALID_TRANSITIONS map |
| MEDIUM | Staff assignment undefined | Added DEFAULT_STAFF_ID config approach |
| MEDIUM | (source, externalId) not unique | Added unique partial index |
| MEDIUM | Missing standalone index on bookings.status | Added standalone btree index |
| MEDIUM | Zod validators incomplete | Fully specified all validators with cross-field refinements |
| MEDIUM | Language detection on every message | Use sender's language preference instead |
| MEDIUM | Translation endpoint needs timeout | Specified 3s timeout for Google API |

---

*Created: 2026-04-07*
*Updated: 2026-04-07 — architect review fixes applied*
