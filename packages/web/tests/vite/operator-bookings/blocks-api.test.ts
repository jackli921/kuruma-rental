import {
  type CreateBlockInput,
  createBlock,
  deleteBlock,
  fetchCalendarBlocks,
  operatorCalendarBlocksQueryOptions,
} from '@/vite/operator-bookings/api'
import { calendarBlockSchema } from '@/vite/operator-bookings/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

// #1101 Slice B B1: the operator-calendar blocks read/write client. Mirrors the
// fetch-mock convention in currency-api.test.ts; getApiBaseUrl() is `/api` in test.

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

const blockRow = {
  id: '00000000-0000-0000-0000-0000000000b1',
  vehicleId: '00000000-0000-0000-0000-000000000010',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-02T09:00:00.000Z',
  kind: 'MAINTENANCE' as const,
  reason: 'Oil change',
  notes: null,
}

describe('calendarBlockSchema', () => {
  it('parses a block row (display fields only — no createdBy/operatorId)', () => {
    const result = calendarBlockSchema.parse({
      ...blockRow,
      // The server JSON also carries these; the DTO must drop them, not choke.
      operatorId: '00000000-0000-0000-0000-0000000000aa',
      createdBy: '00000000-0000-0000-0000-0000000000cc',
      createdAt: '2026-07-01T08:00:00.000Z',
    })
    expect(result).toEqual(blockRow)
    expect('createdBy' in result).toBe(false)
  })

  it('rejects a row whose kind is not a VEHICLE_BLOCK_KIND', () => {
    expect(() => calendarBlockSchema.parse({ ...blockRow, kind: 'BOGUS' })).toThrow()
  })
})

describe('fetchCalendarBlocks', () => {
  it('GETs /api/vehicle-blocks with the from/to range and credentials, unwrapping the array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [blockRow] }))

    const result = await fetchCalendarBlocks('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/vehicle-blocks?')
    expect(url).toContain('from=2026-07-01T00%3A00%3A00.000Z')
    expect(url).toContain('to=2026-07-08T00%3A00%3A00.000Z')
    expect(init.credentials).toBe('include')
    expect(result).toEqual([blockRow])
  })
})

describe('createBlock', () => {
  it('POSTs to /api/vehicles/:id/blocks with the CSRF token + JSON body, unwrapping the created block', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: blockRow }, 201))
    const input: CreateBlockInput = {
      kind: 'MAINTENANCE',
      reason: 'Oil change',
      startAt: blockRow.startAt,
      endAt: blockRow.endAt,
    }

    const result = await createBlock(blockRow.vehicleId, input, 'csrf-tok')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/vehicles/${blockRow.vehicleId}/blocks`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-tok')
    expect(JSON.parse(init.body as string)).toEqual(input)
    expect(result).toEqual(blockRow)
  })

  it('binds the write to the picked operator via ?operatorId= (#1260)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: blockRow }, 201))
    const input: CreateBlockInput = {
      kind: 'MAINTENANCE',
      reason: 'Oil change',
      startAt: blockRow.startAt,
      endAt: blockRow.endAt,
    }

    await createBlock(blockRow.vehicleId, input, 'csrf-tok', 'op-a')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`/api/vehicles/${blockRow.vehicleId}/blocks?operatorId=op-a`)
  })
})

describe('deleteBlock', () => {
  it('DELETEs /api/vehicles/:id/blocks/:blockId with the CSRF token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: blockRow }))

    await deleteBlock(blockRow.vehicleId, blockRow.id, 'csrf-tok')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/vehicles/${blockRow.vehicleId}/blocks/${blockRow.id}`)
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-tok')
  })

  it('binds the delete to the picked operator via ?operatorId= (#1260)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: blockRow }))

    await deleteBlock(blockRow.vehicleId, blockRow.id, 'csrf-tok', 'op-a')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`/api/vehicles/${blockRow.vehicleId}/blocks/${blockRow.id}?operatorId=op-a`)
  })
})

describe('operatorCalendarBlocksQueryOptions', () => {
  it('keys the cache under the operator-bookings/blocks prefix + range', () => {
    const opts = operatorCalendarBlocksQueryOptions('from-iso', 'to-iso')
    expect(opts.queryKey).toEqual(['operator-bookings', 'blocks', 'from-iso', 'to-iso', null])
  })
})
