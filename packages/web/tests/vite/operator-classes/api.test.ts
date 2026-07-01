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
  it('fetches the manage list with includeArchived + includeAll + cookie auth', async () => {
    const rows = [{ ...validClass, status: 'ARCHIVED' as const }]
    const fetchMock = stubFetch({ success: true, data: rows })

    const result = await fetchOperatorClasses({ includeArchived: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/vehicle-classes/manage?includeArchived=true&includeAll=true',
      {
        credentials: 'include',
      },
    )
    expect(result).toEqual(rows)
  })

  it('sends includeAll by default so bypass readers make an explicit all-operators choice', async () => {
    const fetchMock = stubFetch({ success: true, data: [] })
    await fetchOperatorClasses()
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/manage?includeAll=true', {
      credentials: 'include',
    })
  })

  it('scopes the read to operatorId and drops includeAll when an admin picks a tenant', async () => {
    const fetchMock = stubFetch({ success: true, data: [] })
    await fetchOperatorClasses({ includeArchived: true }, 'op_9')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('operatorId=op_9')
    expect(url).toContain('includeArchived=true')
    expect(url).not.toContain('includeAll')
  })

  it('keys queryOptions on includeArchived and picked operator so scoped views never collide', () => {
    expect(operatorClassesQueryOptions({ includeArchived: true }).queryKey).toEqual([
      'operator-classes',
      true,
      'all',
    ])
    expect(operatorClassesQueryOptions({}, 'op_9').queryKey).toEqual([
      'operator-classes',
      false,
      'op_9',
    ])
  })

  it('create POSTs to the collection with cookie auth and JSON body', async () => {
    const created = { ...validClass, id: 'c2', name: 'SUV', slug: 'suv' }
    const fetchMock = stubFetch({ success: true, data: created })

    const input = { operatorId: 'op1', name: 'SUV', slug: 'suv', seats: 5, luggageCapacity: 2 }
    const result = await createOperatorClass(input as never, 'test-csrf')

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' },
      body: JSON.stringify(input),
    })
    expect(result).toEqual(created)
  })

  it('update PATCHes the :id resource', async () => {
    const fetchMock = stubFetch({ success: true, data: { ...validClass, name: 'Renamed' } })
    await updateOperatorClass('c1', { name: 'Renamed' } as never, 'test-csrf')

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
  })

  it('archive DELETEs the :id resource (soft archive)', async () => {
    const archived = { ...validClass, status: 'ARCHIVED' as const }
    const fetchMock = stubFetch({ success: true, data: archived })
    const result = await archiveOperatorClass('c1', 'test-csrf')

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicle-classes/c1', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-CSRF-Token': 'test-csrf' },
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

  it('rejects with a ParseError naming luggageSize when it is null (#789)', async () => {
    // The class column is NOT NULL DEFAULT 'MEDIUM' and the DTO is non-null
    // LuggageSize, so a null here is contract drift, not a legacy value. The
    // schema must fail at the seam rather than widen OperatorClass to `| null`.
    stubFetch({ success: true, data: [{ ...validClass, luggageSize: null }] })
    const error = await fetchOperatorClasses().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ParseError)
    // Pin the failure to luggageSize so a drifted fixture can't pass for the
    // wrong reason: the offending Zod issue must name the field.
    expect((error as ParseError).issues).toContainEqual(
      expect.objectContaining({ path: expect.arrayContaining(['luggageSize']) }),
    )
  })
})
