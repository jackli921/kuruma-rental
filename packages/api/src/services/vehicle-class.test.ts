import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT, ScopeRequiredError } from '../middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../repositories/in-memory'
import type { VehicleClass } from '../stores'
import { VehicleClassService } from './vehicle-class'

// A non-empty bucket base so the #967 cross-tenant photo-spoof guard is active
// (it is inert when the base is empty — see isForeignVehiclePhoto).
const PHOTOS_BASE = 'https://photos.kuruma.test'

function setup() {
  const repo = new InMemoryVehicleClassRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const service = new VehicleClassService(repo, vehicleRepo, bookingRepo, PHOTOS_BASE)
  return { repo, service }
}

function classData(
  overrides: Partial<Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: 'op_test',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    ...overrides,
  }
}

// #967: classes carry photos + operatorId and run the SAME r2: encode as
// vehicles, but have no `classes/<id>/` upload prefix — every R2 object lives
// under `vehicles/<vehicleId>/`. So a class can never legitimately carry one of
// OUR bucket URLs (the UI has no class-photo upload); any of-our-origin URL is a
// cross-tenant spoof rendered on the PUBLIC class-detail page.
describe('VehicleClassService — cross-tenant photo-spoof guard (#967)', () => {
  it('rejects a create whose photos point at our bucket', async () => {
    const { service } = setup()

    const result = await service.create(
      SYSTEM_CONTEXT,
      classData({ photos: [`${PHOTOS_BASE}/vehicles/veh_victim/secret.jpg`] }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('allows a create with an external (non-bucket) photo URL', async () => {
    const { service } = setup()

    const result = await service.create(
      SYSTEM_CONTEXT,
      classData({ photos: ['https://images.unsplash.com/photo-123?w=800'] }),
    )

    expect(result.ok).toBe(true)
  })

  it('rejects an update pointing at our bucket', async () => {
    const { service } = setup()
    const created = await service.create(SYSTEM_CONTEXT, classData())
    if (!created.ok) throw new Error('seed failed')

    const result = await service.update(SYSTEM_CONTEXT, created.vehicleClass.id, {
      photos: [`${PHOTOS_BASE}/vehicles/veh_victim/secret.jpg`],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('allows an update with an external (non-bucket) photo URL', async () => {
    const { service } = setup()
    const created = await service.create(SYSTEM_CONTEXT, classData())
    if (!created.ok) throw new Error('seed failed')

    const result = await service.update(SYSTEM_CONTEXT, created.vehicleClass.id, {
      photos: ['https://images.unsplash.com/photo-456?w=800'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicleClass.photos).toEqual(['https://images.unsplash.com/photo-456?w=800'])
  })
})

describe('VehicleClassService — cross-operator manage reads', () => {
  it('requires a scope choice for all-scope callers', async () => {
    const { service } = setup()

    await expect(
      service.findAll(SYSTEM_CONTEXT, { includeAll: false }, { includeArchived: true }),
    ).rejects.toBeInstanceOf(ScopeRequiredError)
  })

  it('filters all-scope manage reads by the requested operator', async () => {
    const { service } = setup()
    await service.create(SYSTEM_CONTEXT, classData({ operatorId: 'op_a', slug: 'a-compact' }))
    await service.create(SYSTEM_CONTEXT, classData({ operatorId: 'op_b', slug: 'b-compact' }))

    const rows = await service.findAll(
      SYSTEM_CONTEXT,
      { operatorId: 'op_b', includeAll: false },
      { includeArchived: true },
    )

    expect(rows.map((r) => r.slug)).toEqual(['b-compact'])
  })

  it('keeps explicit includeAll available for oversight reads', async () => {
    const { service } = setup()
    await service.create(SYSTEM_CONTEXT, classData({ operatorId: 'op_a', slug: 'a-compact' }))
    await service.create(SYSTEM_CONTEXT, classData({ operatorId: 'op_b', slug: 'b-compact' }))

    const rows = await service.findAll(
      SYSTEM_CONTEXT,
      { includeAll: true },
      { includeArchived: true },
    )

    expect(rows.map((r) => r.slug).sort()).toEqual(['a-compact', 'b-compact'])
  })
})
