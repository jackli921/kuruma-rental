import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { complianceAlertLog } from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleComplianceAlertLogRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { complianceAlertKey } from '../../src/repositories/types'
import type { Vehicle } from '../../src/stores'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedVehicleClass,
} from './setup'

// #652 S5: the compliance_alert_log idempotency ledger is what stops the digest
// double-alerting. The InMemory double (compliance-digest.test.ts) covers the
// contract; ONLY this proves the real `compliance_alert_log_band_unique` seal +
// record()'s onConflictDoNothing against Postgres. Scoped to freshly-created
// vehicles, so findAlertedKeys([myVehicle]) can never see another file's rows.

const vehicleRepo = new DrizzleVehicleRepository(db)
const repo = new DrizzleComplianceAlertLogRepository(db)

const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
let v1: string // tests 1, 2, 4 (SHAKEN/D30 + INSURANCE/EXPIRED)
let v2: string // reserved for the band-granularity exact-set assertion (test 3)

function makeVehicle(classId: string, name: string): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    name,
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
}

beforeAll(async () => {
  const klass = await seedVehicleClass('alertlog')
  createdClassIds.push(klass.id)
  const a = await makeVehicle(klass.id, 'AlertLog V1')
  const b = await makeVehicle(klass.id, 'AlertLog V2')
  v1 = a.id
  v2 = b.id
  createdVehicleIds.push(v1, v2)
})

afterAll(async () => {
  // compliance_alert_log.vehicleId is ON DELETE CASCADE, so dropping the vehicles
  // clears their alert rows too (schema §5.4: cleanup is a single vehicle delete).
  await cleanupVehicles(createdVehicleIds)
  await cleanupVehicleClasses(createdClassIds)
})

const alert = (
  vehicleId: string,
  documentType: 'SHAKEN' | 'INSURANCE',
  thresholdBand: 'MISSING' | 'EXPIRED' | 'D30' | 'D14' | 'D7' | 'D1',
) => ({
  operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
  vehicleId,
  documentType,
  thresholdBand,
  recipient: 'owner@op.example',
})

describe('DrizzleComplianceAlertLogRepository (#652 S5, real pg)', () => {
  it('record() then findAlertedKeys round-trips the canonical key', async () => {
    await repo.record(alert(v1, 'SHAKEN', 'D30'))
    const keys = await repo.findAlertedKeys([v1])
    expect(keys.has(complianceAlertKey(v1, 'SHAKEN', 'D30'))).toBe(true)
  })

  it('is idempotent on a duplicate (vehicle, doc, band): no second row, no throw', async () => {
    const dup = alert(v1, 'INSURANCE', 'EXPIRED')
    await repo.record(dup)
    // A same-band re-run (even with a different recipient) hits the unique seal +
    // onConflictDoNothing — it resolves without throwing and writes nothing new.
    await expect(
      repo.record({ ...dup, recipient: 'someone-else@op.example' }),
    ).resolves.toBeUndefined()
    const rows = await db
      .select({ id: complianceAlertLog.id, recipient: complianceAlertLog.recipient })
      .from(complianceAlertLog)
      .where(
        and(
          eq(complianceAlertLog.vehicleId, v1),
          eq(complianceAlertLog.documentType, 'INSURANCE'),
          eq(complianceAlertLog.thresholdBand, 'EXPIRED'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.recipient).toBe('owner@op.example') // first write wins; the conflict was a no-op
  })

  it('treats each band and document as a distinct alert (a vehicle re-alerts as it counts down)', async () => {
    await repo.record(alert(v2, 'SHAKEN', 'D30'))
    await repo.record(alert(v2, 'SHAKEN', 'D14'))
    await repo.record(alert(v2, 'INSURANCE', 'D30'))
    const keys = await repo.findAlertedKeys([v2])
    expect(keys).toEqual(
      new Set([
        complianceAlertKey(v2, 'SHAKEN', 'D30'),
        complianceAlertKey(v2, 'SHAKEN', 'D14'),
        complianceAlertKey(v2, 'INSURANCE', 'D30'),
      ]),
    )
  })

  it('findAlertedKeys scopes strictly to the requested vehicles; [] → empty set', async () => {
    expect((await repo.findAlertedKeys([])).size).toBe(0)
    const v1keys = await repo.findAlertedKeys([v1])
    expect(v1keys.size).toBeGreaterThan(0)
    // every returned key belongs to v1 — v2's rows never leak into a v1 query
    expect([...v1keys].every((k) => k.startsWith(`${v1}|`))).toBe(true)
  })
})
