import { describe, expect, it } from 'vitest'
import { InMemoryAddOnTemplateRepository } from '../../src/repositories/in-memory'
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

describe('AddOnTemplateService.listForPicker', () => {
  it('resolves each template name to the requested locale', async () => {
    const service = new AddOnTemplateService(new InMemoryAddOnTemplateRepository())

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
    const service = new AddOnTemplateService(new InMemoryAddOnTemplateRepository(store))

    const picker = await service.listForPicker('zh')

    expect(picker).toEqual([{ id: 'a', key: 'child_seat', resolvedName: 'Child seat' }])
  })

  it('sorts the picker by resolved name so the wire order is deterministic', async () => {
    const store = new Map<string, AddOnTemplate>([
      ['b', row({ id: 'b', key: 'snow_tires', name: { en: 'Snow tires' } })],
      ['a', row({ id: 'a', key: 'additional_driver', name: { en: 'Additional driver' } })],
    ])
    const service = new AddOnTemplateService(new InMemoryAddOnTemplateRepository(store))

    const picker = await service.listForPicker('en')

    expect(picker.map((t) => t.resolvedName)).toEqual(['Additional driver', 'Snow tires'])
  })
})
