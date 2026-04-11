# Kuruma Rental Platform - MVP Design Spec

> Airbnb-style car rental platform for a Japan-based car rental company serving international tourists

## Business Context

| Attribute | Value |
|-----------|-------|
| Location | Japan only (Osaka) |
| Vehicles | 40-50 currently |
| Users | 200+ now, scaling to 2000+ (international tourists) |
| User types | Renters (international tourists) + Business (staff/admin, speak JP/ZH) |
| Current system | Excel spreadsheets + manual WhatsApp/WeChat/Line contact |
| Booking sources | Direct + 3rd-party platforms (e.g. Trip.com) |
| Model | Single-tenant, but structured for white-label reuse |

---

## Tech Stack

### Architecture: Monorepo with API/Web split

```
kuruma-rental/
├── packages/
│   ├── api/            ← Hono (all business logic + REST API)
│   │                     Deploys to CF Workers
│   ├── web/            ← Next.js (tourist UI, staff dashboard, i18n)
│   │                     Deploys to CF Pages
│   └── shared/         ← Drizzle schema, Zod schemas, shared types
│                         Used by both api and web
├── package.json        ← Bun workspace root
└── turbo.json          ← (optional) Turborepo for build orchestration
```

**Why this split:**
- Hono API is source-agnostic — serves the web app, Trip.com, future mobile app, all through the same endpoints
- Next.js does what it's best at: SSR, i18n, React component rendering
- Shared package prevents schema/type drift between API and web
- Both deploy natively to Cloudflare (no compatibility layers)
- Next.js frontend calls Hono API via `hono/client` for end-to-end type safety

### Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| API framework | Hono | Native CF Workers, typed client, middleware-first |
| Frontend | Next.js App Router | SSR for SEO, i18n, React ecosystem (calendar, shadcn) |
| Database | Neon Postgres | Managed, branching for dev/PR environments |
| ORM | Drizzle | Edge/CF Workers compatible, type-safe, lightweight |
| Auth | Auth.js (NextAuth v5) | Email/password + Google + Apple OAuth, Drizzle adapter |
| Storage | Cloudflare R2 (or Supabase Storage) | Vehicle photos/videos |
| Translation | Google Cloud Translation | Widest N-to-N language coverage |
| UI | Tailwind + shadcn/ui | Fast, consistent design system |
| Validation | Zod | Runtime + TypeScript type inference, shared between API and web |
| Linting | Biome | Replaces ESLint + Prettier, 100x faster (Rust-based) |
| i18n | next-intl | Proven in pre-auth-v1 |
| Deployment | Cloudflare Workers + Pages | $5/mo vs Vercel $100+/mo at scale |
| Connection pooling | Cloudflare Hyperdrive | Prevents connection exhaustion from serverless |
| Package manager | Bun | Workspaces, fast installs, native TS execution |

**Division of responsibility:**
- **Hono (packages/api)**: All business logic — bookings, vehicles, availability, messages, translation. Single source of truth for data operations. Authenticates 3rd-party API callers.
- **Next.js (packages/web)**: UI rendering, SSR, i18n, Auth.js session management. Calls Hono API for all data operations (no direct DB access from Next.js).
- **Shared (packages/shared)**: Drizzle schema, Zod validation schemas, TypeScript types, constants. Imported by both api and web.
- **Neon Postgres**: Single database, accessed only through Hono API (and Drizzle migrations)
- **Hyperdrive**: Connection pooling between CF Workers and Neon Postgres

**Cloudflare-specific patterns:**
- Hono on CF Workers: native, no compatibility layer needed
- Next.js on CF Pages: via `@opennextjs/cloudflare`
- Env vars accessed via Hono `c.env` bindings (API) and `getCloudflareContext().env` (web)
- Hyperdrive for connection pooling to Neon

---

## Data Model

