import type {
  AddOnSnapshot,
  AuditEventKind,
  BookingEventPayload,
  BookingEventType,
  BookingFulfillmentMode,
  CoordinateSource,
  FeeSnapshotItem,
  InsuranceSnapshot,
  NotificationKind,
  NotificationStatus,
} from '@kuruma/shared/db/schema'
import type {
  AddOnStatus,
  BookingSource,
  BookingStatus,
  CancellationFeeSettlement,
  CatalogTemplateStatus,
  ConsentDocStatus,
  ConsentMethod,
  ConsentType,
  DocumentStatus,
  DocumentType,
  FeeScheduleStatus,
  FeeType,
  FeeUnit,
  InsuranceStatus,
  LocationStatus,
  OperatorMembershipStatus,
  OperatorRole,
  PaymentEventStatus,
  PaymentRefundStatus,
  ProviderInviteStatus,
  ReviewAuthorRole,
  ReviewModerationStatus,
  ReviewSubject,
  Transmission,
  VehicleBlockKind,
  VehicleClassStatus,
} from '@kuruma/shared/enums'
import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type { ComplianceAlertBand, ComplianceDocumentType } from '@kuruma/shared/lib/compliance'
import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { PaymentAnomalyResolution } from '@kuruma/shared/types/payment-anomaly'

/**
 * The notification kind/status sets have a single source of truth: the
 * `notificationKindEnum` / `notificationStatusEnum` pgEnums in @kuruma/shared.
 * Both are derived there (#710, #534) and re-exported here so a new value (e.g.
 * DEAD, #483) added to an enum can't drift from these types without a compile
 * error. Never re-list the literals — that drift only surfaces as a runtime
 * 22P02 invalid_enum_value on the insert that writes `kind`/`status`.
 */
export type { NotificationKind, NotificationStatus }

/**
 * #930: the audit-event kind set is sourced from the `auditEventKindEnum` pgEnum
 * in @kuruma/shared (derived there, mirroring NotificationKind above) and
 * re-exported here so a new kind can't drift from this type without a compile
 * error — drift would otherwise only surface as a runtime 22P02 on insert.
 */
export type { AuditEventKind }

// #930: one row of the durable audit ledger (see db/audit.ts). Append-only —
// rows are inserted, never updated or deleted. Common fields are typed columns;
// the nullable ones carry kind-specific detail (operatorId/targetId for scope,
// field/oldValue/newValue for OPERATOR_PROFILE_UPDATED diffs).
export interface AuditLogEntry {
  id: string
  kind: AuditEventKind
  actorUserId: string
  operatorId: string | null
  targetId: string | null
  field: string | null
  oldValue: string | null
  newValue: string | null
  createdAt: Date
}

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
  transmission: Transmission
  fuelType: string | null
  /** ACRISS taxonomy code (#388). Null when the class has no mapped code. */
  acrissCode: string | null
  sortOrder: number
  status: VehicleClassStatus
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
  // #464: null for a CLASS_COMBO float (no specific car requested). The
  // bookings_specific_requires_requested CHECK keeps SPECIFIC rows non-null.
  requestedVehicleId: string | null
  // What the operator fulfills; the exclusion constraint keys on this. Server-
  // derived = requestedVehicleId at submit; operator may substitute (#392).
  // #464: null for an unassigned CLASS_COMBO float until the operator assigns a car.
  assignedVehicleId: string | null
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  endAt: Date
  effectiveEndAt: Date
  status: BookingStatus
  source: BookingSource
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
  // #868 Slice 3a: settlement status of the cancellation fee. Server-derived
  // (not a create input), defaults to 'ADVISORY' until #851 moves money.
  cancellationFeeSettlement: CancellationFeeSettlement
  cancelledAt: Date | null
  idempotencyKey: string | null
  // #613: renter liability-disclaimer consent, server-stamped at booking time.
  // Null for staff/manual/Trip.com + historical bookings (no renter consent).
  disclaimerAcknowledgedAt: Date | null
  disclaimerTermsVersion: string | null
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
  status: PaymentEventStatus
  createdAt: Date
}

