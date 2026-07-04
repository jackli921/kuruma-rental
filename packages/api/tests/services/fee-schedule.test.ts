import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CallerContext, ScopeRequiredError } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryFeeScheduleRepository } from '../../src/repositories/in-memory'
import { FeeScheduleService } from '../../src/services/fee-schedule'
import type { FeeSchedule } from '../../src/stores'

const opA = 'op_a'
const opB = 'op_b'

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_ERROR.UNIQUE_VIOLATION,
  })

// Composite FK fee_schedules(operatorId, vehicleClassId) -> vehicle_classes —
// raised when a per-class fee points at a class the operator does not own.
const foreignKeyViolation = () =>
  Object.assign(new Error('insert or update violates foreign key constraint'), {
    code: PG_ERROR.FOREIGN_KEY_VIOLATION,
    constraint_name: 'fee_schedules_operator_class_fk',
  })

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

function createInput(operatorId: string, overrides?: Partial<FeeSchedule>) {
  return {
    operatorId,
    vehicleClassId: null,
    feeType: 'CLEANING_FLAT' as const,
    unit: 'FLAT' as const,
    amountJpy: 3000,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

describe('FeeScheduleService — create', () => {
  let repo: InMemoryFeeScheduleRepository
  let service: FeeScheduleService

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
    service = new FeeScheduleService(repo)
  })

  it('creates a coherent fee for the caller operator', async () => {
    const result = await service.create(ctxFor(opA), createInput(opA))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.feeSchedule.feeType).toBe('CLEANING_FLAT')
      expect(result.feeSchedule.operatorId).toBe(opA)
    }
  })

  it('rejects an incoherent fee-type/unit with 400', async () => {
    const result = await service.create(
      ctxFor(opA),
      createInput(opA, { feeType: 'OVERTIME_HOURLY', unit: 'FLAT' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('OVERTIME_HOURLY fees must use the PER_HOUR unit')
    }
  })

  it('rejects a second ACTIVE fee of the same (operator, type, scope) with 409', async () => {
    await service.create(ctxFor(opA), createInput(opA))
    const result = await service.create(ctxFor(opA), createInput(opA))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('allows the same (type, scope) under a different operator', async () => {
    await service.create(ctxFor(opA), createInput(opA))
    const result = await service.create(ctxFor(opB), createInput(opB))
    expect(result.ok).toBe(true)
  })

  it('maps a unique-violation that slips past the pre-check (lost race) to 409', async () => {
    vi.spyOn(repo, 'findActiveByScope').mockResolvedValue(undefined)
    vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())
    const result = await service.create(ctxFor(opA), createInput(opA))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('maps a composite-FK violation (bad vehicleClassId) to 400 INVALID_VEHICLE_CLASS', async () => {
    vi.spyOn(repo, 'findActiveByScope').mockResolvedValue(undefined)
    vi.spyOn(repo, 'create').mockRejectedValue(foreignKeyViolation())
    const result = await service.create(
      ctxFor(opA),
      createInput(opA, { vehicleClassId: 'cls_does_not_exist' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toBe('INVALID_VEHICLE_CLASS')
      expect(result.error).toBe('Invalid vehicle class')
    }
  })
})

describe('FeeScheduleService — update (merge-then-validate)', () => {
  let repo: InMemoryFeeScheduleRepository
  let service: FeeScheduleService

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
    service = new FeeScheduleService(repo)
  })

  it('bumps amount only without self-colliding on active-uniqueness', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    const result = await service.update(ctxFor(opA), created.feeSchedule.id, { amountJpy: 4500 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.amountJpy).toBe(4500)
  })

  it('[P1] rejects a unit-only patch that breaks coherence with the STORED feeType (400)', async () => {
    // Stored row is OVERTIME_HOURLY+PER_HOUR; patching unit -> FLAT alone never
    // hits the schema .superRefine() (no feeType in the patch). The service
    // merges and validates the result -> 400.
    const created = await service.create(
      ctxFor(opA),
      createInput(opA, { feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 500 }),
    )
    if (!created.ok) throw new Error('seed failed')
    const result = await service.update(ctxFor(opA), created.feeSchedule.id, { unit: 'FLAT' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('OVERTIME_HOURLY fees must use the PER_HOUR unit')
    }
  })

  it('accepts a coherent feeType+unit pair change', async () => {
    const created = await service.create(
      ctxFor(opA),
      createInput(opA, { feeType: 'CLEANING_FLAT', unit: 'FLAT' }),
    )
    if (!created.ok) throw new Error('seed failed')
    const result = await service.update(ctxFor(opA), created.feeSchedule.id, {
      feeType: 'OVERTIME_HOURLY',
      unit: 'PER_HOUR',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.feeType).toBe('OVERTIME_HOURLY')
  })

  it('returns 404 (not 403) when the id belongs to another operator', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    const result = await service.update(ctxFor(opB), created.feeSchedule.id, { amountJpy: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('loads the row scoped before writing, never writes on a cross-tenant id', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    const updateSpy = vi.spyOn(repo, 'update')
    await service.update(ctxFor(opB), created.feeSchedule.id, { amountJpy: 1 })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('rejects a merged active-uniqueness collision against another row (409)', async () => {
    // Two operator-wide fees of DIFFERENT types; patch one to collide with the
    // other's type. Active-uniqueness on the merged scope excludes the current
    // row but still catches the OTHER row.
    await service.create(ctxFor(opA), createInput(opA, { feeType: 'CLEANING_FLAT', unit: 'FLAT' }))
    const noFuel = await service.create(
      ctxFor(opA),
      createInput(opA, { feeType: 'NO_FUEL_FLAT', unit: 'FLAT', amountJpy: 5000 }),
    )
    if (!noFuel.ok) throw new Error('seed failed')
    const result = await service.update(ctxFor(opA), noFuel.feeSchedule.id, {
      feeType: 'CLEANING_FLAT',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('maps a composite-FK violation on update to 400 INVALID_VEHICLE_CLASS', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    vi.spyOn(repo, 'update').mockRejectedValue(foreignKeyViolation())
    const result = await service.update(ctxFor(opA), created.feeSchedule.id, {
      vehicleClassId: 'cls_does_not_exist',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toBe('INVALID_VEHICLE_CLASS')
    }
  })
})

describe('FeeScheduleService — archive', () => {
  let repo: InMemoryFeeScheduleRepository
  let service: FeeScheduleService

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
    service = new FeeScheduleService(repo)
  })

  it('sets status to ARCHIVED for an owned fee', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    const result = await service.archive(ctxFor(opA), created.feeSchedule.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.status).toBe('ARCHIVED')
  })

  it('archiving frees the active slot — a re-created fee of the same scope succeeds', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    await service.archive(ctxFor(opA), created.feeSchedule.id)
    const recreated = await service.create(ctxFor(opA), createInput(opA))
    expect(recreated.ok).toBe(true)
  })

  it('returns 404 and does not write when archiving another operator fee', async () => {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    const archiveSpy = vi.spyOn(repo, 'archive')
    const result = await service.archive(ctxFor(opB), created.feeSchedule.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
    expect(archiveSpy).not.toHaveBeenCalled()
  })
})

// The cross-operator read guard moved from 5 copy-pasted route blocks into the
// service (audit M3). These pin the invariant at the service layer, so a future
// route that forgets a hand-rolled guard still can't leak every operator's fees.
describe('FeeScheduleService — findAll enforces cross-operator read scope (audit M3)', () => {
  const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  let repo: InMemoryFeeScheduleRepository
  let service: FeeScheduleService

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
    service = new FeeScheduleService(repo)
  })

  it('rejects an unscoped bypass read in the service itself, not just at the route', async () => {
    await expect(service.findAll(adminCtx, { includeAll: false })).rejects.toBeInstanceOf(
      ScopeRequiredError,
    )
  })

  it('scopes a bypass read to an explicit operatorId', async () => {
    await service.create(ctxFor(opA), createInput(opA))
    await service.create(ctxFor(opB), createInput(opB))

    const onlyA = await service.findAll(adminCtx, { operatorId: opA, includeAll: false })
    expect(onlyA.map((f) => f.operatorId)).toEqual([opA])
  })

  it('an operator reads only its own tenant without naming an operatorId', async () => {
    await service.create(ctxFor(opA), createInput(opA))
    await service.create(ctxFor(opB), createInput(opB))

    const mine = await service.findAll(ctxFor(opA), { includeAll: false })
    expect(mine.map((f) => f.operatorId)).toEqual([opA])
  })
})

// #1442: PATCH/DELETE bind to the operator a picker admin acts as — parity with
// bookings/fleet (#1260). A bypass admin reads every operator's fees by raw id, so
// an unbound write could touch any tenant's fee; require it to name the operator it
// picked and forbid a mismatch. An operator session is already tenant-clamped by the
// read scope, so it passes through with no acting id.
describe('FeeScheduleService — update/archive bind to the picked operator (#1442)', () => {
  const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  let repo: InMemoryFeeScheduleRepository
  let service: FeeScheduleService

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
    service = new FeeScheduleService(repo)
  })

  async function seedFeeForOpA(): Promise<string> {
    const created = await service.create(ctxFor(opA), createInput(opA))
    if (!created.ok) throw new Error('seed failed')
    return created.feeSchedule.id
  }

  it('rejects an admin update with no picked operator (422 OPERATOR_REQUIRED)', async () => {
    const id = await seedFeeForOpA()
    const result = await service.update(adminCtx, id, { amountJpy: 5000 }, undefined)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('404s an admin update whose picked operator does not own the fee', async () => {
    const id = await seedFeeForOpA()
    const result = await service.update(adminCtx, id, { amountJpy: 5000 }, opB)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('applies an admin update bound to the fee-owning operator', async () => {
    const id = await seedFeeForOpA()
    const result = await service.update(adminCtx, id, { amountJpy: 5000 }, opA)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.amountJpy).toBe(5000)
  })

  it('lets an operator session update its own fee with no acting id', async () => {
    const id = await seedFeeForOpA()
    const result = await service.update(ctxFor(opA), id, { amountJpy: 5000 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.amountJpy).toBe(5000)
  })

  it('rejects an admin archive with no picked operator (422 OPERATOR_REQUIRED)', async () => {
    const id = await seedFeeForOpA()
    const result = await service.archive(adminCtx, id, undefined)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('404s an admin archive whose picked operator does not own the fee', async () => {
    const id = await seedFeeForOpA()
    const result = await service.archive(adminCtx, id, opB)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('archives a fee bound to the fee-owning operator', async () => {
    const id = await seedFeeForOpA()
    const result = await service.archive(adminCtx, id, opA)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feeSchedule.status).toBe('ARCHIVED')
  })
})
