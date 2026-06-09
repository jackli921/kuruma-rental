import { beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT } from '../../middleware/auth'
import type { Location, Operator } from '../../stores'
import { InMemoryLocationRepository } from './location'
import { InMemoryOperatorRepository } from './operator'
import { InMemoryStorefrontRepository } from './storefront'

let locationRepo: InMemoryLocationRepository
let operatorRepo: InMemoryOperatorRepository
let storefrontRepo: InMemoryStorefrontRepository

beforeEach(() => {
  locationRepo = new InMemoryLocationRepository()
  operatorRepo = new InMemoryOperatorRepository()
  storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
})

function makeOperator(name: string, slug: string): Promise<Operator> {
  return operatorRepo.create({ name, slug, preAuthHandoffUrl: null })
}

type LocationInput = Omit<Location, 'id' | 'createdAt' | 'updatedAt'>
function locationInput(overrides: Partial<LocationInput> = {}): LocationInput {
  return {
    operatorId: 'op_a',
    name: 'Namba',
    address: '1-1 Namba, Osaka',
    latitude: null,
    longitude: null,
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    ...overrides,
  }
}

describe('InMemoryStorefrontRepository.findActiveStorefronts (#391)', () => {
  it('returns active storefronts across all operators with the operator name joined', async () => {
    const best = await makeOperator('Best Car Rental', 'best')
    const kyoto = await makeOperator('Kyoto Wheels', 'kyoto')
    await locationRepo.create(locationInput({ operatorId: best.id, name: 'Namba' }))
    await locationRepo.create(locationInput({ operatorId: kyoto.id, name: 'Gion' }))

    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)

    expect(result).toHaveLength(2)
    const namba = result.find((s) => s.name === 'Namba')
    expect(namba?.operatorId).toBe(best.id)
    expect(namba?.operatorName).toBe('Best Car Rental')
    const gion = result.find((s) => s.name === 'Gion')
    expect(gion?.operatorName).toBe('Kyoto Wheels')
  })

  it('excludes ARCHIVED locations (a closed store is not a storefront)', async () => {
    const best = await makeOperator('Best Car Rental', 'best')
    await locationRepo.create(locationInput({ operatorId: best.id, name: 'Open' }))
    await locationRepo.create(
      locationInput({ operatorId: best.id, name: 'Closed', status: 'ARCHIVED' }),
    )

    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)

    expect(result.map((s) => s.name)).toEqual(['Open'])
  })

  it('with { pickupLocationId } narrows to a single storefront', async () => {
    const best = await makeOperator('Best Car Rental', 'best')
    const namba = await locationRepo.create(locationInput({ operatorId: best.id, name: 'Namba' }))
    await locationRepo.create(locationInput({ operatorId: best.id, name: 'Umeda' }))

    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT, {
      pickupLocationId: namba.id,
    })

    expect(result.map((s) => s.id)).toEqual([namba.id])
  })

  it('drops an orphan location whose operator no longer exists', async () => {
    await locationRepo.create(locationInput({ operatorId: 'op_ghost', name: 'Orphan' }))

    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)

    expect(result).toEqual([])
  })
})
