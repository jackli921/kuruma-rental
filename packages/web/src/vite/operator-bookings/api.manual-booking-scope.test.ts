import {
  type CreateManualBookingInput,
  createManualBooking,
  customerSearchQueryOptions,
  searchCustomers,
} from '@/vite/operator-bookings/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

// #1260: the manual-booking write + its customer search must carry the picker
// admin's chosen operator (?operatorId=) so the server binds/scopes to it. These
// pin the URL wiring — without it a picker admin's create 422s and its search
// offers un-bookable customers. We only assert the request URL, so the mocked
// response is a failure body (unwrap rejects; the .catch swallows it).
describe('operator-bookings api — #1260 picker-operator scoping', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch() {
    const res = { status: 500, json: async () => ({ success: false, error: 'boom' }) }
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
    return String(fetchMock.mock.calls[0]?.[0])
  }

  const manualInput: CreateManualBookingInput = {
    requestedVehicleId: 'v1',
    pickupLocationId: 'l1',
    dropoffLocationId: 'l1',
    startAt: '2026-07-10T00:00:00Z',
    endAt: '2026-07-11T00:00:00Z',
    customer: { kind: 'walk-in', name: 'A', phone: '+81-90-0000-0000' },
    idempotencyKey: 'k1',
  }

  it('createManualBooking appends ?operatorId= when a picker admin acts as an operator', async () => {
    const fetchMock = mockFetch()
    await createManualBooking(manualInput, 'csrf', 'op-7').catch(() => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calledUrl(fetchMock)).toContain('/bookings?operatorId=op-7')
  })

  it('createManualBooking omits operatorId for a tenant operator (no pick)', async () => {
    const fetchMock = mockFetch()
    await createManualBooking(manualInput, 'csrf').catch(() => {})
    const url = calledUrl(fetchMock)
    expect(url).toContain('/bookings')
    expect(url).not.toContain('operatorId=')
  })

  it('searchCustomers scopes to the picked operator', async () => {
    const fetchMock = mockFetch()
    await searchCustomers('tanaka', 'op-7').catch(() => {})
    const url = calledUrl(fetchMock)
    expect(url).toContain('q=tanaka')
    expect(url).toContain('operatorId=op-7')
  })

  it('searchCustomers omits operatorId when none is picked', async () => {
    const fetchMock = mockFetch()
    await searchCustomers('tanaka').catch(() => {})
    expect(calledUrl(fetchMock)).not.toContain('operatorId=')
  })

  // CustomerPicker drives its search through customerSearchQueryOptions, so pinning
  // that the picked operator lands in BOTH the query key (refetch on switch) and the
  // queryFn's request covers the picker's wiring without a render.
  it('customerSearchQueryOptions carries the picked operator in the key and the fetch', async () => {
    const opts = customerSearchQueryOptions('tanaka', 'op-7')
    expect(opts.queryKey).toContain('op-7')
    const fetchMock = mockFetch()
    await (opts.queryFn as () => Promise<unknown>)().catch(() => {})
    expect(calledUrl(fetchMock)).toContain('operatorId=op-7')
  })
})
