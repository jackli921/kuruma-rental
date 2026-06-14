import { ParseError } from '@/lib/api-error'
import {
  archiveOperatorClass,
  createOperatorClass,
  fetchOperatorClasses,
  operatorClassesQueryOptions,
  updateOperatorClass,
} from '@/vite/operator-classes/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

// A complete OperatorClass row — the response schema now rejects partials, so
// fixtures that exercise a validated path must carry every field.
const validClass = {
  id: 'c1',
  operatorId: 'op1',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM' as const,
  transmission: 'AUTO' as const,
  fuelType: null,
  acrissCode: null,
  sortOrder: 0,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('operator-classes api', () => {
  it('fetches the operator-scoped manage list with includeArchived + cookie auth', async () => {
    const rows = [{ ...validClass, status: 'ARCHIVED' as const }]
    const fetchMock = stubFetch({ success: true, data: rows })

    const result = await fetchOperatorClasses({ includeArchived: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/manage?includeArchived=true', {
      credentials: 'include',
    })
    expect(result).toEqual(rows)
  })

  it('omits the includeArchived param by default', async () => {
    const fetchMock = stubFetch({ success: true, data: [] })
    await fetchOperatorClasses()
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/manage', {
      credentials: 'include',
    })
  })

  it('keys queryOptions on includeArchived so archived/active views never collide', () => {
    expect(operatorClassesQueryOptions({ includeArchived: true }).queryKey).toEqual([
      'operator-classes',
      true,
    ])
    expect(operatorClassesQueryOptions().queryKey).toEqual(['operator-classes', false])
  })

  it('create POSTs to the collection with cookie auth and JSON body', async () => {
    const created = { ...validClass, id: 'c2', name: 'SUV', slug: 'suv' }
    const fetchMock = stubFetch({ success: true, data: created })

    const input = { operatorId: 'op1', name: 'SUV', slug: 'suv', seats: 5, luggageCapacity: 2 }
    const result = await createOperatorClass(input as never)

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    expect(result).toEqual(created)
  })

  it('update PATCHes the :id resource', async () => {
    const fetchMock = stubFetch({ success: true, data: { ...validClass, name: 'Renamed' } })
    await updateOperatorClass('c1', { name: 'Renamed' } as never)

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
  })

  it('archive DELETEs the :id resource (soft archive)', async () => {
    const archived = { ...validClass, status: 'ARCHIVED' as const }
    const fetchMock = stubFetch({ success: true, data: archived })
    const result = await archiveOperatorClass('c1')

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'DELETE',
      credentials: 'include',
    })
    expect(result).toEqual(archived)
  })

  it('rejects with a ParseError when a class row is missing a required field (drift)', async () => {
    // The API dropped `seats`; the legacy cast surfaced it as `undefined` deep in
    // the grid. With a response schema the contract drift fails at the seam.
    stubFetch({
      success: true,
      data: [{ id: 'c1', name: 'Compact', slug: 'compact', status: 'ACTIVE' }],
    })
    await expect(fetchOperatorClasses()).rejects.toBeInstanceOf(ParseError)
  })
})
