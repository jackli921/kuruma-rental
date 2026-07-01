import { OperatorClassesRoute, Route } from '@/routes/$locale/_business/manage/classes'
import { type OperatorClass, operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { useOperatorScope } from '@/vite/operator-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-context', () => ({ useOperatorScope: vi.fn() }))

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

// Seed both queries the route reads via useSuspenseQuery so they resolve from cache
// (no fetch, no router needed). staleTime=Infinity suppresses a background refetch.
function renderRoute(scope: { pickedOperatorId?: string; canWrite: boolean }) {
  vi.mocked(useOperatorScope).mockReturnValue({
    pickedOperatorId: scope.pickedOperatorId,
    canWrite: scope.canWrite,
    showOperator: false,
    operatorNameById: new Map(),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(
    operatorClassesQueryOptions({ includeArchived: true }, scope.pickedOperatorId).queryKey,
    [vehicleClass()],
  )
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
    renderRoute({ canWrite: true })
    expect(screen.getByRole('button', { name: en.addClass })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.editClass })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.deleteAction })).toBeInTheDocument()
  })

  it('hides Add + row actions for a bypass role with no operatorId, but still lists rows (read-only oversight)', () => {
    renderRoute({ canWrite: false })
    expect(screen.queryByRole('button', { name: en.addClass })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.editClass })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.deleteAction })).not.toBeInTheDocument()
    expect(screen.getByText('Compact')).toBeInTheDocument()
  })
})

const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
}) => Promise<unknown>

describe('OperatorClassesRoute loader', () => {
  it('prefetches the classes list query scoped to the picked operator', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])

    await loader({
      context: { queryClient: { ensureQueryData } },
      deps: { operator: 'op_9' },
    })

    const options = ensureQueryData.mock.calls[0]?.[0] as { queryKey: unknown }
    expect(options.queryKey).toEqual(['operator-classes', true, 'op_9'])
  })
})
