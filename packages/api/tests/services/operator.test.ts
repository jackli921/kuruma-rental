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

describe('InMemoryOperatorRepository.update', () => {
  test('applies a partial patch, preserves untouched fields, and returns the row', async () => {
    const repo = new InMemoryOperatorRepository()
    const op = await repo.create({
      name: 'Old Name',
      slug: 'old-slug',
      preAuthHandoffUrl: 'https://old.example',
    })
    const at = new Date('2030-01-01T00:00:00.000Z')
    const updated = await repo.update(op.id, { name: 'New Name', updatedAt: at })
    expect(updated).toMatchObject({
      id: op.id,
      name: 'New Name',
      slug: 'old-slug', // untouched
      preAuthHandoffUrl: 'https://old.example', // untouched (absent key)
      updatedAt: at,
    })
  })

  test('clears preAuthHandoffUrl when the patch carries null', async () => {
    const repo = new InMemoryOperatorRepository()
    const op = await repo.create({ name: 'A', slug: 'a', preAuthHandoffUrl: 'https://x.example' })
    const updated = await repo.update(op.id, { preAuthHandoffUrl: null, updatedAt: new Date() })
    expect(updated?.preAuthHandoffUrl).toBeNull()
  })

  test('returns undefined for an unknown id (no insert)', async () => {
    const repo = new InMemoryOperatorRepository()
    expect(await repo.update('nope', { name: 'X', updatedAt: new Date() })).toBeUndefined()
    expect(await repo.list()).toEqual([])
  })

  test('does not mutate the stored object in place (immutability)', async () => {
    const repo = new InMemoryOperatorRepository()
    const op = await repo.create({ name: 'A', slug: 'a', preAuthHandoffUrl: null })
    const before = await repo.findById(op.id)
    await repo.update(op.id, { name: 'B', updatedAt: new Date() })
    expect(before?.name).toBe('A') // the snapshot read earlier is unchanged
  })
})

describe('OperatorService.update', () => {
  async function seedOne(preAuthHandoffUrl: string | null = null) {
    const { repo, service } = makeService()
    const op = await repo.create({ name: 'Owner Co', slug: 'owner-co', preAuthHandoffUrl })
    const ctx: CallerContext = { ...ownerCtx, operatorId: op.id }
    return { repo, service, op, ctx }
  }

  test('returns a projection (no createdAt/updatedAt) when an owner edits its name', async () => {
    const { service, op, ctx } = await seedOne()
    const result = await service.update(ctx, op.id, { name: 'Renamed Co' })
    expect(result).toEqual({
      id: op.id,
      name: 'Renamed Co',
      slug: 'owner-co',
      preAuthHandoffUrl: null,
    })
    expect(result).not.toHaveProperty('createdAt')
    expect(result).not.toHaveProperty('updatedAt')
  })

  test('an owner can set preAuthHandoffUrl, and it persists', async () => {
    const { repo, service, op, ctx } = await seedOne()
    const result = await service.update(ctx, op.id, { preAuthHandoffUrl: 'https://pay.x/h' })
    expect(result?.preAuthHandoffUrl).toBe('https://pay.x/h')
    expect((await repo.findById(op.id))?.preAuthHandoffUrl).toBe('https://pay.x/h')
  })

  test('an owner can clear preAuthHandoffUrl to null', async () => {
    const { repo, service, op, ctx } = await seedOne('https://pay.x/h')
    await service.update(ctx, op.id, { preAuthHandoffUrl: null })
    expect((await repo.findById(op.id))?.preAuthHandoffUrl).toBeNull()
  })

  test('bumps updatedAt on a successful patch', async () => {
    const { repo, service, op, ctx } = await seedOne()
    const before = (await repo.findById(op.id))?.updatedAt
    await new Promise((r) => setTimeout(r, 2))
    await service.update(ctx, op.id, { name: 'Bumped' })
    const after = (await repo.findById(op.id))?.updatedAt
    expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0)
  })

  test('OPERATOR_STAFF cannot change preAuthHandoffUrl (owner-only) — ForbiddenError', async () => {
    const { repo, service, op } = await seedOne()
    const staffCtx: CallerContext = { ...ownerCtx, role: 'OPERATOR_STAFF', operatorId: op.id }
    await expect(
      service.update(staffCtx, op.id, { preAuthHandoffUrl: 'https://evil.example' }),
    ).rejects.toThrow(ForbiddenError)
    // and the field is unchanged
    expect((await repo.findById(op.id))?.preAuthHandoffUrl).toBeNull()
  })

  test('OPERATOR_STAFF may still edit the display name', async () => {
    const { service, op } = await seedOne()
    const staffCtx: CallerContext = { ...ownerCtx, role: 'OPERATOR_STAFF', operatorId: op.id }
    const result = await service.update(staffCtx, op.id, { name: 'Staff Renamed' })
    expect(result?.name).toBe('Staff Renamed')
  })

  test('a cross-tenant patch resolves to undefined (404) and leaves the target row unchanged', async () => {
    const { repo, service } = makeService()
    const a = await repo.create({ name: 'A Co', slug: 'a-co', preAuthHandoffUrl: null })
    const b = await repo.create({ name: 'B Co', slug: 'b-co', preAuthHandoffUrl: null })
    const ctxA: CallerContext = { ...ownerCtx, operatorId: a.id }
    expect(await service.update(ctxA, b.id, { name: 'Hijacked' })).toBeUndefined()
    expect((await repo.findById(b.id))?.name).toBe('B Co')
  })

  test('a cross-tenant handoff patch 404s BEFORE the owner-gate (no 403 existence leak)', async () => {
    const { repo, service } = makeService()
    const a = await repo.create({ name: 'A Co', slug: 'a-co', preAuthHandoffUrl: null })
    const b = await repo.create({ name: 'B Co', slug: 'b-co', preAuthHandoffUrl: null })
    // A staff of tenant A patches tenant B's money-flow field: must read as 404
    // (undefined), never a 403 that would confirm B exists.
    const staffA: CallerContext = { ...ownerCtx, role: 'OPERATOR_STAFF', operatorId: a.id }
    expect(
      await service.update(staffA, b.id, { preAuthHandoffUrl: 'https://evil.example' }),
    ).toBeUndefined()
  })

  test('returns undefined for an unknown id', async () => {
    const { service } = await seedOne()
    expect(await service.update(SYSTEM_CONTEXT, 'unknown-id', { name: 'X' })).toBeUndefined()
  })
})
