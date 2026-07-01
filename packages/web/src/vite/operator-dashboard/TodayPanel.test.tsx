import { OPERATOR_BOOKINGS_KEY } from '@/vite/operator-bookings/api'
import type { Session } from '@/vite/session'
import type { TodayBookingRow, TodayBuckets } from '@kuruma/shared/types/overview'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { OPERATOR_OVERVIEW_QUERY_KEY } from './api'

// The router <Link> is mocked to a plain anchor that resolves `to` + `params`
// into a concrete href, so the row's deep-link to the trip-detail page is
// assertable (repo pattern — see ThreadListView.test / BusinessSidebar.test).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: { to: string; params?: Record<string, string>; children: ReactNode }) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)
    return <a href={href}>{children}</a>
  },
}))

// Stub only updateBookingStatus; the real module's query keys/types are kept so
// the invalidation assertions run against the genuine cache keys.
vi.mock('@/vite/operator-bookings/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-bookings/api')>()
  return { ...actual, updateBookingStatus: vi.fn() }
})

import { updateBookingStatus } from '@/vite/operator-bookings/api'
import { TodayPanel } from './TodayPanel'

const updateStatusMock = updateBookingStatus as Mock

const OPERATOR_SESSION: Session = {
  user: { id: 'u_op', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'osaka' },
  csrfToken: 'test-csrf',
}
const ADMIN_SESSION: Session = {
  user: { id: 'u_admin', role: 'PLATFORM_ADMIN' },
  csrfToken: 'test-csrf',
}

const VEHICLES = [
  { id: 'veh_1', name: 'Toyota Aqua' },
  { id: 'veh_2', name: 'Nissan Note' },
]

function row(over: Partial<TodayBookingRow> & { id: string }): TodayBookingRow {
  return {
    bookingCode: `BK-${over.id}`,
    status: 'CONFIRMED',
    startAt: '2026-06-30T00:30:00.000Z',
    endAt: '2026-07-01T09:00:00.000Z',
    vehicleId: 'veh_1',
    renterName: 'Alice',
    ...over,
  }
}

function buckets(over: Partial<TodayBuckets> = {}): TodayBuckets {
  return { pickups: [], returns: [], overdue: [], ...over }
}

function renderPanel(
  today: TodayBuckets,
  session: Session | null = OPERATOR_SESSION,
  locale = 'en',
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <TodayPanel today={today} vehicles={VEHICLES} session={session} locale={locale} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { ...view, invalidateSpy }
}

const M = en.business.today

describe('TodayPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders each bucket header with a count equal to its row count', () => {
    renderPanel(
      buckets({
        pickups: [row({ id: 'p1' }), row({ id: 'p2' })],
        returns: [row({ id: 'r1', status: 'ACTIVE' })],
      }),
    )
    expect(within(screen.getByRole('group', { name: M.pickups })).getByText('2')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: M.returns })).getByText('1')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: M.overdue })).getByText('0')).toBeTruthy()
  })

  it('renders a pickup row with renter, resolved vehicle name, and a deep-link to the trip detail', () => {
    renderPanel(buckets({ pickups: [row({ id: 'bk1', renterName: 'Alice', vehicleId: 'veh_1' })] }))
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Toyota Aqua')).toBeTruthy()
    const link = screen.getByRole('link', { name: /Alice/ })
    expect(link.getAttribute('href')).toBe('/en/manage/bookings/bk1')
  })

  it('falls back to the walk-in label when the renter name is null', () => {
    renderPanel(buckets({ pickups: [row({ id: 'bk2', renterName: null })] }))
    expect(screen.getByText(M.walkIn)).toBeTruthy()
  })

  it('formats each row time in the active locale at the JST wall-clock (24h for ja, 12h for en)', () => {
    // 05:30Z == 14:30 Asia/Tokyo — a PM instant that renders differently per locale,
    // so it proves formatTime honours the passed locale rather than the ambient default.
    const at = '2026-06-30T05:30:00.000Z'
    const ja = renderPanel(
      buckets({ pickups: [row({ id: 'bk1', startAt: at })] }),
      OPERATOR_SESSION,
      'ja',
    )
    expect(screen.getByText('14:30')).toBeTruthy()
    expect(screen.queryByText(/PM/i)).toBeNull()
    ja.unmount()

    renderPanel(buckets({ pickups: [row({ id: 'bk2', startAt: at })] }), OPERATOR_SESSION, 'en')
    expect(screen.getByText(/2:30\s?PM/i)).toBeTruthy()
  })

  it('shows the per-bucket empty-state copy for buckets with no rows', () => {
    renderPanel(buckets({ pickups: [row({ id: 'p1' })] }))
    expect(screen.getByText(M.emptyReturns)).toBeTruthy()
    expect(screen.getByText(M.emptyOverdue)).toBeTruthy()
  })

  it('advances a pickup to ACTIVE and invalidates the overview + operator-bookings caches', async () => {
    updateStatusMock.mockResolvedValue({})
    const { invalidateSpy } = renderPanel(
      buckets({ pickups: [row({ id: 'bk1', status: 'CONFIRMED' })] }),
    )
    fireEvent.click(screen.getByRole('button', { name: M.markPickedUp }))
    await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith('bk1', 'ACTIVE', 'test-csrf'))
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: OPERATOR_OVERVIEW_QUERY_KEY })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: OPERATOR_BOOKINGS_KEY })
    })
  })

  it('advances a return to COMPLETED', async () => {
    updateStatusMock.mockResolvedValue({})
    renderPanel(buckets({ returns: [row({ id: 'r1', status: 'ACTIVE' })] }))
    fireEvent.click(screen.getByRole('button', { name: M.markReturned }))
    await waitFor(() =>
      expect(updateStatusMock).toHaveBeenCalledWith('r1', 'COMPLETED', 'test-csrf'),
    )
  })

  it('advances an overdue booking to COMPLETED', async () => {
    updateStatusMock.mockResolvedValue({})
    renderPanel(buckets({ overdue: [row({ id: 'o1', status: 'ACTIVE' })] }))
    fireEvent.click(screen.getByRole('button', { name: M.markReturned }))
    await waitFor(() =>
      expect(updateStatusMock).toHaveBeenCalledWith('o1', 'COMPLETED', 'test-csrf'),
    )
  })

  it('renders nothing for a non-operator (bypass admin) session', () => {
    const { container } = renderPanel(buckets({ pickups: [row({ id: 'p1' })] }), ADMIN_SESSION)
    expect(container).toBeEmptyDOMElement()
  })
})
