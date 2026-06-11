import { createHash, randomBytes } from 'node:crypto'
import { getDb } from './index'
import { parsePlatformAdminEmails } from './platform-admins'
import {
  feeSchedules,
  insuranceOptions,
  locations,
  operators,
  providerInvites,
  users,
  vehicleClasses,
  vehicles,
} from './schema'
import {
  DEMO_FEE_SCHEDULES,
  DEMO_INSURANCE_OPTIONS,
  DEMO_LOCATIONS,
  DEMO_OPERATORS,
  DEMO_VEHICLES,
  DEMO_VEHICLE_CLASSES,
} from './seed-data'
import { seedId } from './seed-id'

/**
 * Slice 8 marketplace demo seed (#390, plan §3-§4). Rewrites the legacy
 * single-operator seed into the credibility floor: 3 operators × 3 locations ×
 * ~41 vehicles across 8 ACRISS codes, plus insurance + fee schedules. The pure
 * fixtures live in `seed-data/` (unit-tested for the invariants); this file is
 * the idempotent DB orchestrator.
 *
 * Idempotency: every fixture carries a STABLE explicit id, so each row is
 * upserted on its primary key. Re-seeding a warm branch updates in place and
 * leaves row counts stable (no delete/insert churn, no FK-order coupling to the
 * slice-6 booking tables — `seed-bookings.ts` owns those). Parents are written
 * before children so the composite FKs (operatorId, classId) /
 * (operatorId, pickupLocationId) always resolve.
 *
 * `db:seed` then `db:seed-bookings` per CLAUDE.md ordering.
 */

const SHAKEN_VALIDITY_DAYS = 365
// Mirrors ProviderInviteService.INVITE_TTL_MS — a demo link is good for a week.
const DEMO_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Demo-time-relative shaken expiry — a frozen fixture date would go stale. */
function demoShakenExpiry(): string {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + SHAKEN_VALIDITY_DAYS)
  return expiry.toISOString().slice(0, 10)
}

