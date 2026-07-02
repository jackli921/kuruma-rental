import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, submitOperatorApplication } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('submitOperatorApplication', () => {
  it('POSTs to /api/operator-applications with credentials omitted', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'a1', status: 'PENDING' } }),
    )
    const r = await submitOperatorApplication({ businessName: 'X' } as never)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/operator-applications',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
      }),
    )
    expect(r).toEqual({ id: 'a1', status: 'PENDING' })
  })
  it('throws ApiError on a 409 envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'dup' }, 409))
    const rejection = submitOperatorApplication({} as never)
    await expect(rejection).rejects.toBeInstanceOf(ApiError)
    await expect(rejection).rejects.toMatchObject({ status: 409 })
  })
})
