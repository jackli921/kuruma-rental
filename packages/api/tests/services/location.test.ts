import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory'
import { LocationService } from '../../src/services/location'

const opA = 'op_a'
const opB = 'op_b'

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

function createInput(operatorId: string, name: string) {
  return {
    operatorId,
    name,
    address: '1-2-3 Somewhere',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE' as const,
  }
}

describe('LocationService', () => {
  let repo: InMemoryLocationRepository
  let service: LocationService

  beforeEach(() => {
    repo = new InMemoryLocationRepository()
    service = new LocationService(repo)
  })

  describe('create', () => {
    it('creates a location for the caller operator', async () => {
      const result = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.location.name).toBe('Namba')
        expect(result.location.operatorId).toBe(opA)
      }
    })

    it('rejects a duplicate name within the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const result = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows the same name under a different operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const result = await service.create(ctxFor(opB), createInput(opB, 'Namba'))
      expect(result.ok).toBe(true)
    })
  })

  describe('update', () => {
    it('updates a field for an owned location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), created.location.id, {
        defaultTurnaroundMinutes: 3600,
      })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.defaultTurnaroundMinutes).toBe(3600)
    })

    it('returns 404 (not 403) when the id belongs to another operator', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opB), created.location.id, { name: 'Hijack' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('loads the row (scoped) before writing, and never writes on a cross-tenant id', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const findByIdSpy = vi.spyOn(repo, 'findById')
      const updateSpy = vi.spyOn(repo, 'update')

      await service.update(ctxFor(opB), created.location.id, { name: 'Hijack' })

      expect(findByIdSpy).toHaveBeenCalledWith(ctxFor(opB), created.location.id)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('rejects renaming to a name already used by the same operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const umeda = await service.create(ctxFor(opA), createInput(opA, 'Umeda'))
      if (!umeda.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), umeda.location.id, { name: 'Namba' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows renaming to a still-unique name', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), created.location.id, { name: 'Namba South' })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.name).toBe('Namba South')
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED for an owned location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.archive(ctxFor(opA), created.location.id)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.status).toBe('ARCHIVED')
    })

    it('returns 404 and does not write when archiving another operator location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opB), created.location.id)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
      expect(archiveSpy).not.toHaveBeenCalled()
    })
  })
})
