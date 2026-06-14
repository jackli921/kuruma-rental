import { createVehicleSchema, updateVehicleSchema } from '@kuruma/shared/validators/vehicle'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import type { ResolveWriteOperatorId } from '../tenancy'
import { VehicleService } from './vehicle'

const OPERATOR_ID = 'op_test'

// Resolver stub: echoes the seeded operator so create() can prove it both
// invokes the injected resolver and stamps the resolved id onto the row.
const resolveTo =
  (operatorId: string): ResolveWriteOperatorId =>
  async () =>
    operatorId

function setup(resolve: ResolveWriteOperatorId = resolveTo(OPERATOR_ID)) {
  const repo = new InMemoryVehicleRepository()
  const service = new VehicleService(repo, resolve)
  return { repo, service }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return createVehicleSchema.parse({
    operatorId: OPERATOR_ID,
    name: 'Toyota Corolla',
    seats: 5,
    transmission: 'AUTO',
    dailyRateJpy: 8000,
    ...overrides,
  })
}

async function seedVehicle(
  service: VehicleService,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const result = await service.create(SYSTEM_CONTEXT, createInput(overrides))
  if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`)
  return result.vehicle.id
}

describe('VehicleService.create', () => {
  it('stamps the resolved operatorId and defaults status to AVAILABLE', async () => {
    const { service } = setup(resolveTo('op_resolved'))

    const result = await service.create(SYSTEM_CONTEXT, createInput())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicle.operatorId).toBe('op_resolved')
    expect(result.vehicle.status).toBe('AVAILABLE')
    expect(result.vehicle.name).toBe('Toyota Corolla')
  })
})

describe('VehicleService.update — merge-level rate guard', () => {
  let service: VehicleService

  beforeEach(() => {
    service = setup().service
  })

  it('rejects clearing the only rate (merge leaves both null) with 400', async () => {
    // Seed daily-only; patch clears daily but omits hourly, so Zod's
    // patch-only refine passes — the merged row is what's unrentable.
    const id = await seedVehicle(service, { dailyRateJpy: 8000, hourlyRateJpy: null })

    const result = await service.update(
      SYSTEM_CONTEXT,
      id,
      updateVehicleSchema.parse({ dailyRateJpy: null }),
    )

    expect(result).toEqual({
      ok: false,
      error: 'At least one rate (daily or hourly) is required',
      status: 400,
    })
  })

  it('allows clearing daily when hourly remains set', async () => {
    const id = await seedVehicle(service, { dailyRateJpy: 8000, hourlyRateJpy: 1200 })

    const result = await service.update(
      SYSTEM_CONTEXT,
      id,
      updateVehicleSchema.parse({ dailyRateJpy: null }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicle.dailyRateJpy).toBeNull()
    expect(result.vehicle.hourlyRateJpy).toBe(1200)
  })
})

describe('VehicleService.update — merge-level min/max guard', () => {
  it('rejects a patched max below the existing min with a field error', async () => {
    const { service } = setup()
    const id = await seedVehicle(service, { minRentalHours: 10, maxRentalHours: 72 })

    const result = await service.update(
      SYSTEM_CONTEXT,
      id,
      updateVehicleSchema.parse({ maxRentalHours: 5 }),
    )

    expect(result).toEqual({
      ok: false,
      error: { maxRentalHours: ['Maximum rental hours must be greater than or equal to minimum'] },
      status: 400,
    })
  })
})

describe('VehicleService.update — merge semantics', () => {
  it('keeps absent fields and applies sent fields (explicit null clears)', async () => {
    const { service } = setup()
    const id = await seedVehicle(service, { name: 'Original', dailyRateJpy: 8000 })

    const result = await service.update(
      SYSTEM_CONTEXT,
      id,
      updateVehicleSchema.parse({ name: 'Renamed', fuelType: 'EV' }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicle.name).toBe('Renamed')
    expect(result.vehicle.fuelType).toBe('EV')
    expect(result.vehicle.dailyRateJpy).toBe(8000)
  })

  it('returns 404 for a non-existent vehicle', async () => {
    const { service } = setup()

    const result = await service.update(
      SYSTEM_CONTEXT,
      '00000000-0000-0000-0000-000000000000',
      updateVehicleSchema.parse({ name: 'Nope' }),
    )

    expect(result).toEqual({ ok: false, error: 'Vehicle not found', status: 404 })
  })
})

describe('VehicleService.bulkUpdateStatus', () => {
  let service: VehicleService

  beforeEach(() => {
    service = setup().service
  })

  it('sets every targeted vehicle to the new status', async () => {
    const a = await seedVehicle(service)
    const b = await seedVehicle(service)

    const result = await service.bulkUpdateStatus(SYSTEM_CONTEXT, [a, b], 'MAINTENANCE')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicles.map((v) => v.status)).toEqual(['MAINTENANCE', 'MAINTENANCE'])
  })

  it('returns 404 when any id is unknown, changing nothing', async () => {
    const a = await seedVehicle(service)

    const result = await service.bulkUpdateStatus(
      SYSTEM_CONTEXT,
      [a, '00000000-0000-0000-0000-000000000000'],
      'MAINTENANCE',
    )

    expect(result).toEqual({ ok: false, error: 'One or more vehicles not found', status: 404 })
    const after = await service.findById(SYSTEM_CONTEXT, a)
    expect(after?.status).toBe('AVAILABLE')
  })

  it('returns 400 when any target is RETIRED', async () => {
    const a = await seedVehicle(service)
    await service.softDelete(SYSTEM_CONTEXT, a)

    const result = await service.bulkUpdateStatus(SYSTEM_CONTEXT, [a], 'AVAILABLE')

    expect(result).toEqual({ ok: false, error: 'Cannot bulk-update retired vehicles', status: 400 })
  })

  it('deduplicates repeated ids', async () => {
    const a = await seedVehicle(service)

    const result = await service.bulkUpdateStatus(SYSTEM_CONTEXT, [a, a], 'MAINTENANCE')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicles).toHaveLength(1)
  })
})

describe('VehicleService.softDelete', () => {
  it('retires an existing vehicle', async () => {
    const { service } = setup()
    const id = await seedVehicle(service)

    const result = await service.softDelete(SYSTEM_CONTEXT, id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vehicle.status).toBe('RETIRED')
  })

  it('returns 404 for a non-existent vehicle', async () => {
    const { service } = setup()

    const result = await service.softDelete(SYSTEM_CONTEXT, '00000000-0000-0000-0000-000000000000')

    expect(result).toEqual({ ok: false, error: 'Vehicle not found', status: 404 })
  })
})
