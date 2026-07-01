import { Route } from '@/routes/$locale/_business/dashboard'
import { describe, expect, it, vi } from 'vitest'

// The dashboard loader prefetches BOTH aggregate reads (overview + fleet-overview)
// so the component's useSuspenseQuery resolves without a FOUC, and — for a bypass
// admin using the operator-context picker — narrows both to the picked operator.
// loaderDeps and the component both read `?operator` from the same validated
// `_business` source; these tests pin that the loader warms the EXACT keys the
// component subscribes to (the no-refetch/no-FOUC claim in dashboard.tsx), so a
// future key drift or a dropped narrowing fails red instead of silently
// reintroducing a double-fetch / wrong-tenant flash.
const loaderDeps = Route.options.loaderDeps as (a: {
  search: { operator?: string | undefined }
}) => { operator?: string | undefined }

const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
}) => Promise<unknown>

describe('/$locale/_business/dashboard loaderDeps', () => {
  it('threads the picked operator search param through', () => {
    expect(loaderDeps({ search: { operator: 'op_9' } })).toEqual({ operator: 'op_9' })
  })

  it('carries an absent pick through as undefined (aggregate all-operators read)', () => {
    expect(loaderDeps({ search: {} })).toEqual({ operator: undefined })
  })
})

describe('/$locale/_business/dashboard loader prefetch', () => {
  it('warms overview + fleet-overview under the PICKED operator keys for a bypass admin', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue({})

    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })

    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toEqual([
      ['operator-overview', 'op_9'],
      ['operator-fleet', 'op_9'],
    ])
  })

  it('warms both reads under the shared "all" keys when no operator is picked', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue({})

    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: undefined } })

    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toEqual([
      ['operator-overview', 'all'],
      ['operator-fleet', 'all'],
    ])
  })
})