// A durable cancellation-refund receipt (#851): one row per booking (UNIQUE), the
// "work already started" half of the REFUND_DUE outbox + the create-dedup ledger
// that carries re_… so a re-drive RETRIEVES instead of re-creating (Stripe
// idempotency keys prune ~24h; this row is permanent). Status is FORWARD-ONLY.
export interface PaymentRefund {
  id: string
  bookingId: string
  // Partner attribution, carried for the operator refund surface (mirrors PaymentEvent).
  operatorId: string
  // The captured payment's PaymentIntent — what we refund against.
  stripePaymentIntentId: string
  // Whole JPY (zero-decimal) to refund: renter = policy refundAmount, operator = full total.
  amountJpy: number
  // Stripe refund id (re_…); null until create/adopt attaches it. Partial-UNIQUE when set.
  stripeRefundId: string | null
  status: PaymentRefundStatus
  createdAt: Date
  updatedAt: Date
}

export type PaymentAnomalyKind = 'DOUBLE_PAYMENT' | 'AMOUNT_MISMATCH'

// A verified Stripe charge that needs human review rather than becoming revenue
// (#508 P2): a duplicate charge on an already-paid booking (DOUBLE_PAYMENT) or an
// amount/currency that doesn't match the booking snapshot (AMOUNT_MISMATCH). Kept
// separate from PaymentEvent so revenue (sum of SUCCEEDED payments) is never polluted.
export interface PaymentAnomaly {
  id: string
  // Partner attribution, re-derived from the booking on the webhook — never Stripe metadata.
  operatorId: string
  bookingId: string
  kind: PaymentAnomalyKind
  stripeEventId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  // Whole JPY. received = Stripe amount_total (null if Stripe omitted it); expected = booking total at webhook time.
  receivedAmountJpy: number | null
  expectedAmountJpy: number | null
  currency: string | null
  // Resolution audit (#1075 slice 3): all four are NULL while the anomaly needs
  // review and written together when an admin closes it. `resolution` = why it was
  // closed, `resolvedBy` = the actioning admin's id, `note` = optional free-text.
  resolvedAt: Date | null
  resolution: PaymentAnomalyResolution | null
  resolvedBy: string | null
  note: string | null
  createdAt: Date
}

export interface Thread {
  id: string
  bookingId: string | null
  // Tenant owner, denormalized from the booking's operator (#1205). Null when the
  // thread has no booking; the operator portal read-scopes on it.
  operatorId: string | null
  // Operator-side unread counter (#1205, slice 3) — tenant-level, mirrors the
  // renter's per-participant unreadCount but lives on the thread.
  operatorUnreadCount: number
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
  translations: Record<string, string>
  idempotencyKey: string | null
  createdAt: Date
}

// Slice 7 (#393): one row per outbound email. status drives the lease-bounded
// send lifecycle (QUEUED -> SENDING -> SENT/FAILED); idempotencyKey seals one
// SEND per (booking, kind) under the `notify:<id>:<kind>` key. DEAD (#483) is the
// terminal poison-message sink after MAX_NOTIFICATION_ATTEMPTS failures — claim()
// never re-arms it. #681: a NO_RECIPIENT skip is a PARALLEL terminal row keyed
// `:no_recipient`, so it coexists with — and never poisons — a later real send
// for the same (booking, kind). kind/status are derived from their pgEnums in
// @kuruma/shared/db/schema (#710) — never re-list the literals here.
export interface NotificationLog {
  id: string
  bookingId: string
  operatorId: string
  // #710: derived from notificationKindEnum (see NotificationKind re-export
  // above) — never re-list the literals, or a rename drifts silently into a
  // runtime 22P02 invalid_enum_value on insert.
  kind: NotificationKind
  channel: string
  recipient: string
  locale: string
  status: NotificationStatus
  providerMessageId: string | null
  error: string | null
  attempts: number
  idempotencyKey: string
  createdAt: Date
  updatedAt: Date
}

