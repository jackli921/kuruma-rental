import { locations, operators, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { PUBLIC_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleRegionRepository,
  DrizzleStorefrontRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { StorefrontSearchService } from '../../src/services/storefront-search'
import type { Location } from '../../src/stores'
import { setupAuthEnv, signTestJwt } from '../helpers/auth'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1262: the operator-authored-inventory loop, end to end. Before this slice the
// fleet vehicle form omitted the pickup-location picker, so a UI-created vehicle
// always had pickupLocationId = null and never surfaced to renters (storefront
// search groups available cars by pickupLocationId — a null-location car is
// dropped). This suite proves the fixed contract from the write side: an OPERATOR
// session POSTs a vehicle at its own ACTIVE location, and that vehicle is then
// discoverable through the SAME availability scan + storefront card a renter hits.
// The form's ability to SET the location is covered by the web VehicleForm tests;
// this proves the value it now writes actually makes the car bookable.

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opId = `op_plsf_${uniq}`
const ownerUserId = crypto.randomUUID()

// A fixed future availability window. Operating hours are a booking-time concern,
// not part of the availability listing, so any future slot works (mirrors
// storefronts.test.ts). Far-future doc expiries keep the §5.2 gate satisfied.
const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

const availabilityRepo = new DrizzleAvailabilityRepository(db)
const storefrontSearch = new StorefrontSearchService(
  new DrizzleStorefrontRepository(db),
  availabilityRepo,
  new DrizzleVehicleClassRepository(db),
  new DrizzleRegionRepository(db),
)

let app: ReturnType<typeof createApp>
let headers: Record<string, string>
let location: Location
let classId: string
let locatedVehicleId: string

const vehicleBody = (extra: Record<string, unknown>) => ({
  name: `Toyota Aqua ${uniq}`,
  classId,
  seats: 5,
  transmission: 'AUTO' as const,
  bufferMinutes: 60,
  dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
  // #916: create requires future-dated shaken + insurance (§5.0).
  shakenExpiryDate: '2099-06-15',
  insuranceExpiryDate: '2099-01-01',
  ...extra,
})

const createVehicle = (body: unknown) =>
  app.request('/vehicles', { method: 'POST', headers, body: JSON.stringify(body) })

beforeAll(async () => {
  setupAuthEnv()
  await db.insert(operators).values({ id: opId, slug: `plsf-${uniq}`, name: 'PLSF Operator' })

  const locationRepo = new DrizzleLocationRepository(db)
  location = await locationRepo.create({
    operatorId: opId,
    name: `Namba ${uniq}`,
    address: '1-1 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    status: 'ACTIVE',
  })

  const [klass] = await db
    .insert(vehicleClasses)
    .values({
      id: crypto.randomUUID(),
      operatorId: opId,
      name: `Compact ${uniq}`,
      slug: `class-compact-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      acrissCode: 'CCAR',
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    .returning({ id: vehicleClasses.id })
  if (!klass) throw new Error('failed to seed class')
  classId = klass.id

  app = createApp({
    vehicleRepo: new DrizzleVehicleRepository(db),
    bookingRepo: new DrizzleBookingRepository(db),
    availabilityRepo,
    locationRepo,
  })
  // Operator session: the operatorId rides in the JWT. The fleet form never names
  // a tenant (the client can't), so the body carries NO operatorId — the service
  // derives it from the session, exactly like a cookie-authed operator would.
  const token = await signTestJwt({ sub: ownerUserId, role: 'OPERATOR_OWNER', operatorId: opId })
  headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // A baseline bookable car AT the location — a live positive control so the
  // null-location test can prove the availability scan actually returns rows
  // (not a vacuously-empty result) before asserting the homeless car is absent.
  const baseline = await createVehicle(
    vehicleBody({ name: `Baseline ${uniq}`, pickupLocationId: location.id }),
  )
  locatedVehicleId = (await baseline.json()).data.id
})

afterAll(async () => {
  await db.delete(vehicles).where(eq(vehicles.operatorId, opId))
  await db.delete(vehicleClasses).where(eq(vehicleClasses.operatorId, opId))
  await db.delete(locations).where(eq(locations.operatorId, opId))
  await db.delete(operators).where(eq(operators.id, opId))
})

describe('a UI-created vehicle surfaces in storefront search (#1262)', () => {
  it('POSTs a vehicle at the operator’s location and a renter finds it there', async () => {
    const res = await createVehicle(vehicleBody({ pickupLocationId: location.id }))
    expect(res.status).toBe(201)
    const created = (await res.json()).data
    expect(created.pickupLocationId).toBe(location.id)

    // The exact availability scan storefront search runs: the new vehicle is
    // discoverable at its location for a future window (id AND name pinned).
    const available = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: location.id,
    })
    const found = available.find((v) => v.id === created.id)
    expect(found?.name).toBe(`Toyota Aqua ${uniq}`)

    // End-to-end renter path: searching the storefront by the operator’s new
    // location returns a card whose class summary counts the newly-created car.
    const result = await storefrontSearch.search(PUBLIC_CONTEXT, {
      from: FROM,
      to: TO,
      pickupLocationId: location.id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('storefront search returned an error result')
    const card = result.data.storefronts.find((s) => s.locationId === location.id)
    const availableInCard =
      card?.classSummaries.reduce((sum, cs) => sum + cs.availableCount, 0) ?? 0
    expect(availableInCard).toBeGreaterThanOrEqual(1)
  })

  it('a vehicle created with NO pickup location stays invisible to renters (the pre-#1262 gap)', async () => {
    const res = await createVehicle(vehicleBody({ name: `Homeless Car ${uniq}` }))
    expect(res.status).toBe(201)
    const created = (await res.json()).data
    expect(created.pickupLocationId).toBeNull()

    // A null pickupLocationId is grouped out of every storefront card, so the
    // renter never sees it — exactly the invisibility #1262 lets the operator fix.
    const available = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: location.id,
    })
    // Positive control: the scan IS live (the baseline located car is returned),
    // so the homeless car's absence is a real exclusion, not an empty result.
    expect(available.map((v) => v.id)).toContain(locatedVehicleId)
    expect(available.map((v) => v.id)).not.toContain(created.id)
  })
})
