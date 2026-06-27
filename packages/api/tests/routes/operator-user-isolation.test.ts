import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory/location'
import { InMemoryThreadRepository } from '../../src/repositories/in-memory/thread'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../../src/repositories/in-memory/vehicle-block'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory/vehicle-class'
import type { Location, User, Vehicle, VehicleClass } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

// #396 — UserRepository is intentionally NOT operator-scoped (it takes no
// CallerContext). This is safe today because every ingress that reaches it
// already blocks an OPERATOR_* caller from resolving an ARBITRARY user:
// /customers is STAFF-gated, /users treats non-privileged callers as self-only,
// and the booking paths are operator-SCOPED (slice 6, #392) — an operator only
// ever sees its OWN tenant's bookings, so renter enrichment can only resolve
// that operator's own customers, never a foreign tenant's renter.
//
// These tests PIN those closures so the latent enumeration vector cannot
// silently reopen if a route's gate is weakened. Renters remain shared
// marketplace customers (users.operatorId is nullable) and are deliberately
// NOT filtered per operator — see the issue plan / Track decision.

const OPERATOR_ID = 'op_396'
const OTHER_OPERATOR_ID = 'op_other'
const SELF_ID = '00000000-0000-4000-8000-00000000005f' // the operator's own user id
const OWN_RENTER_ID = '00000000-0000-4000-8000-00000000001a' // a renter of OPERATOR_ID
const FOREIGN_ID = '00000000-0000-4000-8000-0000000000f0' // a renter of another tenant

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

