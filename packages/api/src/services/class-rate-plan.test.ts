import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../middleware/auth'
import { InMemoryClassRatePlanRepository } from '../repositories/in-memory/class-rate-plan'
import type { ClassRatePlan, Location, VehicleClass } from '../stores'
import { ClassRatePlanService } from './class-rate-plan'

const OPERATOR_ID = 'op_test'
const OTHER_OPERATOR_ID = 'op_other'
const CLASS_ID = 'cls_test'
const LOCATION_ID = 'loc_test'

const operatorCtx: CallerContext = {
  userId: 'user_owner',
  role: 'OPERATOR_OWNER',
  operatorId: OPERATOR_ID,
}

function makeClass(overrides: Partial<VehicleClass> = {}): VehicleClass {
  return {
    id: CLASS_ID,
    operatorId: OPERATOR_ID,
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'SMALL',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: LOCATION_ID,
    operatorId: OPERATOR_ID,
    name: 'Osaka Station',
    address: '1-1 Umeda',
    latitude: null,
    longitude: null,
    coordinateSource: null,
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    regionId: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makePlanData(
  overrides: Partial<Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OPERATOR_ID,
    classId: CLASS_ID,
    pickupLocationId: LOCATION_ID,
    dayRateJpy: 8000,
    isActive: true,
    label: null,
    ...overrides,
  }
}

type ClassRepoStub = {
  findById: (ctx: CallerContext, id: string) => Promise<VehicleClass | undefined>
}

type LocationRepoStub = {
  findById: (ctx: CallerContext, id: string) => Promise<Location | undefined>
}

function setup(
  cls: VehicleClass | undefined = makeClass(),
  loc: Location | undefined = makeLocation(),
) {
  const repo = new InMemoryClassRatePlanRepository()
  const classRepo: ClassRepoStub = {
    findById: async (_ctx, id) => (id === CLASS_ID ? cls : undefined),
  }
  const locationRepo: LocationRepoStub = {
    findById: async (_ctx, id) => (id === LOCATION_ID ? loc : undefined),
  }
  const service = new ClassRatePlanService(repo, classRepo, locationRepo)
  return { repo, service }
}

// ---- create ----------------------------------------------------------------

describe('ClassRatePlanService.create', () => {
  it('succeeds for an active class + location', async () => {
    const { service } = setup()

    const result = await service.create(operatorCtx, makePlanData())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.classId).toBe(CLASS_ID)
    expect(result.plan.pickupLocationId).toBe(LOCATION_ID)
    expect(result.plan.operatorId).toBe(OPERATOR_ID)
  })

  it('rejects a duplicate scope with 409', async () => {
    const { service } = setup()

    const data = makePlanData()
    await service.create(operatorCtx, data)
    const result = await service.create(operatorCtx, data)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
  })

  it('rejects an archived class with 400 INVALID_VEHICLE_CLASS', async () => {
    const { service } = setup(makeClass({ status: 'ARCHIVED' }))

    const result = await service.create(operatorCtx, makePlanData())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.code).toBe('INVALID_VEHICLE_CLASS')
  })

  it('rejects an archived location with 400 INVALID_LOCATION', async () => {
    const { service } = setup(makeClass(), makeLocation({ status: 'ARCHIVED' }))

    const result = await service.create(operatorCtx, makePlanData())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.code).toBe('INVALID_LOCATION')
  })

  it('rejects a cross-operator location with 400 INVALID_LOCATION', async () => {
    const { service } = setup(makeClass(), makeLocation({ operatorId: OTHER_OPERATOR_ID }))

    const result = await service.create(operatorCtx, makePlanData())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.code).toBe('INVALID_LOCATION')
  })

  it('rejects a cross-operator CLASS with 400 INVALID_VEHICLE_CLASS', async () => {
    const { service } = setup(makeClass({ operatorId: OTHER_OPERATOR_ID }), makeLocation())

    const result = await service.create(operatorCtx, makePlanData())

    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_VEHICLE_CLASS' })
  })

  it('rejects an INACTIVE deal against an archived class with 400 INVALID_VEHICLE_CLASS', async () => {
    const svc = new ClassRatePlanService(
      new InMemoryClassRatePlanRepository(),
      {
        findById: async (_ctx, id) =>
          id === CLASS_ID ? makeClass({ status: 'ARCHIVED' }) : undefined,
      },
      { findById: async (_ctx, id) => (id === LOCATION_ID ? makeLocation() : undefined) },
    )

    const result = await svc.create(operatorCtx, makePlanData({ isActive: false }))

    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_VEHICLE_CLASS' })
  })
})

// ---- update ----------------------------------------------------------------

