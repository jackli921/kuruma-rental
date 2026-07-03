import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, NotFoundError } from '../middleware/auth'
import { InMemoryAddOnTemplateRepository } from '../repositories/in-memory/add-on-template'
import { InMemoryInsuranceTemplateRepository } from '../repositories/in-memory/insurance-template'
import type { AddOnTemplate, InsuranceTemplate } from '../stores'
import { TemplateLibraryService } from './template-library'

const ADMIN: CallerContext = { userId: 'admin-user', role: 'PLATFORM_ADMIN' }

function addOnStore(rows: AddOnTemplate[]): InMemoryAddOnTemplateRepository {
  return new InMemoryAddOnTemplateRepository(new Map(rows.map((r) => [r.id, r])))
}
function insuranceStore(rows: InsuranceTemplate[]): InMemoryInsuranceTemplateRepository {
  return new InMemoryInsuranceTemplateRepository(new Map(rows.map((r) => [r.id, r])))
}

const now = new Date()
const archivedAddOn: AddOnTemplate = {
  id: 'a1',
  key: 'baby-seat',
  name: { en: 'Baby seat' },
  description: null,
  status: 'ARCHIVED',
  createdAt: now,
  updatedAt: now,
}
const activeInsurance: InsuranceTemplate = {
  id: 'i1',
  key: 'normal',
  name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
  description: { en: 'Standard cover.' },
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
}

describe('TemplateLibraryService.listAll', () => {
  it('returns both catalogs as raw admin rows, including ARCHIVED, dropping timestamps', async () => {
    const service = new TemplateLibraryService(
      addOnStore([archivedAddOn]),
      insuranceStore([activeInsurance]),
    )

    const result = await service.listAll(ADMIN)

    expect(result.addOns).toEqual([
      {
        id: 'a1',
        key: 'baby-seat',
        name: { en: 'Baby seat' },
        description: null,
        status: 'ARCHIVED',
      },
    ])
    expect(result.insurance).toEqual([
      {
        id: 'i1',
        key: 'normal',
        name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
        description: { en: 'Standard cover.' },
        status: 'ACTIVE',
      },
    ])
  })

  it('rejects a non-platform caller with ForbiddenError', async () => {
    const service = new TemplateLibraryService(addOnStore([]), insuranceStore([]))
    const operator: CallerContext = { userId: 'op', role: 'OPERATOR_OWNER', operatorId: 'op_1' }

    await expect(service.listAll(operator)).rejects.toThrow(ForbiddenError)
  })
})

const OPERATOR: CallerContext = { userId: 'op', role: 'OPERATOR_OWNER', operatorId: 'op_1' }

describe('TemplateLibraryService.updateAddOn', () => {
  it('translates + promotes a backfill-minted row, returning the raw admin row (no timestamps)', async () => {
    const service = new TemplateLibraryService(addOnStore([archivedAddOn]), insuranceStore([]))

    const row = await service.updateAddOn(ADMIN, 'a1', {
      name: { en: 'Baby seat', ja: 'ベビーシート', zh: '婴儿座椅' },
      status: 'ACTIVE',
    })

    expect(row).toEqual({
      id: 'a1',
      key: 'baby-seat',
      name: { en: 'Baby seat', ja: 'ベビーシート', zh: '婴儿座椅' },
      description: null,
      status: 'ACTIVE',
    })
  })

  it('rejects an operator caller with ForbiddenError (requirePlatformAdmin)', async () => {
    const service = new TemplateLibraryService(addOnStore([archivedAddOn]), insuranceStore([]))

    await expect(service.updateAddOn(OPERATOR, 'a1', { status: 'ACTIVE' })).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('throws NotFoundError for an unknown id', async () => {
    const service = new TemplateLibraryService(addOnStore([archivedAddOn]), insuranceStore([]))

    await expect(service.updateAddOn(ADMIN, 'nope', { status: 'ACTIVE' })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('TemplateLibraryService.updateInsurance', () => {
  it('edits the insurance bundle, returning the raw admin row', async () => {
    const service = new TemplateLibraryService(addOnStore([]), insuranceStore([activeInsurance]))

    const row = await service.updateInsurance(ADMIN, 'i1', {
      description: { en: 'Updated cover.' },
    })

    expect(row).toEqual({
      id: 'i1',
      key: 'normal',
      name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
      description: { en: 'Updated cover.' },
      status: 'ACTIVE',
    })
  })

  it('rejects an operator caller with ForbiddenError', async () => {
    const service = new TemplateLibraryService(addOnStore([]), insuranceStore([activeInsurance]))

    await expect(service.updateInsurance(OPERATOR, 'i1', { status: 'ARCHIVED' })).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('throws NotFoundError for an unknown id', async () => {
    const service = new TemplateLibraryService(addOnStore([]), insuranceStore([activeInsurance]))

    await expect(service.updateInsurance(ADMIN, 'nope', { status: 'ARCHIVED' })).rejects.toThrow(
      NotFoundError,
    )
  })
})
