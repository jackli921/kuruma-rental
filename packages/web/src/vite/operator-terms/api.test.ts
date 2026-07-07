import { describe, expect, it, vi } from 'vitest'
import { publishOperatorTermsVersion, saveOperatorTermsDraft } from './api'

const version = {
  version: 'v1',
  status: 'DRAFT',
  effectiveFrom: '2026-06-01T00:00:00.000Z',
  publishedAt: null,
  locales: ['en'],
  title: 'T',
  body: 'B',
  acceptanceLabel: 'I agree',
}
function mockOk() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: version }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('operator-terms api', () => {
  it('saves a draft with the locale bundle', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await saveOperatorTermsDraft(
      { en: { title: 'T', body: 'B', acceptanceLabel: 'I agree' } },
      'csrf',
    )
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })
  it('binds publish to the picked operator', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await publishOperatorTermsVersion('v1', 'csrf', 'op_A')
    expect(f.mock.calls[0]?.[0]).toContain('/operator-terms/v1/publish?operatorId=op_A')
  })
})