### User
| Field | Type | Notes |
|-------|------|-------|
| id | string (uuid) | Primary key (Auth.js managed) |
| email | string | Unique |
| name | string | |
| emailVerified | datetime? | Auth.js field |
| image | string? | Auth.js field (avatar) |
| role | enum | RENTER, STAFF, ADMIN |
| language | string | Preferred language (UI + translation target) |
| country | string? | |
| createdAt | datetime | |
| updatedAt | datetime | |

Auth.js also manages `accounts`, `sessions`, and `verificationTokens` tables (see Auth.js migration plan).

### Vehicle
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| name | string | e.g. "Toyota Prius 2022" |
| description | string | |
| photos | string[] | Storage URLs (CF R2 or Supabase Storage) |
| seats | int | |
| transmission | enum | AUTO, MANUAL |
| fuelType | string | |
| status | enum | AVAILABLE, MAINTENANCE, RETIRED |
| bufferMinutes | int | Turnaround time between bookings (default 60) |
| minRentalHours | int? | Business-configurable minimum rental duration |
| maxRentalHours | int? | Business-configurable maximum rental duration |
| advanceBookingHours | int? | How far ahead booking is required |
| createdAt | datetime | |
| updatedAt | datetime | |

### Booking
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| renterId | string | -> User |
| vehicleId | string | -> Vehicle |
| startAt | timestamptz | Stored UTC, displayed JST (Asia/Tokyo) |
| endAt | timestamptz | Stored UTC, displayed JST (Asia/Tokyo) |
| status | enum | CONFIRMED -> ACTIVE -> COMPLETED (or CANCELLED) |
| source | enum | DIRECT, TRIP_COM, MANUAL, OTHER |
| externalId | string? | Booking reference from 3rd-party platform |
| notes | string? | |
| createdAt | datetime | |
| updatedAt | datetime | |

**Scheduling constraints (enforced at DB level):**
- Postgres exclusion constraint: `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('CONFIRMED', 'ACTIVE'))` — prevents double-booking
- Buffer time between bookings is vehicle-specific (`bufferMinutes`), enforced at application level during availability checks
- All times stored as UTC; Japan (JST, UTC+9) has no DST, simplifying conversion

**Cancellation policy (from owner):**
- 72h+ before pickup: free cancellation
- 72-48h: 30% charge
- 48-24h: 70% charge
- Same-day: 100% charge

### Thread
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| bookingId | string? | -> Booking (optional, DMs can exist without booking) |
| createdAt | datetime | |
| updatedAt | datetime | |

### ThreadParticipant
| Field | Type | Notes |
|-------|------|-------|
| threadId | string | -> Thread |
| userId | string | -> User |
| unreadCount | int | Per-participant unread tracking |

### Message
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| threadId | string | -> Thread |
| senderId | string | -> User |
| content | string | Original text |
| sourceLanguage | string | Auto-detected by Google Cloud Translation |
| translations | JSON | Cached translations keyed by language code |
| createdAt | datetime | |

---

## User Flows

### Renter Flow
1. Lands on public site
2. Browses vehicles (public, no auth required)
3. Signs up (email/Google/Apple)
4. Picks dates/times first -> sees available cars for that period
5. Views car detail (photos, specs, rules)
6. Books instantly -> slot locked, status = CONFIRMED
7. DM thread auto-created, renter notified with confirmation
8. Shop contacts renter to confirm logistics (flight number, pickup details)
9. Manages booking (view status, cancel with tiered policy, message business)

### Business Flow
1. Logs in (staff or admin)
2. Sees dashboard: Google Calendar-style view with week/day toggle (primary), month (overview)
3. Each vehicle is a separate "calendar" (toggle on/off in sidebar)
4. Bookings appear as color-coded time blocks (green=confirmed, blue=active, gray=completed, red=cancelled)
5. Buffer time between bookings shown as hatched/dimmed blocks
6. Click event -> booking detail (view/cancel/message)
7. New bookings appear automatically (from direct or 3rd-party sources)
8. Marks booking as active (car picked up) and completed (car returned)
9. Can manually create bookings (source=MANUAL) or block time for maintenance
10. Manages fleet: add/edit/remove vehicles, upload photos/videos, set rules + buffer time
11. Views customer list (name, country, booking history)
12. Communicates with renters via DM with translation