async function partnerBearer(sub: string): Promise<Record<string, string>> {
  // PARTNER (Trip.com) carries NO operatorId — it is a cross-channel booking
  // caller, not a tenant. toCallerContext only attaches operatorId for
  // OPERATOR_* roles, so this mirrors a real partner key.
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ sub, role: 'PARTNER' })
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
  let locationId: string

  beforeEach(async () => {
    setupAuthEnv()

    const userStore = new Map<string, User>([
      // The operator's own users row carries its operatorId (set at sign-in via
      // setOperatorAccess) — the #939 session-revocation check re-reads it, so the
      // projection must match the operatorId the token claims.
      [SELF_ID, { ...mkUser(SELF_ID, 'OPERATOR_OWNER'), operatorId: OPERATOR_ID }],
      [OWN_RENTER_ID, mkUser(OWN_RENTER_ID, 'RENTER')],
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

    const locationRepo = new InMemoryLocationRepository()
    const location = await locationRepo.create({
      operatorId: OPERATOR_ID,
      name: 'Namba',
      address: '1-2-3 Namba',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
      status: 'ACTIVE',
    } as Omit<Location, 'id' | 'createdAt' | 'updatedAt'>)
    locationId = location.id

    // Vehicle is in the operator's own tenant + pickup location, so an operator
    // booking for SELF succeeds — proving the renterId is forced to self (not an
    // incidental failure) and the foreign id is never looked up.
    const now = new Date()
    vehicle = {
      id: crypto.randomUUID(),
      operatorId: OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
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
      shakenExpiryDate: '2099-06-15',
      insuranceExpiryDate: '2099-01-01',
      createdAt: now,
      updatedAt: now,
    }
    const vehicleRepo = new InMemoryVehicleRepository(new Map([[vehicle.id, vehicle]]))
    bookingRepo = new InMemoryBookingRepository()
    threadRepo = new InMemoryThreadRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo,
      bookingRepo,
      new InMemoryVehicleBlockRepository(),
    )

    app = createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      userRepo,
      vehicleClassRepo,
      threadRepo,
      locationRepo,
    })
  })

  it('GET /customers is STAFF-gated — operator gets 403', async () => {
    const res = await app.request('/customers', { headers: await operatorBearer(SELF_ID) })
    expect(res.status).toBe(403)
  })

  it('GET /customers/search returns only the operator’s own-tenant (prior-booking) renters, never a foreign tenant’s', async () => {
    // #589: operator manual-booking needs to find an existing customer, but the
    // search MUST stay #396-safe — scoped to renters who have booked with THIS
    // operator. OWN_RENTER booked with OPERATOR_ID (in scope); FOREIGN booked with
    // another tenant (out of scope). Both mkUser names contain "User", so a hit on
    // FOREIGN would prove an enumeration leak, not an incidental text match.
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OPERATOR_ID,
        renterId: OWN_RENTER_ID,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
    )
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OTHER_OPERATOR_ID,
        renterId: FOREIGN_ID,
        requestedVehicleId: 'veh-foreign',
        assignedVehicleId: 'veh-foreign',
      }),
    )

    const res = await app.request('/customers/search?q=User', {
      headers: await operatorBearer(SELF_ID),
    })

    expect(res.status).toBe(200)
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((u) => u.id)
    expect(ids).toContain(OWN_RENTER_ID)
    expect(ids).not.toContain(FOREIGN_ID)
  })

  it('GET /customers (full list) stays STAFF-gated — operator still gets 403', async () => {
    const res = await app.request('/customers', { headers: await operatorBearer(SELF_ID) })
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

  it('GET /bookings?expand=renter resolves only the operator’s own tenant renters, never a foreign tenant’s', async () => {
    // One booking in the operator's own tenant (renter OWN_RENTER) and one in a
    // foreign tenant (renter FOREIGN). The three-way scope filters the foreign
    // booking out in findAll, BEFORE renter enrichment runs — so the operator
    // can resolve its own customer but FOREIGN is never looked up (#396).
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OPERATOR_ID,
        renterId: OWN_RENTER_ID,
        requestedVehicleId: 'veh-own',
        assignedVehicleId: 'veh-own',
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
    )
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OTHER_OPERATOR_ID,
        renterId: FOREIGN_ID,
        requestedVehicleId: 'veh-foreign',
        assignedVehicleId: 'veh-foreign',
      }),
    )

    const res = await app.request('/bookings?expand=renter', {
      headers: await operatorBearer(SELF_ID),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { renterId: string; renter?: { id: string } }[]
    }
    // Only the operator's own tenant booking is visible + enriched.
    expect(body.data.map((b) => b.renterId)).toEqual([OWN_RENTER_ID])
    expect(body.data[0]?.renter?.id).toBe(OWN_RENTER_ID)
    // Enrichment ran for the own renter but NEVER for the foreign tenant's renter.
    expect(userRepo.findByIdsArgs.flat()).toContain(OWN_RENTER_ID)
    expect(userRepo.findByIdsArgs.flat()).not.toContain(FOREIGN_ID)
  })

  it('GET /bookings?expand=vehicle,renter enriches only the operator’s own tenant, never a foreign tenant’s', async () => {
    // Own booking is on the operator's real vehicle (so the vehicle branch
    // resolves a name); the foreign booking is in another tenant. The three-way
    // scope drops the foreign booking in findAll, BEFORE either enrichment runs.
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OPERATOR_ID,
        renterId: OWN_RENTER_ID,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
    )
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OTHER_OPERATOR_ID,
        renterId: FOREIGN_ID,
        requestedVehicleId: 'veh-foreign',
        assignedVehicleId: 'veh-foreign',
      }),
    )

    const res = await app.request('/bookings?expand=vehicle,renter', {
      headers: await operatorBearer(SELF_ID),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { renterId: string; vehicle?: { name: string }; renter?: { id: string } }[]
    }
    // Only the operator's own booking is visible, with both projections resolved
    // from its own tenant.
    expect(body.data.map((b) => b.renterId)).toEqual([OWN_RENTER_ID])
    expect(body.data[0]?.vehicle?.name).toBe('Test Car')
    expect(body.data[0]?.renter?.id).toBe(OWN_RENTER_ID)
    // Renter enrichment ran for the own renter but NEVER for the foreign tenant's.
    expect(userRepo.findByIdsArgs.flat()).toContain(OWN_RENTER_ID)
    expect(userRepo.findByIdsArgs.flat()).not.toContain(FOREIGN_ID)
  })

  it('POST /bookings rejects an operator booking for a renter outside its customers — uniform 403, no user-table probe', async () => {
    // #589: the operator is now a manual booker, so the route lets renterId
    // through — but FOREIGN has never booked with this operator, so the service
    // 403s on scope membership. The check is scope-FIRST (prior-booking set), so
    // it never probes the user table for FOREIGN: a real vs non-existent id are
    // indistinguishable (no enumeration oracle, #396/#475).
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        renterId: FOREIGN_ID,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(403)
    expect(userRepo.findByIdsArgs.flat()).not.toContain(FOREIGN_ID)
  })

  it('POST /bookings lets an operator manually book for its own prior-booking customer (source=MANUAL)', async () => {
    // OWN_RENTER has a prior booking with this operator → a customer in scope.
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OPERATOR_ID,
        renterId: OWN_RENTER_ID,
        requestedVehicleId: 'veh-prior',
        assignedVehicleId: 'veh-prior',
      }),
    )

    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        renterId: OWN_RENTER_ID,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { renterId: string; source: string } }
    expect(body.data.renterId).toBe(OWN_RENTER_ID)
    expect(body.data.source).toBe('MANUAL')
  })

  it('operator walk-in booking creates a fresh RENTER and books for them (#589 1c, source=MANUAL)', async () => {
    // A brand-new walk-in/phone customer the operator registers inline: no prior
    // booking, no renterId — the walk-in itself is the authorization.
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        walkInCustomer: { name: 'Hanako Tourist', phone: '+81-90-0000-1111' },
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { renterId: string; source: string } }
    expect(body.data.source).toBe('MANUAL')
    // A brand-new renter — not the operator, not any seeded user.
    expect(body.data.renterId).not.toBe(SELF_ID)
    expect([OWN_RENTER_ID, FOREIGN_ID]).not.toContain(body.data.renterId)
    const [created] = await userRepo.findByIds([body.data.renterId])
    expect(created?.role).toBe('RENTER')
    expect(created?.name).toBe('Hanako Tourist')
    expect(created?.phone).toBe('+81-90-0000-1111')
  })

  it('walk-in never attaches to an existing phone holder — fresh row even on a phone match (#396/#475)', async () => {
    // An existing renter (think: ANOTHER tenant's customer) already has this phone.
    // A walk-in with the SAME phone must NOT dedup onto them — that would attach a
    // booking to a foreign user and leak that the phone exists.
    const SHARED_PHONE = '+81-90-9999-0000'
    const existing = await userRepo.quickCreate({
      name: 'Existing Person',
      email: null,
      phone: SHARED_PHONE,
      language: 'en',
    })

    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await operatorBearer(SELF_ID)) },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        walkInCustomer: { name: 'Different Person', phone: SHARED_PHONE },
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { renterId: string } }
    expect(body.data.renterId).not.toBe(existing.id) // fresh row, no dedup-attach
    const [created] = await userRepo.findByIds([body.data.renterId])
    expect(created?.name).toBe('Different Person')
    // The pre-existing phone holder is untouched.
    const [foreign] = await userRepo.findByIds([existing.id])
    expect(foreign?.name).toBe('Existing Person')
  })
})

