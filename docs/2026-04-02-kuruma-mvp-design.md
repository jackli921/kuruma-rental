# Kuruma Rental Platform - MVP Design Spec

> Airbnb-style car rental platform for a Japan-based car rental company serving international tourists

## Business Context

| Attribute | Value |
|-----------|-------|
| Location | Japan only (Osaka) |
| Vehicles | <100 currently |
| Users | 200+ now, scaling to 2000+ |
| User types | Renters (international tourists) + Business (staff/admin, speak JP/ZH) |
| Current system | Handwritten notes + Google Calendar |
| Model | Single-tenant, but structured for white-label reuse |

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js App Router | Familiar from pre-auth-v1, SSR + API routes |
| Database | Supabase (Postgres) | Managed, realtime upgrade path |
| ORM | Prisma | Type-safe queries for booking logic |
| Auth | Supabase Auth | Email/password + Google + Apple OAuth |
| Storage | Supabase Storage | Vehicle photos |
| Translation | Google Cloud Translation | Widest N-to-N language coverage |
| UI | Tailwind + shadcn/ui | Fast, consistent design system |
| Validation | Zod | Runtime + TypeScript type inference |
| i18n | next-intl | Proven in pre-auth-v1 |
| Deployment | Vercel | Already familiar |
| Project init | Clean create-next-app | No template baggage |

**Division of responsibility:**
- Supabase handles: auth, file storage, realtime (future upgrade path)
- Prisma handles: all data access (vehicles, bookings, messages, users)

---

## Data Model

### User
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| supabaseAuthId | string | Links to Supabase Auth |
| email | string | Unique |
| name | string | |
| role | enum | RENTER, STAFF, ADMIN |
| language | string | Preferred language (UI + translation target) |
| country | string? | |
| avatarUrl | string? | |
| createdAt | datetime | |
| updatedAt | datetime | |

### Vehicle
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| name | string | e.g. "Toyota Prius 2022" |
| description | string | |
| photos | string[] | Supabase Storage URLs |
| seats | int | |
| transmission | enum | AUTO, MANUAL |
| fuelType | string | |
| status | enum | AVAILABLE, MAINTENANCE, RETIRED |
| minRentalDays | int? | Business-configurable rule |
| maxRentalDays | int? | Business-configurable rule |
| advanceBookingHours | int? | How far ahead booking is required |
| createdAt | datetime | |
| updatedAt | datetime | |

### Booking
| Field | Type | Notes |
|-------|------|-------|
| id | string (cuid) | Primary key |
| renterId | string | -> User |
| vehicleId | string | -> Vehicle |
| startDate | date | Daily granularity for MVP |
| endDate | date | |
| status | enum | PENDING -> CONFIRMED -> ACTIVE -> COMPLETED (or CANCELLED) |
| notes | string? | |
| createdAt | datetime | |
| updatedAt | datetime | |

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
4. Picks dates first -> sees available cars for that period
5. Views car detail (photos, specs, rules)
6. Requests booking
7. Waits for business approval
8. On approval: DM thread auto-created, renter notified
9. Manages booking (view status, cancel, message business)

### Business Flow
1. Logs in (staff or admin)
2. Sees dashboard: Google Calendar-style view with month/week/day toggle
3. Each vehicle is a separate "calendar" (toggle on/off in sidebar)
4. Bookings appear as color-coded events (yellow=pending, green=confirmed, blue=active, gray=completed)
5. Receives pending booking request -> reviews -> approves or rejects
6. Approval auto-creates DM thread and notifies renter
7. Marks booking as active (car picked up) and completed (car returned)
8. Manages fleet: add/edit/remove vehicles, upload photos, set rules
9. Views customer list (name, country, booking history)
10. Communicates with renters via DM with translation

### Messaging Flow
1. Either party opens thread
2. Types message in their own language
3. Message saved with detected source language
4. Other party sees original text + "Translate" button
5. Click translate: checks cached translations -> cache miss calls Google Cloud Translation -> stores result
6. Subsequent views of same translation load from cache

---

## Page Structure

```
app/
  [locale]/
    page.tsx                           # Public landing page
    vehicles/
      page.tsx                         # Date-first car browsing (public)
      [id]/page.tsx                    # Car detail (public)

    (auth)/
      login/page.tsx
      register/page.tsx
      callback/page.tsx                # OAuth callback

    (renter)/                          # Protected - renter role
      bookings/page.tsx                # My bookings list
      bookings/[id]/page.tsx           # Booking detail + status
      messages/page.tsx                # Inbox
      messages/[threadId]/page.tsx     # Thread view

    (business)/                        # Protected - staff/admin role
      dashboard/page.tsx               # Calendar overview
      bookings/page.tsx                # All bookings, pending requests
      bookings/[id]/page.tsx           # Review + approve/reject
      vehicles/page.tsx                # Fleet management list
      vehicles/new/page.tsx            # Add vehicle
      vehicles/[id]/edit/page.tsx      # Edit vehicle
      messages/page.tsx                # Inbox
      messages/[threadId]/page.tsx     # Thread view
      customers/page.tsx               # Renter list

    api/
      bookings/
      vehicles/
      messages/
      translate/
```

- Vehicle browsing is public (no auth needed)
- Route groups (renter) and (business) use middleware for role-based access
- Messages pages are the same structure for both roles, different layout wrapper

---

## Business Dashboard

### Calendar View (default)
- Google Calendar-style with month/week/day toggle
- Each vehicle is a separate calendar in the sidebar (toggle on/off)
- Bookings displayed as color-coded events:
  - Yellow = pending approval
  - Green = confirmed
  - Blue = active (car is out)
  - Gray = completed
- Click event -> booking detail (approve/reject/message)
- Built with react-big-calendar or @schedule-x/react

### Navigation
- Dashboard (calendar)
- Bookings (list view with filters: pending, confirmed, active, completed, cancelled)
- Vehicles (fleet CRUD)
- Messages (inbox with unread badges)
- Customers (renter list with country, booking history)

### Key Interactions
- Pending requests show as badge count on Bookings nav item
- Approving a booking auto-creates DM thread and notifies renter
- Vehicle status toggleable directly from vehicle list

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

## MVP Scope

### In
- Auth: email/password + Google + Apple, renter vs staff/admin roles
- Vehicles: CRUD, photos (Supabase Storage), specs, availability status, rules
- Booking: date-first browsing, request -> approve/reject, daily granularity
- Messaging: DM threads (auto-created on confirm + general inquiries), polling-based
- Translation: Google Cloud Translation, on-demand with per-message caching
- Business dashboard: calendar view (month/week/day), booking management, fleet CRUD, customer list
- i18n: EN, JA, ZH for UI strings
- Deployment: Vercel + Supabase

### Out (post-MVP)
- Payment / pre-auth integration
- Verification workflow (IDP, passport upload)
- Hourly/flexible booking granularity
- Real-time messaging (WebSocket/Supabase Realtime)
- Email/LINE/push notifications
- Analytics/reporting
- Mobile app

---

## Open Questions (for client meeting)
- Booking granularity: hourly, daily, or flexible?
- What documents need verification? (IDP, passport, insurance?)
- Specific business rules and policies per vehicle?
- Payment timing preference (pre-auth, pay-at-pickup, prepay?)
- LINE integration priority?

---

*Spec created: 2026-04-02*
*Status: Design approved, ready for implementation planning*
