import type {
  AddOnSnapshot,
  BookingEventPayload,
  BookingEventType,
  BookingFulfillmentMode,
  FeeSnapshotItem,
  InsuranceSnapshot,
} from '@kuruma/shared/db/schema'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'

export interface VehicleClass {
  id: string
  /** Owning operator (marketplace tenant, #386). NOT NULL in the DB. */
  operatorId: string
  name: string
  slug: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number
  luggageSize: LuggageSize
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  /** ACRISS taxonomy code (#388). Null when the class has no mapped code. */
  acrissCode: string | null
  sortOrder: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

export type { VehicleBase as Vehicle } from '@kuruma/shared/types/vehicle'

export interface Booking {
  id: string
  // Tenant owner (#392), server-derived from the assigned vehicle's operator.
  operatorId: string
  renterId: string
  // classId stays for discovery/grouping; sealed to operatorId by composite FK.
  classId: string
  // What the renter selected in storefront (slice 5) — immutable audit trail.
  requestedVehicleId: string
  // What the operator fulfills; the exclusion constraint keys on this. Server-
  // derived = requestedVehicleId at submit; operator may substitute (#392).
  assignedVehicleId: string
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  endAt: Date
  effectiveEndAt: Date
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  // #463: how the booking is fulfilled. Server-derived SPECIFIC pre-demo;
  // CLASS_COMBO is #464. Always written explicitly by app code (Option B).
  fulfillmentMode: BookingFulfillmentMode
  // Human-facing reservation code, 8-char no-confusables base32 (§10 item 3).
  bookingCode: string
  // Selected insurance + its snapshot, locked at booking time. Null = declined.
  insuranceOptionId: string | null
  insuranceSnapshot: InsuranceSnapshot | null
  // Applicable fee_schedules rows snapshotted at booking time (never null).
  feeSnapshot: FeeSnapshotItem[]
  // Paid add-ons selected at booking time (#460), never null.
  addOnSnapshot: AddOnSnapshot[]
  externalId: string | null
  notes: string | null
  totalPrice: number | null
  cancellationFee: number | null
  cancelledAt: Date | null
  idempotencyKey: string | null
  createdAt: Date
  updatedAt: Date
}

// Append-only booking lifecycle event (#392, proposal §5.2). The events are the
// source of truth; bookings.status is the write-through projection.
export interface BookingEvent {
  id: string
  bookingId: string
  type: BookingEventType
  payload: BookingEventPayload
  // Renter for CREATED; operator user for SUBSTITUTED/CANCELLED; null = system.
  actorId: string | null
  createdAt: Date
}

// A recorded Stripe payment of the rental total (#461). Persisted ONLY on the
// verified checkout.session.completed webhook — the source of truth for revenue.
export interface PaymentEvent {
  id: string
  // Partner attribution, re-derived from the booking on the webhook (#462 revenue).
  operatorId: string
  bookingId: string
  stripeEventId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  // Whole JPY. gross = Stripe amount_total; fee = 4%; net = gross - fee.
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  currency: string
  status: 'SUCCEEDED'
  createdAt: Date
}

export interface Thread {
  id: string
  bookingId: string | null
  idempotencyKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ThreadParticipant {
  id: string
  threadId: string
  userId: string
  unreadCount: number
}

export interface Message {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: string
  idempotencyKey: string | null
  createdAt: Date
}

// Slice 7 (#393): one row per outbound email. status drives the lease-bounded
// send lifecycle (QUEUED -> SENDING -> SENT/FAILED); idempotencyKey seals one
// logical notification per (booking, kind).
export interface NotificationLog {
  id: string
  bookingId: string
  operatorId: string
  kind: 'OPERATOR_BOOKING_ALERT' | 'RENTER_BOOKING_CONFIRM'
  channel: string
  recipient: string
  locale: string
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'
  providerMessageId: string | null
  error: string | null
  attempts: number
  idempotencyKey: string
  createdAt: Date
  updatedAt: Date
}

export interface MaintenanceLog {
  id: string
  vehicleId: string
  reason: string
  notes: string | null
  costJpy: number | null
  startedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

import type { UserRole } from './middleware/auth'

export interface User {
  id: string
  name: string | null
  // email may be null for phone-only customers created via /customers/quick-create.
  // Storage keeps a synthetic placeholder (Auth.js adapter requires NOT NULL) but
  // repository reads mask it back to null so API consumers never see it.
  email: string | null
  phone: string | null
  language: string
  country: string | null
  role: UserRole
  // Owning operator for OPERATOR_* users; null/undefined for renters + platform
  // admins. Optional because most reads don't project it (#393 findOperatorContacts).
  operatorId?: string | null
}

export interface Operator {
  id: string
  slug: string
  name: string
  preAuthHandoffUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Location {
  id: string
  /** Owning operator (marketplace tenant, #387). NOT NULL in the DB. */
  operatorId: string
  name: string
  address: string
  operatingHours: LocationOperatingHours
  timezone: string
  defaultTurnaroundMinutes: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

export interface InsuranceOption {
  id: string
  /** Owning operator (marketplace tenant, #404). NOT NULL in the DB. */
  operatorId: string
  name: string
  description: string | null
  dailyPriceJpy: number
  /** null = no deductible (full cover). */
  deductibleJpy: number | null
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

export interface AddOn {
  id: string
  /** Owning operator (marketplace tenant, #460). NOT NULL in the DB. */
  operatorId: string
  name: string
  description: string | null
  priceJpy: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

export interface FeeSchedule {
  id: string
  /** Owning operator (marketplace tenant, #405). NOT NULL in the DB. */
  operatorId: string
  /** null = operator-wide fee; non-null = scoped to one vehicle class. */
  vehicleClassId: string | null
  feeType: 'OVERTIME_HOURLY' | 'CLEANING_FLAT' | 'NO_FUEL_FLAT'
  unit: 'PER_HOUR' | 'PER_DAY' | 'PER_KM' | 'FLAT'
  amountJpy: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

// Renter identity document metadata (#459). Bytes live in R2; this is the
// verdict + pointer only. `expiryDate` is a YYYY-MM-DD string (DB `date`).
export interface RenterDocument {
  id: string
  renterId: string
  type: 'IDP' | 'PASSPORT'
  storageKey: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  expiryDate: string | null
  verifiedAt: Date | null
  verifierId: string | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

// Map stores removed — repositories handle data access now.
// Types remain here as the shared contract between repositories and routes.