describe('ClassRatePlanService.update', () => {
  it('returns 404 for an unknown id', async () => {
    const { service } = setup()

    const result = await service.update(operatorCtx, 'does-not-exist', { dayRateJpy: 1 })

    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('denies a fleet-write outside the acting operator (tenancy denial)', async () => {
    const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const { service, repo } = setup()
    const plan = await repo.create(makePlanData())

    // Admin names a DIFFERENT operator — not-in-scope -> 404
    const result = await service.update(adminCtx, plan.id, { dayRateJpy: 1 }, OTHER_OPERATOR_ID)

    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('rejects an activation update against an archived class with 400', async () => {
    // Create with active class, then update the repo stub to archived
    const repo = new InMemoryClassRatePlanRepository()
    const archivedClass = makeClass({ status: 'ARCHIVED' })
    const classRepo: ClassRepoStub = {
      findById: async (_ctx, id) => (id === CLASS_ID ? archivedClass : undefined),
    }
    const locationRepo: LocationRepoStub = {
      findById: async (_ctx, id) => (id === LOCATION_ID ? makeLocation() : undefined),
    }
    // Seed an inactive plan directly into the repo
    const plan = await repo.create({
      operatorId: OPERATOR_ID,
      classId: CLASS_ID,
      pickupLocationId: LOCATION_ID,
      dayRateJpy: 8000,
      isActive: false,
      label: null,
    })
    const service = new ClassRatePlanService(repo, classRepo, locationRepo)

    const result = await service.update(operatorCtx, plan.id, { isActive: true })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.code).toBe('INVALID_VEHICLE_CLASS')
  })

  it('allows deactivation (isActive=false) even if class is archived', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const archivedClass = makeClass({ status: 'ARCHIVED' })
    const classRepo: ClassRepoStub = {
      findById: async (_ctx, id) => (id === CLASS_ID ? archivedClass : undefined),
    }
    const locationRepo: LocationRepoStub = {
      findById: async (_ctx, id) => (id === LOCATION_ID ? makeLocation() : undefined),
    }
    const plan = await repo.create({
      operatorId: OPERATOR_ID,
      classId: CLASS_ID,
      pickupLocationId: LOCATION_ID,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const service = new ClassRatePlanService(repo, classRepo, locationRepo)

    const result = await service.update(operatorCtx, plan.id, { isActive: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.isActive).toBe(false)
  })

  it('update retarget to an already-occupied (class, location) returns 409', async () => {
    const LOCATION_ID2 = 'loc_test2'
    const repo = new InMemoryClassRatePlanRepository()
    // Stub location repo: echoes the requested id back so any location looks active+owned
    const locationRepo: LocationRepoStub = {
      findById: async (_ctx, id) => makeLocation({ id, operatorId: OPERATOR_ID, status: 'ACTIVE' }),
    }
    const classRepo: ClassRepoStub = {
      findById: async (_ctx, id) => (id === CLASS_ID ? makeClass() : undefined),
    }
    const service = new ClassRatePlanService(repo, classRepo, locationRepo)

    // Seed two active deals for the same operator: one at LOC, one at LOC2
    const plan1 = await repo.create({
      operatorId: OPERATOR_ID,
      classId: CLASS_ID,
      pickupLocationId: LOCATION_ID,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    await repo.create({
      operatorId: OPERATOR_ID,
      classId: CLASS_ID,
      pickupLocationId: LOCATION_ID2,
      dayRateJpy: 9000,
      isActive: true,
      label: null,
    })

    // Retarget plan1 to LOC2 — already occupied by plan2
    const result = await service.update(operatorCtx, plan1.id, { pickupLocationId: LOCATION_ID2 })

    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it('allows a rate-only edit on an active deal even when the class is archived (regression)', async () => {
    const repo = new InMemoryClassRatePlanRepository()
    const archivedClass = makeClass({ status: 'ARCHIVED' })
    const classRepo: ClassRepoStub = {
      findById: async (_ctx, id) => (id === CLASS_ID ? archivedClass : undefined),
    }
    const locationRepo: LocationRepoStub = {
      findById: async (_ctx, id) => (id === LOCATION_ID ? makeLocation() : undefined),
    }
    const plan = await repo.create({
      operatorId: OPERATOR_ID,
      classId: CLASS_ID,
      pickupLocationId: LOCATION_ID,
      dayRateJpy: 8000,
      isActive: true,
      label: null,
    })
    const service = new ClassRatePlanService(repo, classRepo, locationRepo)

    const result = await service.update(operatorCtx, plan.id, { dayRateJpy: 9000 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.dayRateJpy).toBe(9000)
  })
})

// ---- remove ----------------------------------------------------------------

describe('ClassRatePlanService.remove', () => {
  it('deletes and returns the plan', async () => {
    const { service, repo } = setup()
    const createResult = await service.create(operatorCtx, makePlanData())
    if (!createResult.ok) throw new Error('seed failed')
    const planId = createResult.plan.id

    const result = await service.remove(operatorCtx, planId)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.id).toBe(planId)

    // Verify it's gone
    const found = await repo.findById(operatorCtx, planId)
    expect(found).toBeUndefined()
  })

  it('returns 404 for an unknown id', async () => {
    const { service } = setup()

    const result = await service.remove(operatorCtx, 'does-not-exist')

    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('denies a fleet-write outside the acting operator (tenancy denial)', async () => {
    const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const { service, repo } = setup()
    const plan = await repo.create(makePlanData())

    // Admin names a DIFFERENT operator — not-in-scope -> 404
    const result = await service.remove(adminCtx, plan.id, OTHER_OPERATOR_ID)

    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})
