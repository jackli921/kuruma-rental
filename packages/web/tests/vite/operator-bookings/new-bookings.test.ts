import {
  LAST_SEEN_STORAGE_KEY,
  countNewBookings,
  getStoredLastSeenAt,
  markBookingsSeen,
} from '@/vite/operator-bookings/new-bookings'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

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
  it('advances lastSeenAt to now in both storage and the query cache', () => {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, '2020-01-01T00:00:00.000Z')
    const qc = new QueryClient()
    markBookingsSeen(qc)

    const stored = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
    expect(stored).not.toBe('2020-01-01T00:00:00.000Z')
    expect(new Date(stored as string).getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00.000Z').getTime(),
    )
    // Same value mirrored into the cache so subscribers (the nav badge) re-derive.
    expect(qc.getQueryData(['operator-bookings', 'last-seen-at'])).toBe(stored)
  })
})
