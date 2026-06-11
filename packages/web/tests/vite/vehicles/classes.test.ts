import { fetchActiveClasses, fetchClassById, fetchClassBySlug } from '@/vite/vehicles/classes'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => fetchMock.mockReset())

const classData = {
  id: 'c1',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  transmission: 'AUTO',
  fuelType: null,
  acrissCode: 'CDAR',
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('fetchActiveClasses', () => {
  it('requests the active classes from the proxied /api and unwraps the envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [classData] }))
    const result = await fetchActiveClasses()
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes?status=ACTIVE', {
      credentials: 'include',
    })
    expect(result).toEqual([classData])
  })

  it('throws an ApiError carrying the status when the API fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))
    await expect(fetchActiveClasses()).rejects.toThrow('boom')
  })
})

describe('fetchClassBySlug', () => {
  it('unwraps the class on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: classData }))
    const result = await fetchClassBySlug('compact')
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/by-slug/compact', {
      credentials: 'include',
    })
    expect(result).toEqual(classData)
  })

  it('returns null for a 404 instead of throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))
    expect(await fetchClassBySlug('missing')).toBeNull()
  })

  it('encodes the slug', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: classData }))
    await fetchClassBySlug('a/b')
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/by-slug/a%2Fb', {
      credentials: 'include',
    })
  })
})

describe('fetchClassById', () => {
  it('GETs the protected /vehicle-classes/:id with credentials and unwraps the class', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: classData }))
    const result = await fetchClassById('c1')
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      credentials: 'include',
    })
    expect(result).toEqual(classData)
  })

  it('returns null for a 404 (archived/unknown class) instead of throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))
    expect(await fetchClassById('missing')).toBeNull()
  })

  it('throws an ApiError carrying the status on a non-404 failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))
    await expect(fetchClassById('c1')).rejects.toMatchObject({ status: 500 })
  })

  it('encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: classData }))
    await fetchClassById('a/b')
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/a%2Fb', {
      credentials: 'include',
    })
  })
})
