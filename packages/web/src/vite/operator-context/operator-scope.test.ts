import type { Session } from '@/vite/session'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOperatorScope } from './operator-context'

// Controls the three inputs useOperatorScope derives from: the route search param
// (via getRouteApi), the session, and the /operators query result.
const h = vi.hoisted(() => ({
  search: { operator: undefined as string | undefined },
  session: undefined as Session | undefined,
  operators: [] as Array<{ id: string; name: string }>,
  useQuerySpy: vi.fn<(opts: { enabled?: boolean }) => unknown>(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => h.search, useNavigate: () => vi.fn() }),
}))

vi.mock('@/vite/session', () => ({ useSession: () => ({ data: h.session }) }))

// queryOptions is the identity passthrough operatorsQueryOptions wraps; useQuery
// honors `enabled` so an un-enabled query yields no data (matches react-query).
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
  useQuery: (opts: { enabled?: boolean }) => {
    h.useQuerySpy(opts)
    return { data: opts.enabled ? h.operators : undefined }
  },
}))

const adminSession: Session = {
  user: { id: 'u_admin', role: 'PLATFORM_ADMIN' },
  csrfToken: 'csrf',
}
const ownerSession: Session = {
  user: { id: 'u_owner', role: 'OPERATOR_OWNER', operatorId: 'op_1' },
  csrfToken: 'csrf',
}

describe('useOperatorScope', () => {
  beforeEach(() => {
    h.useQuerySpy.mockClear()
    h.operators = []
  })

  it('platform admin with no pick reads cross-operator: labels on, write off', () => {
    h.session = adminSession
    h.search = { operator: undefined }
    h.operators = [
      { id: 'op_1', name: 'Sakura' },
      { id: 'op_2', name: 'Fuji' },
    ]

    const { result } = renderHook(() => useOperatorScope())

    expect(result.current.showOperator).toBe(true)
    expect(result.current.canWrite).toBe(false)
    expect(result.current.pickedOperatorId).toBeUndefined()
    expect(result.current.operatorNameById.get('op_1')).toBe('Sakura')
    expect(result.current.operatorNameById.size).toBe(2)
    expect(h.useQuerySpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('same admin with a pick scopes to one tenant: labels off, write on', () => {
    h.session = adminSession
    h.search = { operator: 'op_9' }

    const { result } = renderHook(() => useOperatorScope())

    expect(result.current.showOperator).toBe(false)
    expect(result.current.canWrite).toBe(true)
    expect(result.current.pickedOperatorId).toBe('op_9')
    expect(h.useQuerySpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('operator owner session never fetches /operators and may write', () => {
    h.session = ownerSession
    h.search = { operator: undefined }
    h.operators = [{ id: 'op_1', name: 'Sakura' }]

    const { result } = renderHook(() => useOperatorScope())

    expect(result.current.showOperator).toBe(false)
    expect(result.current.canWrite).toBe(true)
    expect(result.current.operatorNameById.size).toBe(0)
    expect(h.useQuerySpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })
})
