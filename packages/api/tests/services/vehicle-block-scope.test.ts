import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { VehicleBlockService } from '../../src/services/vehicle-block'

// #1230 slice 5b: listBlocks threads narrowReadToOperator(ctx, id, vehicleBlockReadScope),
// so only a bypass admin's requested operator survives; a tenant operator stays clamped.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const FROM = new Date('2026-07-01T00:00:00Z')
const TO = new Date('2026-07-02T00:00:00Z')

async function service(): Promise<VehicleBlockService> {
  const blockRepo = new InMemoryVehicleBlockRepository()
  await blockRepo.create({
    operatorId: 'op-A',
    vehicleId: 'veh-A',
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE',
    reason: 'a',
    notes: null,
    createdBy: 'u',
  })
  await blockRepo.create({
    operatorId: 'op-B',
    vehicleId: 'veh-B',
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE',
    reason: 'b',
    notes: null,
    createdBy: 'u',
  })
  return new VehicleBlockService(
    new InMemoryVehicleRepository(),
    blockRepo,
    new InMemoryBookingRepository(),
  )
}

describe('VehicleBlockService.listBlocks — picker narrow (#1230 slice 5b)', () => {
  it('narrows a bypass admin to the requested operator', async () => {
    const rows = await (await service()).listBlocks(admin, FROM, TO, 'op-A')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })

  it('a tenant operator cannot widen via a foreign operatorId', async () => {
    const rows = await (await service()).listBlocks(opA, FROM, TO, 'op-B')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })
})
