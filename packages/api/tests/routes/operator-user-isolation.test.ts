import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryThreadRepository } from '../../src/repositories/in-memory/thread'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory/vehicle-class'
import type { User, Vehicle, VehicleClass } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// #396 — UserRepository is intentionally NOT operator-scoped (it takes no
// CallerContext). This is safe today because every ingress that reaches it
// already blocks OPERATOR_* callers: /customers is STAFF-gated, /users treats
// non-privileged callers as self-only, and the booking paths fail-close at the
// BookingRepository (rejectOperatorContextUntilScoped) before any user lookup.
//
// These tests PIN those closures so the latent enumeration vector cannot
// silently reopen if a route's gate is weakened. Renters remain shared
// marketplace customers (users.operatorId is nullable) and are deliberately
// NOT filtered per operator — see the issue plan / Track decision.

const OPERATOR_ID = 'op_396'
const SELF_ID = '00000000-0000-4000-8000-00000000005f' // the operator's own user id
const FOREIGN_ID = '00000000-0000-4000-8000-0000000000f0' // a renter in no operator

async function operatorBearer(
  sub: string,
  role: 'OPERATOR_OWNER' | 'OPERATOR_STAFF' = 'OPERATOR_OWNER',
): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ sub, role, operatorId: OPERATOR_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}` }
}

function mkUser(id: string, role: User['role']): User {
  return {
    id,
    name: `User ${id.slice(-2)}`,
    email: `${id.slice(-2)}@test.local`,
    phone: null,
    language: 'en',
    country: null,
    role,
  }
}

// Records every findByIds argument so we can prove the booking route never
// triggers an arbitrary cross-tenant user lookup for an operator caller.
class SpyUserRepository extends InMemoryUserRepository {
  readonly findByIdsArgs: string[][] = []
  override async findByIds(ids: string[]): Promise<User[]> {
    this.findByIdsArgs.push(ids)
    return super.findByIds(ids)
  }
}

describe('#396 — OPERATOR_* cannot enumerate users via any current ingress', () => {
  let app: ReturnType<typeof createApp>
  let userRepo: SpyUserRepository
  let bookingRepo: InMemoryBookingRepository
  let threadRepo: InMemoryThreadRepository
  let vehicle: Vehicle
  let classId: string

  beforeEach(async () => {
    setupAuthEnv()

    const userStore = new Map<string, User>([
      [SELF_ID, mkUser(SELF_ID, 'OPERATOR_OWNER')],
      [FOREIGN_ID, mkUser(FOREIGN_ID, 'RENTER')],
    ])
    userRepo = new SpyUserRepository(userStore)

    const vehicleClassRepo = new InMemoryVehicleClassRepository()
    const klass: VehicleClass = await vehicleClassRepo.create({
      name: 'Compact',
      slug: 'compact',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    classId = klass.id

    // Vehicle is owned by the operator's own tenant so the booking attempt gets
    // PAST vehicle scoping and fail-closes at BookingRepository — proving the
    // closure is the tenant guard, not an incidental "vehicle not found".
    const now = new Date()
    vehicle = {
      id: crypto.randomUUID(),
      operatorId: OPERATOR_ID,
      classId,
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 4,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: 'TEST-396',
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: 2,
      maxRentalHours: 168,
      advanceBookingHours: 24,
      make: 'Toyota',
      model: 'Corolla',
      year: 2024,
      color: 'White',
      dailyRateJpy: 8000,
      hourlyRateJpy: 1500,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
      createdAt: now,
      updatedAt: now,
    }
    const vehicleRepo = new InMemoryVehicleRepository(new Map([[vehicle.id, vehicle]]))
    bookingRepo = new InMemoryBookingRepository()
    threadRepo = new InMemoryThreadRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)

    app = createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      userRepo,
      vehicleClassRepo,
      threadRepo,
    })
  })

  it('GET /customers is STAFF-gated — operator gets 403', async () => {
    const res = await app.request('/customers', { headers: await operatorBearer(SELF_ID) })
    expect(res.status).toBe(403)
  })

  it('GET /customers/search is STAFF-gated — operator gets 403', async () => {
    const res = await app.request('/customers/search?q=re', {
      headers: await operatorBearer(SELF_ID),
    })
    expect(res.status).toBe(403)
  })

  it('POST /customers/quick-create is STAFF-gated — operator gets 403', async () => {
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({ name: 'Walk In', email: 'walkin@test.local', language: 'en' }),
    })
    expect(res.status).toBe(403)
  })

  it('GET /users resolves only the caller — operators excluded from thread-participant resolution', async () => {
    // Seed a thread the operator shares with FOREIGN. A RENTER in this position
    // could resolve the co-participant's name via /users; an OPERATOR_* must
    // NOT — the route's thread lookup uses a synthetic RENTER context, so
    // without an explicit operator self-only guard this would leak (#396 review).
    await threadRepo.create(SYSTEM_CONTEXT, null, [SELF_ID, FOREIGN_ID])

    const res = await app.request(`/users?ids=${SELF_ID},${FOREIGN_ID}`, {
      headers: await operatorBearer(SELF_ID),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; name: string }[] }
    expect(body.data.map((u) => u.id)).toEqual([SELF_ID])
    expect(body.data.map((u) => u.id)).not.toContain(FOREIGN_ID)
  })

  it('GET /bookings?expand=renter fail-closes before renter enrichment', async () => {
    const res = await app.request('/bookings?expand=renter', {
      headers: await operatorBearer(SELF_ID),
    })
    // BookingRepository.findAll rejects OPERATOR_* (rejectOperatorContextUntilScoped)
    // -> ForbiddenError -> 403, never reaching userRepo.findByIds(renterIds).
    expect(res.status).toBe(403)
    expect(userRepo.findByIdsArgs.flat()).not.toContain(FOREIGN_ID)
  })

  it('POST /bookings forces renterId to self — no arbitrary user lookup for a foreign renterId', async () => {
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({
        classId,
        vehicleId: vehicle.id,
        renterId: FOREIGN_ID, // attempt to book on behalf of another user
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'DIRECT',
      }),
    })

    // Operator cannot create an on-behalf booking — fail-closed at the repo
    // with a tenant-guard 403 (not an incidental 400/404 from a wrong path)...
    expect(res.status).toBe(403)
    // ...and crucially the route forced renterId = ctx.userId, so the service's
    // staff-override branch (userRepo.findByIds([renterId])) never ran for the
    // foreign id. If the route forcing regresses, this assertion catches it.
    expect(userRepo.findByIdsArgs.flat()).not.toContain(FOREIGN_ID)
  })
})
