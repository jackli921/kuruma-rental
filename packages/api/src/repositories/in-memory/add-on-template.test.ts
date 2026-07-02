import { DEMO_ADD_ON_TEMPLATES } from '@kuruma/shared/db/seed-data'
import { seedId } from '@kuruma/shared/db/seed-id'
import { describe, expect, it } from 'vitest'
import type { AddOnTemplate } from '../../stores'
import { InMemoryAddOnTemplateRepository } from './add-on-template'

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

describe('InMemoryAddOnTemplateRepository.findActive', () => {
  it('defaults to the curated demo catalog with ids matching the real seed', async () => {
    const repo = new InMemoryAddOnTemplateRepository()

    const templates = await repo.findActive()

    expect(templates.map((t) => t.key).sort()).toEqual(
      DEMO_ADD_ON_TEMPLATES.map((t) => t.key).sort(),
    )
    const childSeat = templates.find((t) => t.key === 'child_seat')
    expect(childSeat).toMatchObject({
      id: seedId('tmpl_child_seat'),
      key: 'child_seat',
      name: { en: 'Child seat', ja: 'チャイルドシート', zh: '儿童座椅' },
      status: 'ACTIVE',
    })
  })

  it('excludes ARCHIVED templates', async () => {
    const store = new Map<string, AddOnTemplate>([
      ['a', row({ id: 'a', key: 'child_seat', status: 'ACTIVE' })],
      ['b', row({ id: 'b', key: 'etc_card', status: 'ARCHIVED' })],
    ])
    const repo = new InMemoryAddOnTemplateRepository(store)

    const templates = await repo.findActive()

    expect(templates.map((t) => t.key)).toEqual(['child_seat'])
  })
})

describe('InMemoryAddOnTemplateRepository.findById', () => {
  it('returns the template for a known id, including ARCHIVED ones', async () => {
    const store = new Map<string, AddOnTemplate>([
      ['a', row({ id: 'a', key: 'child_seat', status: 'ACTIVE' })],
      ['b', row({ id: 'b', key: 'etc_card', status: 'ARCHIVED' })],
    ])
    const repo = new InMemoryAddOnTemplateRepository(store)

    expect(await repo.findById('a')).toMatchObject({ id: 'a', key: 'child_seat' })
    // findById is the write-path lookup (resolve the en name for the column); it
    // does NOT filter on status — the create service decides ACTIVE-only.
    expect(await repo.findById('b')).toMatchObject({ id: 'b', status: 'ARCHIVED' })
  })

  it('returns undefined for an unknown id', async () => {
    const repo = new InMemoryAddOnTemplateRepository(new Map())
    expect(await repo.findById('missing')).toBeUndefined()
  })
})
