import { seedId } from '@kuruma/shared/db/seed-id'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryAddOnTemplateRepository,
} from '../../src/repositories/in-memory'
import { AddOnService } from '../../src/services/add-on'
import { AddOnTemplateService } from '../../src/services/add-on-template'
import type { AddOnTemplate } from '../../src/stores'

const row = (over: Partial<AddOnTemplate>): AddOnTemplate => {
  const now = new Date()
  return {
    id: 'id',
    key: 'child_seat',
    name: { en: 'Child seat' },
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

// A second repo (add-on rows) feeds the already-offered exclusion; the picker
// tests that don't exercise exclusion pass an empty one.
const emptyAddOnRepo = () => new InMemoryAddOnRepository()

describe('AddOnTemplateService.listForPicker', () => {
  it('resolves each template name to the requested locale', async () => {
    const service = new AddOnTemplateService(
      new InMemoryAddOnTemplateRepository(),
      emptyAddOnRepo(),
    )

    const picker = await service.listForPicker('ja')

    const childSeat = picker.find((t) => t.key === 'child_seat')
    expect(childSeat).toEqual({
      id: expect.any(String),
      key: 'child_seat',
      resolvedName: 'チャイルドシート',
    })
  })

  it('falls back to English when the locale bundle is absent', async () => {
    const store = new Map<string, AddOnTemplate>([
      ['a', row({ id: 'a', key: 'child_seat', name: { en: 'Child seat' } })],
    ])
    const service = new AddOnTemplateService(
      new InMemoryAddOnTemplateRepository(store),
      emptyAddOnRepo(),
    )

    const picker = await service.listForPicker('zh')

    expect(picker).toEqual([{ id: 'a', key: 'child_seat', resolvedName: 'Child seat' }])
  })

  it('sorts the picker by resolved name so the wire order is deterministic', async () => {
    const store = new Map<string, AddOnTemplate>([
      ['b', row({ id: 'b', key: 'snow_tires', name: { en: 'Snow tires' } })],
      ['a', row({ id: 'a', key: 'additional_driver', name: { en: 'Additional driver' } })],
    ])
    const service = new AddOnTemplateService(
      new InMemoryAddOnTemplateRepository(store),
      emptyAddOnRepo(),
    )

    const picker = await service.listForPicker('en')

    expect(picker.map((t) => t.resolvedName)).toEqual(['Additional driver', 'Snow tires'])
  })

  it('returns an empty picker when the shared catalog is disabled (#1437)', async () => {
    // Seed a real ACTIVE template so an empty result proves the kill-switch gate,
    // not merely an empty catalog.
    const store = new Map<string, AddOnTemplate>([
      ['a', row({ id: 'a', key: 'child_seat', name: { en: 'Child seat' } })],
    ])
    const service = new AddOnTemplateService(
      new InMemoryAddOnTemplateRepository(store),
      emptyAddOnRepo(),
      () => Promise.resolve(false),
    )

    expect(await service.listForPicker('en')).toEqual([])
  })
})

describe('AddOnTemplateService.listForPicker — already-offered exclusion (P1-3)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const CHILD_SEAT = seedId('tmpl_child_seat')
  const ETC_CARD = seedId('tmpl_etc_card')

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  let addOnRepo: InMemoryAddOnRepository
  let templateService: AddOnTemplateService
  let addOnService: AddOnService

  beforeEach(() => {
    addOnRepo = new InMemoryAddOnRepository()
    const templateRepo = new InMemoryAddOnTemplateRepository()
    templateService = new AddOnTemplateService(templateRepo, addOnRepo)
    addOnService = new AddOnService(addOnRepo, templateRepo)
  })

  it('excludes a template the target operator already offers on an ACTIVE row', async () => {
    await addOnService.create(
      ctxFor(opA),
      { operatorId: opA, templateId: CHILD_SEAT, descriptionOverride: null, priceJpy: 1000 },
      'en',
    )

    const keys = (await templateService.listForPicker('en', opA)).map((t) => t.key)

    expect(keys).not.toContain('child_seat')
    expect(keys).toContain('etc_card')
  })

  it('does not exclude for another operator that has not offered it', async () => {
    await addOnService.create(
      ctxFor(opA),
      { operatorId: opA, templateId: CHILD_SEAT, descriptionOverride: null, priceJpy: 1000 },
      'en',
    )

    const keys = (await templateService.listForPicker('en', opB)).map((t) => t.key)

    expect(keys).toContain('child_seat')
  })

  it('re-offers a template once the operator archives their add-on', async () => {
    const created = await addOnService.create(
      ctxFor(opA),
      { operatorId: opA, templateId: ETC_CARD, descriptionOverride: null, priceJpy: 500 },
      'en',
    )
    if (!created.ok) throw new Error('seed failed')
    await addOnService.archive(ctxFor(opA), created.option.id, 'en')

    const keys = (await templateService.listForPicker('en', opA)).map((t) => t.key)

    expect(keys).toContain('etc_card')
  })

  it('returns the full catalog when no target operator is given (unscoped read)', async () => {
    await addOnService.create(
      ctxFor(opA),
      { operatorId: opA, templateId: CHILD_SEAT, descriptionOverride: null, priceJpy: 1000 },
      'en',
    )

    const keys = (await templateService.listForPicker('en')).map((t) => t.key)

    expect(keys).toContain('child_seat')
  })
})
