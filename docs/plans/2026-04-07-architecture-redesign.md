# Architecture Redesign — 2026-04-07

> **For future sessions:** This document captures all design decisions made on 2026-04-07. Read this before the MVP design spec to understand what changed and why.

## Summary

Three major design changes were made based on owner feedback and extensibility requirements:

1. **Booking flow**: Request-and-approve → instant-book
2. **Scheduling**: Daily granularity → hourly granularity
3. **Architecture**: Flat Next.js fullstack → monorepo (Hono API + Next.js web + shared)

---

## Decision 1: Instant-Book (drop approval flow)

### What changed
- Removed PENDING status from booking state machine
- Bookings are CONFIRMED immediately on creation, slot locked
- Staff no longer approve/reject — they see bookings appear on their calendar

### Why
Owner feedback (`docs/plans/context/feedback-from-owner.md`) revealed:
- They accept bookings by default — there was never an approval gate
- Verification (passport, IDP, license) happens at physical pickup, not at booking time
- The #1 pain is double-booking across platforms, not screening renters
- Adding an approval step would create friction that doesn't exist in their real workflow

### Booking state machine (new)
```
CONFIRMED ──→ ACTIVE ──→ COMPLETED
    │            │
    └──→ CANCELLED ←──┘
```

### Cancellation policy (from owner)
- 72h+ before pickup: free
- 72-48h: 30% charge
- 48-24h: 70% charge
- Same-day: 100% charge

---

## Decision 2: Hourly Scheduling

### What changed
- `startDate` / `endDate` (date) → `startAt` / `endAt` (timestamptz)
- Added `bufferMinutes` to Vehicle model (default 60, per-vehicle configurable)
- Added `source` enum + `externalId` to Booking model for multi-source tracking
- Postgres exclusion constraint prevents double-booking at DB level

### Why
- Owner manages 40-50 cars with Excel, needs flexible time-based scheduling
- Hourly granularity was listed as post-MVP but owner feedback shows it's needed from day one
- 3rd-party platforms (Trip.com) will also create bookings — need airtight conflict prevention

### Scheduling constraints
- **Exclusion constraint**: `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('CONFIRMED', 'ACTIVE'))`
- **Buffer time**: Application-level, expands existing bookings by `bufferMinutes` during availability checks
- **Timezone**: All stored UTC, displayed JST (Asia/Tokyo). Japan has no DST.

### Availability query pattern
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

## Decision 3: Monorepo with Hono API

### What changed
Flat Next.js fullstack app → Bun workspace monorepo with three packages.

### Why
- Owner has access to a Chinese travel platform (Trip.com-like) that will book cars directly via API
- If the booking API lives inside Next.js API routes, every API consumer is coupled to frontend deploys
- Hono is native to CF Workers (no `@opennextjs/cloudflare` compatibility layer needed for the API)
- `hono/client` provides end-to-end type safety between the web frontend and the API

### New structure
```
kuruma-rental/
├── packages/
│   ├── api/            ← Hono (all business logic + REST API)
│   │                     Deploys to CF Workers
│   ├── web/            ← Next.js (tourist UI, staff dashboard, i18n)
│   │                     Deploys to CF Pages
│   └── shared/         ← Drizzle schema, Zod schemas, shared types
│                         Used by both api and web
├── biome.json          ← Replaces ESLint + Prettier
└── package.json        ← Bun workspace root
```

### Key boundaries
- `packages/web` has NO direct database access — all data flows through the Hono API
- `packages/api` has NO UI rendering — pure REST API
- `packages/shared` has NO runtime dependencies on either api or web
- Auth.js lives in `web` (session management). API verifies Auth.js JWTs independently
- 3rd-party callers (Trip.com) hit the same API routes as the web frontend

### Additional stack changes
| Before | After | Why |
|--------|-------|-----|
| ESLint + Prettier | Biome | Rust-based, 100x faster, single tool |
| Supabase Auth | Auth.js v5 | In progress on `refactor/authjs-neon` branch |
| Supabase Postgres | Neon Postgres | DB branching for dev/PR environments |
| Supabase Storage | CF R2 | Native to Cloudflare, cheaper |
| Next.js API routes | Hono | Independent API, native CF Workers |

---

## Updated Data Model (key changes only)

### Vehicle (added fields)
| Field | Type | Notes |
|-------|------|-------|
| bufferMinutes | int | Turnaround time between bookings (default 60) |
| minRentalHours | int? | Replaces minRentalDays |
| maxRentalHours | int? | Replaces maxRentalDays |

### Booking (rewritten)
| Field | Type | Notes |
|-------|------|-------|
| startAt | timestamptz | Replaces startDate (date) |
| endAt | timestamptz | Replaces endDate (date) |
| status | enum | CONFIRMED, ACTIVE, COMPLETED, CANCELLED (no PENDING) |
| source | enum | DIRECT, TRIP_COM, MANUAL, OTHER (new) |
| externalId | string? | 3rd-party booking reference (new) |

### User
| Field | Change |
|-------|--------|
| supabaseAuthId | Removed (Auth.js manages identity via accounts table) |
| emailVerified | Added (Auth.js field) |
| image | Added (replaces avatarUrl, Auth.js field) |

---

## Current State & Next Steps

### Branch status
- `main` — flat Next.js app with Auth.js + Neon (working, Google OAuth verified)

### What's done (as of 2026-04-07)
- [x] 0a. Auth.js + Neon migration (merged to main, OAuth working)
- [x] CI/CD — GitHub Actions running test + build on push/PR
- [x] Drizzle schema with Auth.js tables (users, accounts, sessions, verification_tokens)
- [x] next-intl configured (EN/JA/ZH)
- [x] vitest configured with smoke + validation + auth tests (13 passing)
- [x] Cloudflare Workers target configured (@opennextjs/cloudflare)

### Remaining GitHub issues
- Slice 2 (email/password login) — deferred, OAuth-first
- Slice 4 (role-based routing + landing page) — blocked by monorepo split decision
- Slice 5 (deploy to Cloudflare) — blocked by monorepo split

### Recommended execution order
```
Phase 0: Foundation
  0a. Finish Auth.js + Neon migration              ✅ DONE
  0b. Monorepo split (Bun workspace)               ← NEXT
  0c. Hono API skeleton + hono/client in web
  0d. Biome setup

Phase 1: Core booking (owner's #1 priority)
  1a. Vehicle CRUD (Hono routes + web UI)
  1b. Scheduling schema (exclusion constraint)
  1c. Availability API
  1d. Instant-book flow
  1e. Business calendar dashboard

Phase 2: Communication
  2a. DM threads
  2b. Translation
  2c. Customer list

Phase 3: Integration
  3a. 3rd-party booking API (API key auth)
  3b. Cancellation policy enforcement
  3c. Vehicle photo/video upload
```

### Files modified in this session
| File | Change |
|------|--------|
| `docs/2026-04-02-kuruma-mvp-design.md` | Major update — tech stack, data model, booking flow, project structure, scheduling architecture, 3rd-party integration, MVP scope, open questions |
| `docs/plans/2026-04-07-migrate-to-authjs-neon.md` | Added monorepo path mapping note at top |
| `AGENTS.md` | Added monorepo architecture section |

### Source material
- Owner interview feedback: `docs/plans/context/feedback-from-owner.md` (Mandarin)
- All design decisions informed by this feedback + extensibility analysis for 3rd-party booking platforms

---

*Created: 2026-04-07*