// §5.4/§7 (#916): one row per (vehicle, document, band) the digest has alerted on.
export interface ComplianceAlertLog {
  id: string
  operatorId: string
  vehicleId: string
  documentType: ComplianceDocumentType
  thresholdBand: ComplianceAlertBand
  recipient: string
  sentAt: Date
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

// #1101: a scheduled block takes a vehicle off the calendar for a [startAt,endAt)
// window (maintenance / out-of-service / manual hold). Distinct from
// MaintenanceLog (reactive, cost-tracking, welded to vehicle.status=MAINTENANCE):
// a block is forward-looking and is the availability primitive — a CONFIRMED/ACTIVE
// booking cannot overlap one. operatorId is server-derived from the vehicle. No
// updatedAt: a block is created and (hard-)deleted, never edited in place.
export interface VehicleBlock {
  id: string
  operatorId: string
  vehicleId: string
  startAt: Date
  endAt: Date
  kind: VehicleBlockKind
  reason: string
  notes: string | null
  createdBy: string
  createdAt: Date
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
  // admins. Optional because most reads don't project it. Operator-alert recipients
  // now come from the operator_memberships ledger (#878), not this field.
  operatorId?: string | null
}

export interface Operator {
  id: string
  slug: string
  name: string
  preAuthHandoffUrl: string | null
  createdAt: Date
  updatedAt: Date
  // #1088: soft-deactivation. NULL = active; set = deactivated (hidden from
  // storefront/search, blocks new bookings). `active` is derived, never stored.
  deactivatedAt: Date | null
}

export interface Location {
  id: string
  /** Owning operator (marketplace tenant, #387). NOT NULL in the DB. */
  operatorId: string
  name: string
  address: string
  /** WGS84 decimal degrees (#458 D2). null = not-yet-geocoded; the search map
   *  degrades that row to list-only. */
  latitude: number | null
  longitude: number | null
  /** Provenance of the coords above (#531). null = none captured. Server-derived. */
  coordinateSource: CoordinateSource | null
  operatingHours: LocationOperatingHours
  timezone: string
  defaultTurnaroundMinutes: number
  /** #394 deepest (area) region node, or null (not-yet-assigned, NOT NULL
   *  deferred — D1). Drives the recursive-descendant storefront filter. */
  regionId: string | null
  status: LocationStatus
  createdAt: Date
  updatedAt: Date
}

// #651 Slice 2b: the api region row IS the full shared taxonomy node. One shape
// now feeds the GET /regions cascade AND the location-save geo guard, because
// `RegionNode extends RegionCandidate` — so the lean `findCandidates` projection
// is gone and `findAll` returns everything (type/lat/lng/assignable/status/slug).
// Inline-import alias keeps the name + definition site here (no top-of-file churn).
export type Region = import('@kuruma/shared/types/region').RegionNode

export interface InsuranceOption {
  id: string
  /** Owning operator (marketplace tenant, #404). NOT NULL in the DB. */
  operatorId: string
  name: string
  description: string | null
  dailyPriceJpy: number
  /** null = no deductible (full cover). */
  deductibleJpy: number | null
  status: InsuranceStatus
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
  status: AddOnStatus
  createdAt: Date
  updatedAt: Date
}

/**
 * Platform-owned, pre-translated add-on TEMPLATE (catalog i18n, epic #385).
 * NO operatorId — the catalog is global, shared across every tenant (a picker,
 * not tenant data). `key` = slugify(canonical English name), the stable join
 * handle between an operator's legacy add-on and its template. `name` /
 * `description` are LocalizedText {en, ja?, zh?} bundles resolved to the caller
 * locale in the service layer; `description` is nullable in the DB.
 */
export interface AddOnTemplate {
  id: string
  key: string
  name: LocalizedText
  description: LocalizedText | null
  status: CatalogTemplateStatus
  createdAt: Date
  updatedAt: Date
}

export interface FeeSchedule {
  id: string
  /** Owning operator (marketplace tenant, #405). NOT NULL in the DB. */
  operatorId: string
  /** null = operator-wide fee; non-null = scoped to one vehicle class. */
  vehicleClassId: string | null
  feeType: FeeType
  unit: FeeUnit
  amountJpy: number
  status: FeeScheduleStatus
  createdAt: Date
  updatedAt: Date
}

/**
 * The rate plan that prices a CLASS_COMBO booking (#464 §5.1). A combo books a
 * vehicle *class* (no specific car at book time), so it is priced off the class,
 * not a car — keyed per (operator, class, pickupLocation) because cars live at
 * one location and a "deal" is a deliberately-set day rate. SPECIFIC bookings
 * keep #406 per-car pricing; this table prices combos only (§5.3).
 */
export interface ClassRatePlan {
  id: string
  operatorId: string
  classId: string
  pickupLocationId: string
  dayRateJpy: number
  /** Toggle a deal on/off without deleting the row; inactive ⇒ not offered. */
  isActive: boolean
  label: string | null
  createdAt: Date
  updatedAt: Date
}

// Renter identity document metadata (#459). Bytes live in R2; this is the
// verdict + pointer only. `expiryDate` is a YYYY-MM-DD string (DB `date`).
export interface RenterDocument {
  id: string
  renterId: string
  type: DocumentType
  storageKey: string
  status: DocumentStatus
  expiryDate: string | null
  verifiedAt: Date | null
  verifierId: string | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

// Provider authorization (#521). operator_memberships is the source-of-truth
// grant ledger; users.role/operatorId are its single-active projection (the JWT
// reads the projection). Mirrors the operator_memberships table columns.
export interface OperatorMembership {
  id: string
  userId: string
  operatorId: string
  role: OperatorRole
  status: OperatorMembershipStatus
  createdAt: Date
  updatedAt: Date
}

// Pre-approved provider email for first-login provisioning (#521). The token is
// shown once at creation; only sha256(token) is stored. Single-use
// (PENDING->ACCEPTED), time-limited; expired-ness is computed from expiresAt.
export interface ProviderInvite {
  id: string
  email: string
  operatorId: string
  role: OperatorRole
  tokenHash: string
  status: ProviderInviteStatus
  expiresAt: Date
  invitedByUserId: string | null
  acceptedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ConsentDocument {
  id: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
  status: ConsentDocStatus
  effectiveFrom: Date
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ConsentAcceptance {
  id: string
  documentId: string
  consentType: ConsentType
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  acceptedAt: Date
  context: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  method: ConsentMethod
  recordSignature: string | null
  signingKeyId: string | null
  signatureCanonicalVersion: string | null
  documentSnapshot: DocumentSnapshot | null
  signatureRef: string | null
  createdAt: Date
}

// One mutual, double-blind review row (#1067 reviews bounded context, see
// db/review.ts). A review stays hidden (`publishedAt === null`) until BOTH sides
// submit OR `revealDeadlineAt` elapses. The row-shape invariants (overall range,
// author/subject pairing, vehicle pairing, one-per-author-per-subject) are sealed
// in Postgres; this interface is the in-app projection of a stored row.
export interface Review {
  id: string
  bookingId: string
  // Denormalized tenant scope (the booking's operator) — operator-scoped reads
  // and the (operatorId, publishedAt) aggregate never need a bookings join.
  operatorId: string
  authorUserId: string
  authorRole: ReviewAuthorRole
  subject: ReviewSubject
  // Set only when subject === 'VEHICLE' / a class aggregate; null otherwise.
  subjectVehicleId: string | null
  subjectClassId: string | null
  // Whole stars 1-5 (reviews_overall_range_chk).
  overall: number
  // Optional named sub-dimensions, each 1-5; {} when none given. Keys validated
  // by @kuruma/shared/validators/review before the write.
  subRatings: Record<string, number>
  comment: string | null
  moderationStatus: ReviewModerationStatus
  // The fixed double-blind deadline; reveal fires at the earlier of both-submitted
  // or this instant.
  revealDeadlineAt: Date
  submittedAt: Date
  // The reveal flag: null until published (both submitted OR window elapsed).
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// Map stores removed — repositories handle data access now.
// Types remain here as the shared contract between repositories and routes.
