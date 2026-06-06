// #435 P1: the vehicle pickup-location picker must list locations for
// bypass-scope admins (PLATFORM_ADMIN), but GET /locations rejects an unscoped
// cross-operator read with 400 unless `operatorId` or `includeAll=true` is
// passed (packages/api/src/routes/locations.ts). This pins that fetchLocations
// forwards `includeAll`/`includeArchived` as query params so the picker query
// (includeAll: true) actually reaches the API scoped correctly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

import { fetchLocations } from '@/modules/locations/api'

function jsonOk(): Response {
  return new Response(JSON.stringify({ success: true, data: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function calledUrl(): string {
  const arg = vi.mocked(fetch).mock.calls[0]?.[0]
  return arg instanceof Request ? arg.url : String(arg)
}

describe('fetchLocations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends includeAll=true when requested (cross-operator read for bypass admins)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk())
    await fetchLocations({ includeAll: true })
    expect(calledUrl()).toContain('includeAll=true')
  })

  it('sends includeArchived=true when requested', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk())
    await fetchLocations({ includeArchived: true })
    expect(calledUrl()).toContain('includeArchived=true')
  })

  it('sends no scope params by default (operator-scoped callers auto-scope)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk())
    await fetchLocations()
    const url = calledUrl()
    expect(url).not.toContain('includeAll')
    expect(url).not.toContain('includeArchived')
  })
})
