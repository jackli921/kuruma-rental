import { ParseError } from '@/lib/api-error'
import {
  LAST_SEEN_STORAGE_KEY,
  countNewBookings,
  fetchNewOrderBookings,
  getStoredLastSeenAt,
  lastSeenQueryKey,
  lastSeenStorageKey,
  markBookingsSeen,
  newOrderScanQueryKey,
} from '@/vite/operator-bookings/new-bookings'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('countNewBookings', () => {
  const lastSeen = '2026-06-13T00:00:00.000Z'

  it('counts only bookings created strictly after lastSeenAt', () => {
    const bookings = [
      { createdAt: '2026-06-13T02:00:00.000Z' }, // new
      { createdAt: '2026-06-13T01:00:00.000Z' }, // new
      { createdAt: '2026-06-12T23:00:00.000Z' }, // old
      { createdAt: lastSeen }, // exactly equal -> not new
    ]
    expect(countNewBookings(bookings, lastSeen)).toBe(2)
  })

  it('is 0 when nothing is newer than lastSeenAt', () => {
    expect(countNewBookings([{ createdAt: '2026-06-12T00:00:00.000Z' }], lastSeen)).toBe(0)
  })

  it('is 0 for an empty list', () => {
    expect(countNewBookings([], lastSeen)).toBe(0)
  })
})

describe('getStoredLastSeenAt', () => {
  it('returns the stored ISO timestamp when present', () => {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, '2026-01-01T00:00:00.000Z')
    expect(getStoredLastSeenAt()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('initializes to now and persists it on first read (no backlog flood)', () => {
    expect(window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)).toBeNull()
    const first = getStoredLastSeenAt()
    expect(window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)).toBe(first)
    // Stable across reads
    expect(getStoredLastSeenAt()).toBe(first)
  })
})

describe('markBookingsSeen', () => {
  it('anchors lastSeenAt to the newest scanned order (server time, skew-immune)', () => {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, '2020-01-01T00:00:00.000Z')
    const qc = new QueryClient()
    // The scan is ordered createdAt DESC, so the head is the newest seen order.
    // No pick here -> the no-operator scan key (mirrors markBookingsSeen(qc) below).
    qc.setQueryData(newOrderScanQueryKey(undefined), [
      { createdAt: '2026-06-13T05:00:00.000Z' },
      { createdAt: '2026-06-13T04:00:00.000Z' },
    ])

    markBookingsSeen(qc)

    const stored = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
    // Exactly the newest scanned createdAt — NOT the client clock.
    expect(stored).toBe('2026-06-13T05:00:00.000Z')
    // Same value mirrored into the cache so subscribers (the nav badge) re-derive.
    expect(qc.getQueryData(lastSeenQueryKey())).toBe(stored)
  })

  it('falls back to now when no orders have been scanned yet', () => {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, '2020-01-01T00:00:00.000Z')
    const qc = new QueryClient()
    markBookingsSeen(qc)

    const stored = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY) as string
    expect(new Date(stored).getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00.000Z').getTime(),
    )
    expect(qc.getQueryData(lastSeenQueryKey())).toBe(stored)
  })
})

describe('per-operator watermark (#1324)', () => {
  it('namespaces keys by picked operator; no-pick keeps the stable base slot', () => {
    // No-pick (tenant sessions) must keep the exact legacy key so their existing
    // watermark is not reset (no migration); a pick is namespaced by operator id.
    expect(lastSeenStorageKey(undefined)).toBe(LAST_SEEN_STORAGE_KEY)
    expect(lastSeenStorageKey('op_a')).toBe(`${LAST_SEEN_STORAGE_KEY}:op_a`)
    // Mirrors newOrderScanQueryKey's `?? null` no-pick slot.
    expect(lastSeenQueryKey(undefined)).toEqual(['operator-bookings', 'last-seen-at', null])
    expect(lastSeenQueryKey('op_a')).toEqual(['operator-bookings', 'last-seen-at', 'op_a'])
  })

  it("does not measure one operator against another operator's watermark (the slice-5a gap)", () => {
    // Operator A opened its orders at T; that must NOT become operator B's baseline.
    window.localStorage.setItem(lastSeenStorageKey('op_a'), '2026-06-13T05:00:00.000Z')
    const bSeen = getStoredLastSeenAt('op_b')
    expect(bSeen).not.toBe('2026-06-13T05:00:00.000Z')
    // Reading B does not disturb A's slot.
    expect(window.localStorage.getItem(lastSeenStorageKey('op_a'))).toBe('2026-06-13T05:00:00.000Z')
  })

  it("markBookingsSeen advances only the picked operator's slot", () => {
    const qc = new QueryClient()
    window.localStorage.setItem(lastSeenStorageKey('op_a'), '2020-01-01T00:00:00.000Z')
    window.localStorage.setItem(lastSeenStorageKey('op_b'), '2020-01-01T00:00:00.000Z')
    qc.setQueryData(newOrderScanQueryKey('op_a'), [{ createdAt: '2026-06-13T05:00:00.000Z' }])

    markBookingsSeen(qc, 'op_a')

    expect(window.localStorage.getItem(lastSeenStorageKey('op_a'))).toBe('2026-06-13T05:00:00.000Z')
    // Operator B's watermark is untouched by advancing A.
    expect(window.localStorage.getItem(lastSeenStorageKey('op_b'))).toBe('2020-01-01T00:00:00.000Z')
    expect(qc.getQueryData(lastSeenQueryKey('op_a'))).toBe('2026-06-13T05:00:00.000Z')
    expect(qc.getQueryData(lastSeenQueryKey('op_b'))).toBeUndefined()
  })
})

describe('fetchNewOrderBookings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests CONFIRMED bookings (limit 50) and strips every field but createdAt', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          {
            id: 'b1',
            status: 'CONFIRMED',
            totalPrice: 30000,
            createdAt: '2026-06-13T05:00:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchNewOrderBookings()

    expect(fetchMock).toHaveBeenCalledWith('/api/bookings?status=CONFIRMED&limit=50', {
      credentials: 'include',
    })
    // The badge only needs createdAt; the ~25 other booking fields are stripped.
    expect(result).toEqual([{ createdAt: '2026-06-13T05:00:00.000Z' }])
  })

  it('rejects with a ParseError when a row lacks createdAt (drift #711)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [{ id: 'b1', status: 'CONFIRMED' }] })),
    )
    await expect(fetchNewOrderBookings()).rejects.toBeInstanceOf(ParseError)
  })
})
