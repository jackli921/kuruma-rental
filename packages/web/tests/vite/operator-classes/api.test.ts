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

describe('operator-classes api', () => {
  it('fetches the operator-scoped manage list with includeArchived + cookie auth', async () => {
    const rows = [{ id: 'c1', name: 'Compact', status: 'ARCHIVED' }]
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
    const created = { id: 'c2', name: 'SUV', status: 'ACTIVE' }
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
    const fetchMock = stubFetch({ success: true, data: { id: 'c1', name: 'Renamed' } })
    await updateOperatorClass('c1', { name: 'Renamed' } as never)

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
  })

  it('archive DELETEs the :id resource (soft archive)', async () => {
    const fetchMock = stubFetch({ success: true, data: { id: 'c1', status: 'ARCHIVED' } })
    const result = await archiveOperatorClass('c1')

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'DELETE',
      credentials: 'include',
    })
    expect(result).toEqual({ id: 'c1', status: 'ARCHIVED' })
  })
})
