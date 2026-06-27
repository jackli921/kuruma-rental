import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAddOns } from './api'

const fetchSpy = vi.spyOn(globalThis, 'fetch')
afterEach(() => fetchSpy.mockReset())

function okJson(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, data: body }), { status: 200 }),
  )
}

describe('fetchAddOns scoping', () => {
  it('sends includeAll=true when no operator is picked', async () => {
    fetchSpy.mockReturnValue(okJson([]))
    await fetchAddOns(undefined)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('includeAll=true')
  })

  it('sends operatorId when an operator is picked (no includeAll)', async () => {
    fetchSpy.mockReturnValue(okJson([]))
    await fetchAddOns('op_9')
    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('operatorId=op_9')
    expect(url).not.toContain('includeAll')
  })

  it('still requests archived rows so the management list badges them', async () => {
    fetchSpy.mockReturnValue(okJson([]))
    await fetchAddOns('op_9')
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('includeArchived=true')
  })
})