### Messaging Flow
1. Either party opens thread
2. Types message in their own language
3. Message saved with detected source language
4. Other party sees original text + "Translate" button
5. Click translate: checks cached translations -> cache miss calls Google Cloud Translation -> stores result
6. Subsequent views of same translation load from cache

---

## Project Structure

```
kuruma-rental/
├── packages/
│   ├── shared/                        # Shared code (imported by api + web)
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle schema (all tables)
│   │   │   │   └── index.ts           # DB connection factory
│   │   │   ├── validators/            # Zod schemas for all entities
│   │   │   │   ├── booking.ts
│   │   │   │   ├── vehicle.ts
│   │   │   │   └── auth.ts
│   │   │   └── types/                 # Shared TypeScript types
│   │   │       └── index.ts
│   │   └── package.json
│   │
│   ├── api/                           # Hono API (deploys to CF Workers)
│   │   ├── src/
│   │   │   ├── index.ts               # Hono app entry point
│   │   │   ├── routes/
│   │   │   │   ├── bookings.ts        # CRUD + availability
│   │   │   │   ├── vehicles.ts        # CRUD + search
│   │   │   │   ├── messages.ts        # Threads + messages
│   │   │   │   └── translate.ts       # Translation endpoint
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts            # Session validation (verify Auth.js JWT)
│   │   │   │   └── apiKey.ts          # 3rd-party API key auth
│   │   │   └── services/              # Business logic layer
│   │   │       ├── booking.ts
│   │   │       ├── vehicle.ts
│   │   │       └── availability.ts
│   │   ├── wrangler.toml              # CF Workers config
│   │   └── package.json
│   │
│   └── web/                           # Next.js frontend (deploys to CF Pages)
│       ├── src/
│       │   ├── app/
│       │   │   ├── [locale]/
│       │   │   │   ├── page.tsx                # Public landing page
│       │   │   │   ├── vehicles/
│       │   │   │   │   ├── page.tsx             # Date-first car browsing (public)
│       │   │   │   │   └── [id]/page.tsx        # Car detail (public)
│       │   │   │   ├── (auth)/
│       │   │   │   │   ├── login/page.tsx
│       │   │   │   │   └── register/page.tsx
│       │   │   │   ├── (renter)/                # Protected - renter role
│       │   │   │   │   ├── bookings/page.tsx
│       │   │   │   │   ├── bookings/[id]/page.tsx
│       │   │   │   │   ├── messages/page.tsx
│       │   │   │   │   └── messages/[threadId]/page.tsx
│       │   │   │   └── (business)/              # Protected - staff/admin role
│       │   │   │       ├── dashboard/page.tsx    # Calendar overview
│       │   │   │       ├── bookings/page.tsx
│       │   │   │       ├── bookings/[id]/page.tsx
│       │   │   │       ├── vehicles/page.tsx
│       │   │   │       ├── vehicles/new/page.tsx
│       │   │   │       ├── vehicles/[id]/edit/page.tsx
│       │   │   │       ├── messages/page.tsx
│       │   │   │       ├── messages/[threadId]/page.tsx
│       │   │   │       └── customers/page.tsx
│       │   │   └── api/auth/
│       │   │       └── [...nextauth]/route.ts   # Auth.js handler
│       │   ├── lib/
│       │   │   └── api-client.ts                # Typed Hono client (hono/client)
│       │   ├── auth.ts                          # Auth.js config
│       │   ├── auth.config.ts                   # Auth.js edge config
│       │   └── middleware.ts                    # next-intl + Auth.js
│       ├── messages/                            # i18n JSON files (en, ja, zh)
│       └── package.json
│
├── drizzle.config.ts                  # Drizzle migration config
├── biome.json                         # Biome linter/formatter config
├── package.json                       # Bun workspace root
└── turbo.json                         # (optional) build orchestration
```

