import { ParseError } from '@/lib/api-error'
import {
  FEE_QUERY_KEY,
  archiveFeeSchedule,
  createFeeSchedule,
  feeSchedulesQueryOptions,
  fetchFeeSchedules,
  updateFeeSchedule,
} from '@/vite/operator-fees/api'
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

const fee = {
  id: 'fee_1',
  operatorId: 'op_1',
  vehicleClassId: null,
  feeType: 'CLEANING_FLAT' as const,
  unit: 'FLAT' as const,
  amountJpy: 3000,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('fetchFeeSchedules', () => {
  it('GETs /api/fee-schedules?includeArchived=true with credentials and unwraps the array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [fee] }))

    const result = await fetchFeeSchedules()

    expect(fetchMock).toHaveBeenCalledWith('/api/fee-schedules?includeArchived=true', {
      credentials: 'include',
    })
    expect(result).toEqual([fee])
  })

  it('sends NO operatorId — the cookie session scopes the read server-side', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchFeeSchedules()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('operatorId')
  })

  it('throws an ApiError carrying the status on a failure envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Forbidden' }, 403))
    await expect(fetchFeeSchedules()).rejects.toThrow('Forbidden')
  })

  it('throws a ParseError when a row drifts from the schema (#711)', async () => {
    // A success body whose `amountJpy` arrived as a string (a contract drift)
    // must fail at the seam, not surface as a NaN deep in the fee table.
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...fee, amountJpy: 'oops' }] }),
    )
    await expect(fetchFeeSchedules()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('createFeeSchedule', () => {
  it('POSTs the body to /api/fee-schedules with the CSRF + JSON headers and unwraps the row', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: fee }, 201))

    const input = {
      feeType: 'CLEANING_FLAT' as const,
      unit: 'FLAT' as const,
      amountJpy: 3000,
      vehicleClassId: null,
    }
    const result = await createFeeSchedule(input, 'csrf-7')

    expect(result).toEqual(fee)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/fee-schedules')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-7' })
    expect(JSON.parse(init.body as string)).toEqual(input)
  })

  it('surfaces the INVALID_VEHICLE_CLASS failure (foreign class) as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: 'Unknown vehicle class', code: 'INVALID_VEHICLE_CLASS' },
        400,
      ),
    )
    await expect(
      createFeeSchedule(
        { feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 500, vehicleClassId: 'foreign' },
        'csrf',
      ),
    ).rejects.toThrow('Unknown vehicle class')
  })
})

describe('updateFeeSchedule', () => {
  it('PATCHes /api/fee-schedules/:id with the CSRF header and the partial body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...fee, amountJpy: 4000 } }))

    const result = await updateFeeSchedule('fee_1', { amountJpy: 4000 }, 'csrf-8')

    expect(result.amountJpy).toBe(4000)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/fee-schedules/fee_1')
    expect(init.method).toBe('PATCH')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-8' })
    expect(JSON.parse(init.body as string)).toEqual({ amountJpy: 4000 })
  })
})

describe('archiveFeeSchedule', () => {
  it('DELETEs /api/fee-schedules/:id with the CSRF header and no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...fee, status: 'ARCHIVED' } }),
    )

    const result = await archiveFeeSchedule('fee_1', 'csrf-9')

    expect(result.status).toBe('ARCHIVED')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/fee-schedules/fee_1')
    expect(init.method).toBe('DELETE')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-9' })
    expect(init.body).toBeUndefined()
  })
})

describe('feeSchedulesQueryOptions', () => {
  it('exposes the stable FEE_QUERY_KEY so writes can invalidate it', () => {
    expect(FEE_QUERY_KEY).toEqual(['operator-fees'])
    expect(feeSchedulesQueryOptions().queryKey).toEqual(['operator-fees'])
  })
})
