import { ParseError } from '@/lib/api-error'
import type { Customer, CustomerWithBookings } from '@kuruma/shared/types/customer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADMIN_CUSTOMERS_QUERY_KEY,
  customerByIdQueryOptions,
  customersQueryOptions,
  fetchCustomerById,
  fetchCustomers,
} from './api'

// Mock Response that models single-consumption like a real `fetch` body: each
// Response's `json()` succeeds once then throws, and `clone()` yields a fresh
// INDEPENDENT body. This locks in the load-bearing `res.clone()` in
// fetchCustomers — peeking the envelope sibling `nextCursor` off a clone before
// unwrap consumes the original. Drop the clone and the second read throws, so a
// re-read regression fails here instead of passing against an infinitely
// re-readable stub.
function jsonResponse(body: unknown, status = 200): Response {
  const make = (): Response => {
    let consumed = false
    const res = {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (consumed) throw new TypeError('Body has already been consumed.')
        consumed = true
        return body
      },
      clone: () => make(),
    } as unknown as Response
    return res
  }
  return make()
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const customer: Customer = {
  id: 'usr_1',
  name: 'Aiko Tanaka',
  email: 'aiko@example.com',
  language: 'ja',
  country: 'JP',
  bookingCount: 3,
  lastBookingAt: '2026-06-01T09:00:00.000Z',
  totalSpent: 48000,
}

const customerWithBookings: CustomerWithBookings = {
  ...customer,
  bookings: [
    {
      id: 'bk_1',
      vehicleId: 'veh_1',
      vehicleName: 'Toyota Aqua',
      startAt: '2026-06-01T09:00:00.000Z',
      endAt: '2026-06-03T09:00:00.000Z',
      status: 'COMPLETED',
      totalPrice: 16000,
    },
  ],
}

describe('fetchCustomers', () => {
  it('GETs /customers with credentials and the search/sort/cursor/limit params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [customer], nextCursor: null }))

    await fetchCustomers({ search: 'aiko', sort: 'bookingCount', cursor: 'c_42', limit: 20 })

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(opts).toEqual({ credentials: 'include' })
    expect(url).toMatch(/\/customers\?/)
    const query = new URLSearchParams(String(url).split('?')[1])
    expect(query.get('search')).toBe('aiko')
    expect(query.get('sort')).toBe('bookingCount')
    expect(query.get('cursor')).toBe('c_42')
    expect(query.get('limit')).toBe('20')
  })

  it('omits empty search/sort/cursor but always sends a default limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], nextCursor: null }))

    await fetchCustomers()

    const query = new URLSearchParams(String(fetchMock.mock.calls[0]![0]).split('?')[1])
    expect(query.has('search')).toBe(false)
    expect(query.has('sort')).toBe(false)
    expect(query.has('cursor')).toBe(false)
    expect(query.get('limit')).toBe('20')
  })

  it('returns the validated rows and lifts nextCursor from the envelope sibling', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [customer], nextCursor: 'cursor_next' }),
    )

    const page = await fetchCustomers()

    expect(page.data).toEqual([customer])
    expect(page.nextCursor).toBe('cursor_next')
  })

  it('treats a missing envelope nextCursor as the last page (null)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [customer] }))

    const page = await fetchCustomers()

    expect(page.nextCursor).toBeNull()
  })

  it('rejects with a ParseError when a row drifts (bookingCount as a string)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ ...customer, bookingCount: '3' }],
        nextCursor: null,
      }),
    )

    await expect(fetchCustomers()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('fetchCustomerById', () => {
  it('GETs /customers/:id and returns the validated booking history', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: customerWithBookings }))

    const result = await fetchCustomerById('usr_1')

    expect(fetchMock).toHaveBeenCalledWith('/api/customers/usr_1', { credentials: 'include' })
    expect(result).toEqual(customerWithBookings)
  })

  it('maps a 404 to null rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Customer not found' }, 404))

    expect(await fetchCustomerById('missing')).toBeNull()
  })

  it('rejects with a ParseError when a booking carries an out-of-domain status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          ...customerWithBookings,
          bookings: [{ ...customerWithBookings.bookings[0], status: 'WAT' }],
        },
      }),
    )

    await expect(fetchCustomerById('usr_1')).rejects.toBeInstanceOf(ParseError)
  })
})

describe('query options', () => {
  it('keys the list query by search, sort and cursor so each page caches separately', () => {
    expect(customersQueryOptions({ search: 'aiko', sort: 'name', cursor: 'c_1' }).queryKey).toEqual(
      [...ADMIN_CUSTOMERS_QUERY_KEY, 'list', 'aiko', 'name', 'c_1'],
    )
    expect(customersQueryOptions().queryKey).toEqual([
      ...ADMIN_CUSTOMERS_QUERY_KEY,
      'list',
      null,
      null,
      null,
    ])
  })

  it('disables the detail query until a customer is selected', () => {
    expect(customerByIdQueryOptions(null).enabled).toBe(false)
    expect(customerByIdQueryOptions('usr_1').enabled).toBe(true)
  })
})
