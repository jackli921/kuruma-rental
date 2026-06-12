import { OperatorLocationsRoute } from '@/routes/$locale/_business/manage/locations'
import { LOCATIONS_QUERY_KEY, type OperatorLocation } from '@/vite/operator-locations/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.locations

function location(): OperatorLocation {
  return {
    id: 'loc_1',
    operatorId: 'op_1',
    name: 'Namba Branch',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

const bypassSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

// Seed both queries the route reads via useSuspenseQuery so they resolve from cache
// (no fetch, no router needed). staleTime=Infinity suppresses a background refetch.
function renderRoute(session: Session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(LOCATIONS_QUERY_KEY, [location()])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorLocationsRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorLocationsRoute write-affordance gating (#529 review P1)', () => {
  it('shows Add + row Edit/Archive for a tenant-scoped operator session', () => {
    renderRoute(operatorSession)
    expect(screen.getByRole('button', { name: en.addLocation })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.editLocation })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.archiveAction })).toBeInTheDocument()
  })

  it('hides Add + row actions for a bypass role with no operatorId, but still lists rows (read-only oversight)', () => {
    renderRoute(bypassSession)
    expect(screen.queryByRole('button', { name: en.addLocation })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.editLocation })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.archiveAction })).not.toBeInTheDocument()
    expect(screen.getByTestId('location-row')).toBeInTheDocument()
  })
})
