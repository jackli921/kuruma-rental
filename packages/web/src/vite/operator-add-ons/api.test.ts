import { describe, expect, it, vi } from 'vitest'
import { archiveAddOn, createAddOn, updateAddOn } from './api'

const addOn = {
  id: 'ao_1',
  operatorId: 'op_1',
  templateId: null,
  resolvedName: 'GPS',
  resolvedDescription: 'desc',
  descriptionOverride: { en: 'desc' },
  nameI18n: { en: 'GPS' },
  priceJpy: 1500,
  status: 'ACTIVE',
}

function mockOk() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: addOn }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('operator add-on write api threads the locale', () => {
  it('createAddOn appends ?locale so the server knows the Model-B source locale', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await createAddOn({ nameI18n: { en: 'GPS' }, priceJpy: 1500, operatorId: 'op_1' }, 'csrf', 'ja')
    expect(f.mock.calls[0]?.[0]).toContain('locale=ja')
  })

  it('updateAddOn carries the locale alongside any operatorId', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await updateAddOn('ao_1', { priceJpy: 2000 }, 'csrf', 'op_1', 'zh')
    const url = String(f.mock.calls[0]?.[0] ?? '')
    expect(url).toContain('operatorId=op_1')
    expect(url).toContain('locale=zh')
  })

  it('omits locale entirely when none is passed (no locale=undefined)', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await createAddOn({ nameI18n: { en: 'GPS' }, priceJpy: 1500, operatorId: 'op_1' }, 'csrf')
    expect(String(f.mock.calls[0]?.[0] ?? '')).not.toContain('locale=')
  })

  it('archiveAddOn still binds the picked operator after the writeQuery refactor (#1456)', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await archiveAddOn('ao_1', 'csrf', 'op_1')
    const [url, init] = f.mock.calls[0] ?? []
    expect(String(url ?? '')).toContain('operatorId=op_1')
    expect(init).toMatchObject({ method: 'DELETE' })
  })
})
