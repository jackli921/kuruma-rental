import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { AddOn, AddOnTemplate } from '../../stores'
import { InMemoryAddOnRepository } from './add-on'

// #1271: operatorId is a tenant anchor. The write layer must never let an
// update payload migrate a row to another operator, regardless of the caller
// or DTO upstream. This pins that invariant at the repository itself.
const seed = (operatorId: string): Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name: 'Baby Seat',
  description: null,
  templateId: null,
  descriptionOverride: null,
  priceJpy: 1500,
  status: 'ACTIVE',
})

// Catalog i18n (slice 2): a curated template the in-memory repo joins against,
// mirroring the Drizzle LEFT JOIN add_on_templates.
const template = (id: string): AddOnTemplate => ({
  id,
  key: 'child_seat',
  name: { en: 'Child Seat', ja: 'チャイルドシート', zh: '儿童座椅' },
  description: { en: 'Rear-facing seat', ja: '後ろ向きシート' },
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('InMemoryAddOnRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryAddOnRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(SYSTEM_CONTEXT, created.id, {
      operatorId: 'op_b',
      priceJpy: 3000,
    })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.priceJpy).toBe(3000)
  })
})

describe('InMemoryAddOnRepository — template JOIN (catalog i18n slice 2)', () => {
  it('enriches active rows with the injected template name + description bundles', async () => {
    const templates = new Map<string, AddOnTemplate>([['tmpl_x', template('tmpl_x')]])
    const repo = new InMemoryAddOnRepository(undefined, templates)
    await repo.create({ ...seed('op_a'), templateId: 'tmpl_x', name: 'Child Seat' })

    const [row] = await repo.findActiveByOperator('op_a')

    expect(row?.templateName).toEqual({ en: 'Child Seat', ja: 'チャイルドシート', zh: '儿童座椅' })
    expect(row?.templateDescription).toEqual({ en: 'Rear-facing seat', ja: '後ろ向きシート' })
  })

  it('leaves templateName/templateDescription null for a legacy null-templateId row', async () => {
    const repo = new InMemoryAddOnRepository(undefined, new Map())
    await repo.create(seed('op_a'))

    const [row] = await repo.findActiveByOperator('op_a')

    expect(row?.templateName).toBeNull()
    expect(row?.templateDescription).toBeNull()
  })

  it('findActiveByOperatorAndTemplate finds an active row by templateId, not name', async () => {
    const templates = new Map<string, AddOnTemplate>([['tmpl_x', template('tmpl_x')]])
    const repo = new InMemoryAddOnRepository(undefined, templates)
    const created = await repo.create({ ...seed('op_a'), templateId: 'tmpl_x', name: 'Child Seat' })

    const found = await repo.findActiveByOperatorAndTemplate('op_a', 'tmpl_x')

    expect(found?.id).toBe(created.id)
  })
})
