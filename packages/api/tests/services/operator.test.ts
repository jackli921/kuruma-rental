import { describe, expect, test } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory'
import { OperatorService } from '../../src/services/operator'

const ownerCtx: CallerContext = {
  userId: 'u',
  role: 'OPERATOR_OWNER',
  operatorId: 'op_1',
  bypassScope: false,
}

function makeService() {
  const repo = new InMemoryOperatorRepository()
  return { repo, service: new OperatorService(repo) }
}

describe('InMemoryOperatorRepository.list', () => {
  test('returns all operators sorted by name', async () => {
    const repo = new InMemoryOperatorRepository()
    await repo.create({ name: 'Zebra Cars', slug: 'zebra-cars', preAuthHandoffUrl: null })
    await repo.create({ name: 'Acme Cars', slug: 'acme-cars', preAuthHandoffUrl: null })
    const list = await repo.list()
    expect(list.map((o) => o.name)).toEqual(['Acme Cars', 'Zebra Cars'])
  })

  test('returns an empty array when there are no operators', async () => {
    expect(await new InMemoryOperatorRepository().list()).toEqual([])
  })
})

describe('OperatorService.list', () => {
  async function seedTwo() {
    const { repo, service } = makeService()
    const a = await repo.create({ name: 'Acme', slug: 'acme', preAuthHandoffUrl: null })
    const b = await repo.create({ name: 'Best', slug: 'best', preAuthHandoffUrl: null })
    return { repo, service, a, b }
  }

  test('a bypass caller (PLATFORM_ADMIN) sees every operator', async () => {
    const { service, a, b } = await seedTwo()
    const list = await service.list(SYSTEM_CONTEXT)
    expect(list.map((o) => o.id).sort()).toEqual([a.id, b.id].sort())
  })

  test('an OPERATOR_OWNER sees only its own operator', async () => {
    const { service, a } = await seedTwo()
    const ctx: CallerContext = { ...ownerCtx, operatorId: a.id }
    const list = await service.list(ctx)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(a.id)
  })

  test('an OPERATOR_* caller with no operatorId sees nothing (fail-closed)', async () => {
    const { service } = await seedTwo()
    const ctx: CallerContext = { ...ownerCtx, operatorId: undefined }
    expect(await service.list(ctx)).toEqual([])
  })
})

describe('OperatorService.create', () => {
  test('derives a kebab slug from the name', async () => {
    const { service } = makeService()
    const op = await service.create(SYSTEM_CONTEXT, { name: 'Best Car Rental' })
    expect(op.slug).toBe('best-car-rental')
    expect(op.name).toBe('Best Car Rental')
    expect(op.id).toBeTruthy()
  })

  test('resolves a slug collision with a numeric suffix', async () => {
    const { service } = makeService()
    await service.create(SYSTEM_CONTEXT, { name: 'Acme Cars' })
    const second = await service.create(SYSTEM_CONTEXT, { name: 'Acme Cars' })
    expect(second.slug).toBe('acme-cars-2')
  })

  test('stores preAuthHandoffUrl, defaulting to null', async () => {
    const { service } = makeService()
    const withUrl = await service.create(SYSTEM_CONTEXT, {
      name: 'A',
      preAuthHandoffUrl: 'https://pay.example/x',
    })
    expect(withUrl.preAuthHandoffUrl).toBe('https://pay.example/x')
    const without = await service.create(SYSTEM_CONTEXT, { name: 'B' })
    expect(without.preAuthHandoffUrl).toBeNull()
  })

  test('rejects a non-PLATFORM_ADMIN caller with ForbiddenError', async () => {
    const { service } = makeService()
    await expect(service.create(ownerCtx, { name: 'Sneaky' })).rejects.toThrow(ForbiddenError)
  })
})
