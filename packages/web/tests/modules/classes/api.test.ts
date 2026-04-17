import { beforeEach, describe, expect, it, vi } from 'vitest'

const API_BASE = 'http://localhost:8787'

vi.mock('@/lib/api-client', () => ({
  createApiClient: (_token?: string) => {
    const { hc } = require('hono/client')
    return hc('http://localhost:8787')
  },
}))

const mockClass = {
  id: 'c1',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  transmission: 'AUTO',
  fuelType: null,
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('classes api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('fetchClasses', () => {
    it('calls GET /vehicle-classes and unwraps response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [mockClass] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchClasses } = await import('@/modules/classes/api')
      const result = await fetchClasses()

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicle-classes`)
      expect(result).toEqual([mockClass])
    })

    it('passes includeArchived=true as query param', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchClasses } = await import('@/modules/classes/api')
      await fetchClasses({ includeArchived: true })

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toContain('includeArchived=true')
    })
  })

  describe('fetchClassBySlug', () => {
    it('calls GET /vehicle-classes/by-slug/:slug and unwraps response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: mockClass }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchClassBySlug } = await import('@/modules/classes/api')
      const result = await fetchClassBySlug('compact')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicle-classes/by-slug/compact`)
      expect(result).toEqual(mockClass)
    })

    it('returns null on 404 not-found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Vehicle class not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchClassBySlug } = await import('@/modules/classes/api')
      const result = await fetchClassBySlug('nope')
      expect(result).toBeNull()
    })

    it('does not send Authorization header when no token is given (public endpoint)', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: mockClass }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { fetchClassBySlug } = await import('@/modules/classes/api')
      await fetchClassBySlug('compact')

      const init = spy.mock.calls[0]?.[1] as RequestInit | undefined
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers.Authorization).toBeUndefined()
    })
  })

  describe('createClass', () => {
    it('POSTs JSON and returns created class', async () => {
      const input = {
        name: 'Compact',
        slug: 'compact',
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO' as const,
        photos: [],
        sortOrder: 0,
        dailyRateJpy: 8000,
      }
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: mockClass }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { createClass } = await import('@/modules/classes/api')
      const result = await createClass(input)

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicle-classes`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual(input)
      expect(result.slug).toBe('compact')
    })
  })

  describe('updateClass', () => {
    it('PATCHes /vehicle-classes/:id with body', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ...mockClass, name: 'Renamed' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { updateClass } = await import('@/modules/classes/api')
      const result = await updateClass('c1', { name: 'Renamed' })

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicle-classes/c1`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual({ name: 'Renamed' })
      expect(result.name).toBe('Renamed')
    })

    it('passes Authorization header when token is provided', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: mockClass }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { updateClass } = await import('@/modules/classes/api')
      await updateClass('c1', { name: 'X' }, 'test-jwt')

      const init = spy.mock.calls[0]?.[1] as RequestInit
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-jwt')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('archiveClass', () => {
    it('DELETEs /vehicle-classes/:id', async () => {
      const spy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: true, data: { ...mockClass, status: 'ARCHIVED' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )

      const { archiveClass } = await import('@/modules/classes/api')
      const result = await archiveClass('c1')

      const calledUrl = spy.mock.calls[0]?.[0]?.toString() ?? ''
      expect(calledUrl).toBe(`${API_BASE}/vehicle-classes/c1`)
      const init = spy.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('DELETE')
      expect(result.status).toBe('ARCHIVED')
    })

    it('surfaces server errors as thrown Error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Vehicle class not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const { archiveClass } = await import('@/modules/classes/api')
      await expect(archiveClass('nope')).rejects.toThrow('Vehicle class not found')
    })
  })
})
