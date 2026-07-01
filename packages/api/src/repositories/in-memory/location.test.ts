import { describe, expect, it } from 'vitest'
import type { Location } from '../../stores'
import { InMemoryLocationRepository } from './location'

// #1279 (follow-up to #1271): operatorId is an immutable tenant anchor. The
// write layer must never let an update payload migrate a row to another
// operator. A location is the pickup/return anchor of a booking, so silently
// re-homing it to op_b would leak one tenant's site into another's fleet.
const seed = (
  operatorId: string,
): Omit<
  Location,
  'id' | 'createdAt' | 'updatedAt' | 'latitude' | 'longitude' | 'coordinateSource' | 'regionId'
> => ({
  operatorId,
  name: `Namba-${operatorId}`,
  address: '1-2-3 Namba, Osaka',
  operatingHours: null,
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 2880,
  status: 'ACTIVE',
})

describe('InMemoryLocationRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryLocationRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(created.id, {
      operatorId: 'op_b',
      defaultTurnaroundMinutes: 60,
    })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.defaultTurnaroundMinutes).toBe(60)
  })
})
