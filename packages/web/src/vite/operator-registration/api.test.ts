import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, submitOperatorApplication } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('submitOperatorApplication', () => {
  it('POSTs to /api/operator-applications with the session cookie and CSRF token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'a1', status: 'PENDING' } }),
    )
    const r = await submitOperatorApplication({ businessName: 'X' } as never, 'csrf-abc')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/operator-applications',
      expect.objectContaining({
        method: 'POST',
        // Sign-in-first (#877): the endpoint is authed now — send the session cookie.
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-abc',
        }),
      }),
    )
    expect(r).toEqual({ id: 'a1', status: 'PENDING' })
  })
  it('never sends a contactEmail in the body — the server derives it from the session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'a1', status: 'PENDING' } }),
    )
    await submitOperatorApplication({ businessName: 'X', contactName: 'Y' } as never, 'csrf-abc')
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('contactEmail')
    expect(body).toMatchObject({ businessName: 'X', contactName: 'Y' })
  })
  it('throws ApiError on a 409 envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'dup' }, 409))
    const rejection = submitOperatorApplication({} as never, 'csrf-abc')
    await expect(rejection).rejects.toBeInstanceOf(ApiError)
    await expect(rejection).rejects.toMatchObject({ status: 409 })
  })
})