**Key boundaries:**
- `packages/web` has NO direct database access — all data flows through the Hono API
- `packages/api` has NO UI rendering — it's a pure REST API
- `packages/shared` has NO runtime dependencies on either api or web
- Auth.js lives in `web` (manages sessions), but the API verifies Auth.js JWTs independently
- 3rd-party callers (Trip.com) hit the same API routes as the web frontend

---

## Business Dashboard

### Calendar View (default)
- Google Calendar-style with week/day toggle (primary for hourly view), month (overview)
- Each vehicle is a separate calendar in the sidebar (toggle on/off)
- Bookings displayed as color-coded time blocks:
  - Green = confirmed (upcoming)
  - Blue = active (car is out)
  - Gray = completed
  - Red = cancelled
- Buffer time shown as hatched/dimmed extension of each booking block
- Click event -> booking detail (view/cancel/message)
- Staff can drag-to-create manual blocks (maintenance, holds)
- Booking source badge on each event (direct, Trip.com, manual)
- Built with react-big-calendar (locked after 2026-04-11 bake-off; see `docs/2026-04-11-calendar-library-spike.md` — schedule-x disqualified due to paywalled resource/drag features)

### Navigation
- Dashboard (calendar)
- Bookings (list view with filters: pending, confirmed, active, completed, cancelled)
- Vehicles (fleet CRUD)
- Messages (inbox with unread badges)
- Customers (renter list with country, booking history)

### Key Interactions
- New bookings show as badge count on Bookings nav item
- Booking confirmation auto-creates DM thread and notifies renter
- Vehicle status toggleable directly from vehicle list
- 3rd-party bookings (Trip.com) appear on calendar automatically via API sync

---

## Translation Architecture

### UI Translation (static)
- next-intl with JSON message files
- MVP languages: EN, JA, ZH
- Same pattern as pre-auth-v1

### Message Translation (dynamic, user-generated)
- Google Cloud Translation API
- On-demand (click "Translate" button), not auto-translated
- Auto-detects source language
- Cached in Message.translations JSON field, keyed by language code
- Target language determined by recipient's User.language preference
- Estimated cost: ~$2/month at 200 users

