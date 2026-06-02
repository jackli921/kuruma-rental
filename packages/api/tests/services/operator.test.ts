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
