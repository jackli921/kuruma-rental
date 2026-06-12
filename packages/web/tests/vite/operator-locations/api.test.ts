import { fetchOperatorLocations } from '@/vite/operator-locations/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchOperatorLocations', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requests archived rows and opts bypass-scope callers into the cross-operator read', async () => {
    // #529 / #435: `_business` admits bypass roles (STAFF/ADMIN/PLATFORM_ADMIN);
    // GET /locations 400s for them unless includeAll=true is sent. Operator roles
    // auto-scope server-side and the API ignores the flag, so it's safe to always
    // send. Without it, every bypass user lands on the load-error state.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchOperatorLocations()

    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('includeArchived=true')
    expect(url).toContain('includeAll=true')
    // Cookie carries the tenant — the client never names an operator.
    expect(url).not.toContain('operatorId')
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })
  })
})
