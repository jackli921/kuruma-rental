import { LAST_SEEN_STORAGE_KEY, markBookingsSeen } from '@/vite/operator-bookings/new-bookings'
import { useNewBookingsBadge } from '@/vite/operator-bookings/useNewBookingsBadge'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The badge reads the picked operator via useOptionalPickedOperatorId (a router
// hook). Stub it so the hook renders without a RouterProvider; a mutable ref lets
// one case assert a picked operator narrows the scan. Default: no pick (undefined).
const pickedRef = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('@/vite/operator-context', () => ({
  useOptionalPickedOperatorId: () => pickedRef.value,
}))

const LAST_SEEN = '2026-06-13T00:00:00.000Z'

function mockBookings(rows: { createdAt: string }[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: rows }),
  } as unknown as Response)
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, LAST_SEEN)
  pickedRef.value = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useNewBookingsBadge', () => {
  it('counts CONFIRMED bookings created after lastSeenAt when enabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockBookings([
        { createdAt: '2026-06-13T03:00:00.000Z' },
        { createdAt: '2026-06-13T02:00:00.000Z' },
        { createdAt: '2026-06-12T22:00:00.000Z' },
      ]),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useNewBookingsBadge({ enabled: true }), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.count).toBe(2))
  })

  it('clears to 0 after markBookingsSeen advances lastSeenAt', async () => {
    // Past-dated fixtures so markBookingsSeen's real "now" is reliably AFTER the
    // booking (the badge clears) regardless of the test machine's clock.
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, '2019-01-01T00:00:00.000Z')
    vi.stubGlobal('fetch', mockBookings([{ createdAt: '2020-01-01T00:00:00.000Z' }]))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useNewBookingsBadge({ enabled: true }), {
      wrapper: makeWrapper(qc),
    })
    await waitFor(() => expect(result.current.count).toBe(1))

    act(() => markBookingsSeen(qc))

    await waitFor(() => expect(result.current.count).toBe(0))
  })

  it('does not fetch and reports 0 when disabled (renter view)', async () => {
    const fetchSpy = mockBookings([{ createdAt: '2026-06-13T03:00:00.000Z' }])
    vi.stubGlobal('fetch', fetchSpy)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useNewBookingsBadge({ enabled: false }), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.count).toBe(0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('narrows the scan to the picked operator (picker admin)', async () => {
    pickedRef.value = 'op_x'
    const fetchSpy = mockBookings([{ createdAt: '2026-06-13T03:00:00.000Z' }])
    vi.stubGlobal('fetch', fetchSpy)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useNewBookingsBadge({ enabled: true }), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_x')
  })
})
