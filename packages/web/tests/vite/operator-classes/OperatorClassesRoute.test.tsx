import { OperatorClassesRoute } from '@/routes/$locale/_business/manage/classes'
import { type OperatorClass, operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.classes

function vehicleClass(): OperatorClass {
  return {
    id: 'cls_1',
    operatorId: 'op_1',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
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
  queryClient.setQueryData(operatorClassesQueryOptions({ includeArchived: true }).queryKey, [
    vehicleClass(),
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorClassesRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorClassesRoute write-affordance gating (#583)', () => {
  it('shows Add + row Edit/Delete for a tenant-scoped operator session', () => {
    renderRoute(operatorSession)
    expect(screen.getByRole('button', { name: en.addClass })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.editClass })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.deleteAction })).toBeInTheDocument()
  })

  it('hides Add + row actions for a bypass role with no operatorId, but still lists rows (read-only oversight)', () => {
    renderRoute(bypassSession)
    expect(screen.queryByRole('button', { name: en.addClass })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.editClass })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.deleteAction })).not.toBeInTheDocument()
    expect(screen.getByText('Compact')).toBeInTheDocument()
  })
})
