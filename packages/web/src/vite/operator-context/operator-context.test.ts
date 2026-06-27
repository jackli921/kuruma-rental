import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildScopeParam,
  parseOperatorSearch,
  useIsOperatorContextRoute,
  useSetOperatorContext,
} from './operator-context'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  matches: [] as { routeId: string }[],
}))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useNavigate: () => h.navigate }),
  useRouterState: ({ select }: { select: (s: { matches: { routeId: string }[] }) => unknown }) =>
    select({ matches: h.matches }),
}))

describe('buildScopeParam', () => {
  it('scopes to the picked operator', () => {
    expect(buildScopeParam('op_9')).toBe('operatorId=op_9')
  })
  it('falls back to includeAll when no operator is picked (cross-operator read)', () => {
    expect(buildScopeParam(undefined)).toBe('includeAll=true')
  })
  it('url-encodes the operator id', () => {
    expect(buildScopeParam('a b/c')).toBe('operatorId=a%20b%2Fc')
  })
})

describe('parseOperatorSearch', () => {
  it('returns {} when the operator key is absent so retainSearchParams carries it forward', () => {
    expect(parseOperatorSearch({})).toStrictEqual({})
  })

  it('returns the id when operator is a non-empty string', () => {
    expect(parseOperatorSearch({ operator: 'op_1' })).toStrictEqual({ operator: 'op_1' })
  })

  it('preserves an explicit clear (key present, value undefined) instead of collapsing to {}', () => {
    const result = parseOperatorSearch({ operator: undefined })
    expect('operator' in result).toBe(true)
    expect(result.operator).toBeUndefined()
  })

  it('normalizes empty string and non-string values to an explicit clear', () => {
    expect(parseOperatorSearch({ operator: '' })).toStrictEqual({ operator: undefined })
    expect(parseOperatorSearch({ operator: 123 })).toStrictEqual({ operator: undefined })
  })
})

describe('useSetOperatorContext', () => {
  beforeEach(() => h.navigate.mockClear())

  it('navigates with a reducer that adds the chosen operator id, keeping other params', () => {
    const { result } = renderHook(() => useSetOperatorContext())
    result.current('op_1')
    const arg = h.navigate.mock.calls.at(-1)?.[0]
    expect(arg.search({ region: 'osaka' })).toStrictEqual({ region: 'osaka', operator: 'op_1' })
  })

  it('navigates with a reducer that keeps the operator key present on an explicit clear', () => {
    const { result } = renderHook(() => useSetOperatorContext())
    result.current(undefined)
    const next = h.navigate.mock.calls.at(-1)?.[0].search({ operator: 'op_1' })
    expect('operator' in next).toBe(true)
    expect(next.operator).toBeUndefined()
  })
})

describe('useIsOperatorContextRoute', () => {
  it('is true when a supported manage route is in the active match chain', () => {
    h.matches = [
      { routeId: '/$locale/_business' },
      { routeId: '/$locale/_business/manage/add-ons' },
    ]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(true)
  })

  it('is false on an unscoped business route that does not honor ?operator', () => {
    h.matches = [{ routeId: '/$locale/_business' }, { routeId: '/$locale/_business/dashboard' }]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(false)
  })
})