// #1168 — PARTNER (Trip.com) is a booking channel, NOT a cross-tenant private-data
// reader. It was in PRIVILEGED_ROLES, which gated full reads of messages, threads,
// and the user directory — and those routes gate on `requireUser` only, so a
// partner key could enumerate every tenant's private data (the same leak class
// #1119 closed for bookings). These pin that PARTNER now falls closed everywhere.
describe('#1168 — PARTNER cannot read cross-tenant private data', () => {
  const PARTNER_ID = '00000000-0000-4000-8000-0000000000aa'
  const RENTER_A = '00000000-0000-4000-8000-0000000000a1'
  const OPERATOR_B = '00000000-0000-4000-8000-0000000000b2'
  let app: ReturnType<typeof createApp>
  let threadId: string

  beforeEach(async () => {
    setupAuthEnv()
    const userStore = new Map<string, User>([
      [PARTNER_ID, mkUser(PARTNER_ID, 'PARTNER')],
      [RENTER_A, mkUser(RENTER_A, 'RENTER')],
      [OPERATOR_B, mkUser(OPERATOR_B, 'OPERATOR_OWNER')],
    ])
    const userRepo = new InMemoryUserRepository(userStore)
    const threadRepo = new InMemoryThreadRepository()
    // A renter<->operator thread the PARTNER is NOT a participant of.
    const thread = await threadRepo.create(SYSTEM_CONTEXT, null, [RENTER_A, OPERATOR_B])
    threadId = thread.id
    app = createApp({ userRepo, threadRepo })
  })

  it('GET /threads returns no other tenant’s threads — empty, not the full table', async () => {
    const res = await app.request('/threads', { headers: await partnerBearer(PARTNER_ID) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([])
  })

  it('GET /threads/:id 404s a thread the PARTNER is not a participant of', async () => {
    const res = await app.request(`/threads/${threadId}`, {
      headers: await partnerBearer(PARTNER_ID),
    })
    expect(res.status).toBe(404)
  })

  it('GET /users resolves nothing — PARTNER is not a privileged name oracle', async () => {
    const res = await app.request(`/users?ids=${RENTER_A},${OPERATOR_B}`, {
      headers: await partnerBearer(PARTNER_ID),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string }[] }
    expect(body.data).toEqual([])
  })

  it('GET /customers/search is 403 — PARTNER is neither staff nor a tenant operator (#1116 route gate)', async () => {
    const res = await app.request('/customers/search?q=User', {
      headers: await partnerBearer(PARTNER_ID),
    })
    expect(res.status).toBe(403)
  })
})
