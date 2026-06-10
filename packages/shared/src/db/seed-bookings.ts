import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from './index'
import {
  type BookingCreatedPayload,
  type FeeSnapshotItem,
  type InsuranceSnapshot,
  type VehicleSubstitutedPayload,
  bookingEvents,
  bookings,
  notificationLog,
  users,
  vehicles,
} from './schema'
import {
  DEMO_BOOKINGS,
  DEMO_FEE_SCHEDULES,
  DEMO_INSURANCE_OPTIONS,
  DEMO_OPERATORS,
  DEMO_RENTERS,
} from './seed-data'
import { seedId } from './seed-id'

/**
 * Slice 8 demo bookings + events + notifications (#390, §3.5). Consumes the
 * pure `DEMO_BOOKINGS` descriptors: resolves a concrete seeded vehicle per
 * booking, computes demo-time-relative timestamps, snapshots insurance/fees, and
 * writes the marketplace shape — bookings, the append-only booking_events log
 * (BOOKING_CREATED per row + one VEHICLE_SUBSTITUTED), and one operator
 * notification_log row per booking. Run AFTER `db:seed` (needs the seeded fleet).
 *
 * Idempotent: cleanup deletes every booking owned by a demo-renter persona (and
 * its events/notifications, FK-safe order) plus the renter rows, then re-inserts.
 * Scoped to the RENTER `@example.test` personas — operator owners (also
 * `@example.test`) are never touched.
 */

function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 60 * 60 * 1000)
}

function dayAt(dayOffset: number, hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d
}

const insuranceById = new Map(DEMO_INSURANCE_OPTIONS.map((o) => [o.id, o]))
const ownerEmailByOperator = new Map(DEMO_OPERATORS.map((o) => [o.id, o.owner.email]))

function insuranceSnapshotFor(insuranceOptionId: string | null): InsuranceSnapshot | null {
  if (!insuranceOptionId) return null
  const opt = insuranceById.get(insuranceOptionId)
  if (!opt) throw new Error(`Unknown insurance option ${insuranceOptionId}`)
  return {
    insuranceOptionId: seedId(opt.id),
    name: opt.name,
    dailyPriceJpy: opt.dailyPriceJpy,
    deductibleJpy: opt.deductibleJpy,
  }
}

// Snapshot the operator's fees that apply to this class: every operator-wide row
// plus any row scoped to exactly this class (proposal §9 item 19).
function feeSnapshotFor(operatorId: string, classId: string): FeeSnapshotItem[] {
  return DEMO_FEE_SCHEDULES.filter(
    (f) =>
      f.operatorId === operatorId && (f.vehicleClassId == null || f.vehicleClassId === classId),
  ).map((f) => ({
    feeType: f.feeType,
    unit: f.unit,
    amountJpy: f.amountJpy,
    vehicleClassId: f.vehicleClassId ? seedId(f.vehicleClassId) : null,
  }))
}

type SeededVehicle = { id: string; pickupLocationId: string }