Why on-demand vs. auto-translate:
- Cheaper (only translate what's actually read)
- Some users can read the original
- Avoids translating into every possible language

---

## Scheduling Architecture

### Time Model
- **Continuous time ranges** with hour-level snapping (not discrete slots)
- `startAt` / `endAt` as `timestamptz` — stored UTC, displayed in JST (Asia/Tokyo)
- Japan has no DST — JST is always UTC+9, no edge cases
- All booking UI shows "Japan Standard Time (JST)" label for international tourists

### Conflict Prevention
- **Postgres exclusion constraint** on `(vehicle_id, tstzrange(start_at, end_at))` for CONFIRMED/ACTIVE bookings
- DB-level enforcement — no application race conditions possible
- On constraint violation: return "vehicle no longer available" to caller

### Buffer Time
- Per-vehicle `bufferMinutes` (default 60) for cleaning/handoff
- Availability queries expand existing bookings by buffer: a 10:00-14:00 booking with 60min buffer blocks 10:00-15:00
- Buffer is an availability-check concern, not stored in the booking itself
- Staff can override by creating adjacent manual bookings

### Availability Query
```sql
SELECT v.* FROM vehicles v
WHERE v.status = 'AVAILABLE'
AND NOT EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.vehicle_id = v.id
  AND b.status IN ('CONFIRMED', 'ACTIVE')
  AND tstzrange(b.start_at, b.end_at + (v.buffer_minutes * interval '1 minute'))
    && tstzrange($requested_start, $requested_end)
)
```

---

## Third-Party Booking Integration

### Design Principle
The booking API is source-agnostic. Whether a booking comes from the Kuruma web app, Trip.com, or staff manually entering — same endpoint, same availability check, same constraint enforcement. The `source` field is metadata for display/reporting, not branching logic.

### Architecture
```
Next.js (web) ──┐
Trip.com ───────┤──→ Hono API (CF Worker) ──→ Neon Postgres (exclusion constraint)
Staff manual ───┘         ↑
                          │
                 GET /availability ← used by all sources
```

### Integration Pattern (Trip.com example)
- Trip.com calls our availability API to check open slots
- Trip.com calls our booking API to create a confirmed booking (source=TRIP_COM, externalId=their reference)
- Our system is the single source of truth for inventory
- If Trip.com booking conflicts, API returns 409 Conflict
- Cancellations sync bidirectionally via webhooks (post-MVP)

### API Surface for External Consumers
| Endpoint | Purpose |
|----------|---------|
| `GET /api/vehicles` | List vehicles with specs |
| `GET /api/availability?vehicleId=X&start=T&end=T` | Check if slot is open |
| `POST /api/bookings` | Create booking (with source + externalId) |
| `DELETE /api/bookings/:id` | Cancel booking |
| `GET /api/bookings/:id` | Get booking status |

Authentication for 3rd-party callers: API key per integration partner (post-MVP: OAuth2 client credentials).

---

## MVP Scope

### In
- Auth: email/password + Google + Apple, renter vs staff/admin roles
- Vehicles: CRUD, photos (CF R2), specs, availability status, rules, buffer time
- Booking: instant-book (no approval step), hourly granularity, multi-source support
- Scheduling: Postgres exclusion constraint, buffer time, availability API
- Cancellation: tiered policy (72h free / 48h 30% / 24h 70% / same-day 100%)
- Messaging: DM threads (auto-created on booking + general inquiries), polling-based
- Translation: Google Cloud Translation, on-demand with per-message caching
- Business dashboard: calendar view (week/day primary), booking management, fleet CRUD, customer list
- i18n: EN, JA, ZH for UI strings
- 3rd-party booking API: source-agnostic booking + availability endpoints

### Out (post-MVP)
- Payment / pre-auth integration
- Verification workflow (IDP, passport upload)
- Real-time messaging (WebSocket/Supabase Realtime)
- Email/LINE/push notifications
- Analytics/reporting
- Mobile app
- 3rd-party webhook sync (bidirectional cancellation with Trip.com etc.)
- OAuth2 client credentials for API partners

---

## Open Questions

### Resolved (from owner feedback, 2026-04-07)
- **Booking granularity**: Hourly — owner needs flexible scheduling for 40-50 cars
- **Booking flow**: Instant-book (no approval step) — owner accepts by default, verification at pickup
- **Documents**: Passport + home country license + IDP (1949 Geneva Convention only). Non-Convention countries rejected.
- **Cancellation policy**: Tiered — 72h+ free, 72-48h 30%, 48-24h 70%, same-day 100%
- **3rd-party integration**: Required — owner has access to Chinese travel platform (Trip.com-like) for direct booking

### Still Open
- Payment timing preference (pre-auth, pay-at-pickup, prepay?)
- LINE integration priority?
- Vehicle condition photo/video upload workflow (owner wants this — scoping TBD)
- GPS tracking integration (owner uses GPS on all vehicles — display in dashboard?)

---

## Workflow

- **Task tracking:** GitHub Issues (vertical slices, not horizontal layers)
- **Issue format:** Durable descriptions (behaviors/contracts, not file paths), acceptance criteria
- **Issue labels:** AFK (agent can do autonomously) / HITL (needs human input)
- **Execution:** Subagent-driven, one issue at a time

---

*Spec created: 2026-04-02*
*Updated: 2026-04-03 — switched from Vercel/Prisma to Cloudflare/Drizzle for cost efficiency*
*Updated: 2026-04-07 — scheduling redesign: instant-book (drop approval flow), hourly granularity, 3rd-party booking API, owner feedback integrated*
*Updated: 2026-04-07 — architecture: monorepo split (Hono API + Next.js web + shared), Biome, Auth.js + Neon Postgres*
*Status: Design approved, ready for vertical slice issue creation*