async function seed() {
  const db = getDb()
  const now = new Date()

  // 1. Operators (tenant roots). vehicles/classes/locations all FK to these, so
  // they go first. Upsert on id keeps the row (and its FK-target id) stable.
  console.log(`Seeding ${DEMO_OPERATORS.length} operators...`)
  for (const op of DEMO_OPERATORS) {
    await db
      .insert(operators)
      .values({
        id: seedId(op.id),
        slug: op.slug,
        name: op.name,
        preAuthHandoffUrl: op.preAuthHandoffUrl,
      })
      .onConflictDoUpdate({
        target: operators.id,
        set: {
          slug: op.slug,
          name: op.name,
          preAuthHandoffUrl: op.preAuthHandoffUrl,
          updatedAt: now,
        },
      })
  }

  // 2. One OPERATOR_OWNER login per operator so the demo can sign into each
  // portal. Upsert on email re-asserts role + tenant rather than duplicating.
  // DEMO_OWNER_EMAIL (optional) rebinds the first operator's owner login to your
  // own email, so a single Google account can both book as a renter and view the
  // operator portal in a local demo. No-op when unset (cf. PLATFORM_ADMIN_EMAILS).
  const demoOwnerEmail = process.env.DEMO_OWNER_EMAIL?.trim()
  console.log('Seeding operator owners...')
  for (const [index, op] of DEMO_OPERATORS.entries()) {
    const email = demoOwnerEmail && index === 0 ? demoOwnerEmail : op.owner.email
    await db
      .insert(users)
      .values({
        name: op.owner.name,
        email,
        role: 'OPERATOR_OWNER',
        operatorId: seedId(op.id),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: op.owner.name,
          role: 'OPERATOR_OWNER',
          operatorId: seedId(op.id),
          updatedAt: now,
        },
      })
  }

  // 3. Platform-admin bootstrap (proposal §9 item 23, plan §3.6). Upsert the
  // CURRENT PLATFORM_ADMIN_EMAILS allowlist keyed on email: inserts a fresh
  // admin or promotes an existing user, clearing any tenant (an admin belongs to
  // no operator, §6.2). A stale admin dropped from the list is LEFT in place —
  // the no-schema choice (§3.6); we never blanket-demote. No-op when unset.
  const adminEmails = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)
  if (adminEmails.length > 0) {
    console.log(`Upserting ${adminEmails.length} platform admin(s)...`)
    for (const email of adminEmails) {
      await db
        .insert(users)
        .values({ email, role: 'PLATFORM_ADMIN', operatorId: null })
        .onConflictDoUpdate({
          target: users.email,
          set: { role: 'PLATFORM_ADMIN', operatorId: null, updatedAt: now },
        })
    }
  }

  // 4. Vehicle classes — composite-FK target for vehicles + per-class fees, so
  // they precede both. Upsert on id keeps the (operatorId, id) target stable.
  console.log(`Seeding ${DEMO_VEHICLE_CLASSES.length} vehicle classes...`)
  for (const cls of DEMO_VEHICLE_CLASSES) {
    await db
      .insert(vehicleClasses)
      .values({
        id: seedId(cls.id),
        operatorId: seedId(cls.operatorId),
        name: cls.name,
        slug: cls.slug,
        description: cls.description,
        acrissCode: cls.acrissCode,
        seats: cls.seats,
        luggageCapacity: cls.luggageCapacity,
        luggageSize: cls.luggageSize,
        transmission: cls.transmission,
        fuelType: cls.fuelType,
        sortOrder: cls.sortOrder,
      })
      .onConflictDoUpdate({
        target: vehicleClasses.id,
        set: {
          name: cls.name,
          slug: cls.slug,
          acrissCode: cls.acrissCode,
          seats: cls.seats,
          luggageCapacity: cls.luggageCapacity,
          luggageSize: cls.luggageSize,
          sortOrder: cls.sortOrder,
          updatedAt: now,
        },
      })
  }

  // 5. Locations — composite-FK target for vehicles' pickupLocationId.
  console.log(`Seeding ${DEMO_LOCATIONS.length} locations...`)
  for (const loc of DEMO_LOCATIONS) {
    await db
      .insert(locations)
      .values({
        id: seedId(loc.id),
        operatorId: seedId(loc.operatorId),
        name: loc.name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timezone: loc.timezone,
        defaultTurnaroundMinutes: loc.defaultTurnaroundMinutes,
      })
      .onConflictDoUpdate({
        target: locations.id,
        set: {
          name: loc.name,
          address: loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
          timezone: loc.timezone,
          defaultTurnaroundMinutes: loc.defaultTurnaroundMinutes,
          updatedAt: now,
        },
      })
  }

  // 6. Insurance options (slice 4a). Renter selects one at booking (slice 6).
  console.log(`Seeding ${DEMO_INSURANCE_OPTIONS.length} insurance options...`)
  for (const opt of DEMO_INSURANCE_OPTIONS) {
    await db
      .insert(insuranceOptions)
      .values({
        id: seedId(opt.id),
        operatorId: seedId(opt.operatorId),
        name: opt.name,
        description: opt.description,
        dailyPriceJpy: opt.dailyPriceJpy,
        deductibleJpy: opt.deductibleJpy,
      })
      .onConflictDoUpdate({
        target: insuranceOptions.id,
        set: {
          name: opt.name,
          description: opt.description,
          dailyPriceJpy: opt.dailyPriceJpy,
          deductibleJpy: opt.deductibleJpy,
          updatedAt: now,
        },
      })
  }

  // 7. Fee schedules (slice 4b). Per-class rows seal to a class of the same
  // operator (fee_schedules_operator_class_fk) — classes are already seeded (§4).
  console.log(`Seeding ${DEMO_FEE_SCHEDULES.length} fee schedules...`)
  for (const fee of DEMO_FEE_SCHEDULES) {
    await db
      .insert(feeSchedules)
      .values({
        id: seedId(fee.id),
        operatorId: seedId(fee.operatorId),
        vehicleClassId: fee.vehicleClassId ? seedId(fee.vehicleClassId) : null,
        feeType: fee.feeType,
        unit: fee.unit,
        amountJpy: fee.amountJpy,
      })
      .onConflictDoUpdate({
        target: feeSchedules.id,
        set: { feeType: fee.feeType, unit: fee.unit, amountJpy: fee.amountJpy, updatedAt: now },
      })
  }

  // 8. Vehicles — both composite FKs resolve now (classes + locations seeded).
  // shakenExpiryDate is stamped demo-time-relative (fixtures omit it, §3.3).
  console.log(`Seeding ${DEMO_VEHICLES.length} vehicles...`)
  const shakenExpiryDate = demoShakenExpiry()
  for (const v of DEMO_VEHICLES) {
    await db
      .insert(vehicles)
      .values({
        id: seedId(v.id),
        operatorId: seedId(v.operatorId),
        classId: seedId(v.classId),
        pickupLocationId: seedId(v.pickupLocationId),
        name: v.name,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        seats: v.seats,
        transmission: v.transmission,
        fuelType: v.fuelType,
        licensePlate: v.licensePlate,
        dailyRateJpy: v.dailyRateJpy,
        hourlyRateJpy: v.hourlyRateJpy,
        shakenExpiryDate,
      })
      .onConflictDoUpdate({
        target: vehicles.id,
        set: {
          classId: seedId(v.classId),
          pickupLocationId: seedId(v.pickupLocationId),
          name: v.name,
          dailyRateJpy: v.dailyRateJpy,
          hourlyRateJpy: v.hourlyRateJpy,
          shakenExpiryDate,
          updatedAt: now,
        },
      })
  }

  // 9. Demo provider invite (#521 §9) — env-driven so no email is hardcoded.
  // When DEMO_PROVIDER_INVITE_EMAIL is set, mint a one-time invite for the first
  // demo operator so the runbook (#488) can click through provider sign-up. Only
  // sha256(token) is stored; the plaintext link is printed once here, never
  // persisted (mirrors the admin endpoint). A STABLE id keeps re-seeds
  // idempotent — each run rotates the token and resets the invite to PENDING so
  // the demo can be replayed even after acceptance.
  const demoInviteEmail = process.env.DEMO_PROVIDER_INVITE_EMAIL?.trim().toLowerCase()
  const [demoOperator] = DEMO_OPERATORS
  if (demoInviteEmail && demoOperator) {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(now.getTime() + DEMO_INVITE_TTL_MS)
    const webBase = (
      process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:3001'
    ).replace(/\/$/, '')
    await db
      .insert(providerInvites)
      .values({
        id: seedId('demo-provider-invite'),
        email: demoInviteEmail,
        operatorId: seedId(demoOperator.id),
        role: 'OPERATOR_OWNER',
        tokenHash,
        status: 'PENDING',
        expiresAt,
        acceptedByUserId: null,
      })
      .onConflictDoUpdate({
        target: providerInvites.id,
        set: {
          email: demoInviteEmail,
          operatorId: seedId(demoOperator.id),
          tokenHash,
          status: 'PENDING',
          expiresAt,
          acceptedByUserId: null,
          updatedAt: now,
        },
      })
    console.log(`\nDemo provider invite for ${demoInviteEmail} (operator: ${demoOperator.slug}):`)
    console.log(`  ${webBase}/provider/invite/${token}`)
  }

  console.log(
    `\nSeeded ${DEMO_OPERATORS.length} operators, ${DEMO_LOCATIONS.length} locations, ` +
      `${DEMO_VEHICLE_CLASSES.length} classes, ${DEMO_VEHICLES.length} vehicles, ` +
      `${DEMO_INSURANCE_OPTIONS.length} insurance options, ${DEMO_FEE_SCHEDULES.length} fee schedules.`,
  )
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