async function seed() {
  const db = getDb()

  // --- Idempotent cleanup (FK-safe), scoped to demo-renter personas. ---
  console.log('Clearing demo bookings, events, notifications, renters...')
  const renterEmails = DEMO_RENTERS.map((r) => r.email)
  const existingRenters = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, renterEmails))
  const renterIds = existingRenters.map((r) => r.id)
  if (renterIds.length > 0) {
    const owned = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(inArray(bookings.renterId, renterIds))
    const ownedIds = owned.map((b) => b.id)
    if (ownedIds.length > 0) {
      await db.delete(notificationLog).where(inArray(notificationLog.bookingId, ownedIds))
      await db.delete(bookingEvents).where(inArray(bookingEvents.bookingId, ownedIds))
      await db.delete(bookings).where(inArray(bookings.id, ownedIds))
    }
    await db.delete(users).where(inArray(users.id, renterIds))
  }

  console.log(`Creating ${DEMO_RENTERS.length} demo renters...`)
  await db.insert(users).values(
    DEMO_RENTERS.map((r) => ({
      id: seedId(r.id),
      name: r.name,
      email: r.email,
      language: r.language,
      role: 'RENTER' as const,
    })),
  )

  // Resolve seeded vehicles into per-(operator,class) queues so each booking can
  // take a DISTINCT car — CONFIRMED/ACTIVE rows occupy their assigned vehicle via
  // the bookings_no_overlap exclusion constraint, so reuse would collide.
  const vehicleRows = await db
    .select({
      id: vehicles.id,
      classId: vehicles.classId,
      operatorId: vehicles.operatorId,
      pickupLocationId: vehicles.pickupLocationId,
    })
    .from(vehicles)
    .where(and(eq(vehicles.status, 'AVAILABLE'), isNotNull(vehicles.pickupLocationId)))

  const queueByOpClass = new Map<string, SeededVehicle[]>()
  for (const v of vehicleRows) {
    if (!v.classId || !v.pickupLocationId) continue
    const key = `${v.operatorId}::${v.classId}`
    const queue = queueByOpClass.get(key) ?? []
    queue.push({ id: v.id, pickupLocationId: v.pickupLocationId })
    queueByOpClass.set(key, queue)
  }

  const takeVehicle = (operatorId: string, classId: string): SeededVehicle => {
    const v = queueByOpClass.get(`${operatorId}::${classId}`)?.shift()
    if (!v) throw new Error(`No seeded vehicle for ${operatorId}/${classId} — run db:seed first`)
    return v
  }

  console.log(`Creating ${DEMO_BOOKINGS.length} demo bookings + events + notifications...`)
  const bookingValues = []
  const eventValues = []
  const notificationValues = []

  for (const b of DEMO_BOOKINGS) {
    const requested = takeVehicle(seedId(b.operatorId), seedId(b.classId))
    // Substitution demo: assign a DIFFERENT car of the same operator+class.
    const assigned = b.substitute ? takeVehicle(seedId(b.operatorId), seedId(b.classId)) : requested
    const startAt = dayAt(b.startOffsetDays, b.startHour)
    const endAt = addHours(startAt, b.durationHours)
    const insuranceSnapshot = insuranceSnapshotFor(b.insuranceOptionId)
    const feeSnapshot = feeSnapshotFor(b.operatorId, b.classId)
    const isCancelled = b.status === 'CANCELLED'

    bookingValues.push({
      id: seedId(b.id),
      operatorId: seedId(b.operatorId),
      renterId: seedId(b.renterId),
      classId: seedId(b.classId),
      requestedVehicleId: requested.id,
      assignedVehicleId: assigned.id,
      pickupLocationId: assigned.pickupLocationId,
      dropoffLocationId: assigned.pickupLocationId,
      bookingCode: b.bookingCode,
      startAt,
      endAt,
      // Overwritten by the bookings_set_effective_end_at trigger on INSERT; the
      // value here only satisfies the NOT NULL insert type.
      effectiveEndAt: endAt,
      status: b.status,
      source: 'DIRECT' as const,
      fulfillmentMode: 'SPECIFIC' as const, // #463: seed bookings are all specific-vehicle
      totalPrice: b.totalPriceJpy,
      insuranceOptionId: b.insuranceOptionId ? seedId(b.insuranceOptionId) : null,
      insuranceSnapshot,
      feeSnapshot,
      cancelledAt: isCancelled ? addHours(startAt, -24) : null,
      cancellationFee: isCancelled ? 0 : null,
    })

    const createdPayload: BookingCreatedPayload = {
      requestedVehicleId: requested.id,
      assignedVehicleId: assigned.id,
      classId: seedId(b.classId),
      fulfillmentMode: 'SPECIFIC',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      totalPrice: b.totalPriceJpy,
      insuranceSnapshot,
      feeSnapshot,
      addOnSnapshot: [], // seed bookings carry no paid add-ons (#460)
    }
    eventValues.push({
      bookingId: seedId(b.id),
      type: 'BOOKING_CREATED' as const,
      payload: createdPayload,
      actorId: seedId(b.renterId),
    })
    if (b.substitute) {
      const substitutedPayload: VehicleSubstitutedPayload = {
        fromVehicleId: requested.id,
        toVehicleId: assigned.id,
        reason: 'Original vehicle in maintenance — upgraded same class.',
      }
      // actorId null = system/operator action in the demo.
      eventValues.push({
        bookingId: seedId(b.id),
        type: 'VEHICLE_SUBSTITUTED' as const,
        payload: substitutedPayload,
        actorId: null,
      })
    }

    // One operator alert per booking so the portal badge + notification list are
    // populated. status SENT (terminal) — the demo skips the QUEUED->SENDING lease.
    notificationValues.push({
      bookingId: seedId(b.id),
      operatorId: seedId(b.operatorId),
      kind: 'OPERATOR_BOOKING_ALERT' as const,
      channel: 'EMAIL',
      recipient: ownerEmailByOperator.get(b.operatorId) ?? 'owner@example.test',
      locale: 'en',
      status: 'SENT' as const,
      providerMessageId: `demo-${b.id}`,
      attempts: 1,
      idempotencyKey: `booking:${seedId(b.id)}:OPERATOR_BOOKING_ALERT`,
    })
  }

  await db.insert(bookings).values(bookingValues)
  await db.insert(bookingEvents).values(eventValues)
  await db.insert(notificationLog).values(notificationValues)

  console.log(
    `\nSeeded ${DEMO_RENTERS.length} renters, ${bookingValues.length} bookings, ` +
      `${eventValues.length} events, ${notificationValues.length} notifications.`,
  )
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed bookings failed:', err)
  process.exit(1)
})
