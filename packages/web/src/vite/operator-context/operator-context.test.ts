import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OPERATOR_CONTEXT_ROUTE_IDS,
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

  it('is true on the classes page because it honors ?operator', () => {
    h.matches = [
      { routeId: '/$locale/_business' },
      { routeId: '/$locale/_business/manage/classes' },
    ]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(true)
  })

  it('is true on the dashboard route (slice 4 honors ?operator)', () => {
    h.matches = [{ routeId: '/$locale/_business' }, { routeId: '/$locale/_business/dashboard' }]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(true)
  })

  it('is false on an unscoped business route that does not honor ?operator', () => {
    // The fleet by-id detail is intentionally NOT registered (#1264) — a stable
    // example of a business route the picker does not honor.
    h.matches = [
      { routeId: '/$locale/_business' },
      { routeId: '/$locale/_business/manage/fleet/$vehicleId' },
    ]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(false)
  })

  it('is true on the settings route (slice 2 honors ?operator)', () => {
    h.matches = [
      { routeId: '/$locale/_business' },
      { routeId: '/$locale/_business/manage/settings' },
    ]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(true)
  })

  it('is true on the team route (slice 6 honors ?operator, #1230)', () => {
    h.matches = [{ routeId: '/$locale/_business' }, { routeId: '/$locale/_business/manage/team' }]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(true)
  })

  it('is false on the by-id trip-detail route (#1361 — by-id read, no picker chip)', () => {
    // Like fleet/$vehicleId (#1264), the booking by-id detail is NOT a picker route:
    // its read is by-id, so an interactive pick that diverges from the booking on
    // screen would dead-end the write at the API's ownership 404. The write still
    // binds via the retained ?operator= param, without showing the chip here.
    h.matches = [
      { routeId: '/$locale/_business' },
      { routeId: '/$locale/_business/manage/bookings/$bookingId' },
    ]
    const { result } = renderHook(() => useIsOperatorContextRoute())
    expect(result.current).toBe(false)
  })
})

describe('OPERATOR_CONTEXT_ROUTE_IDS', () => {
  it('treats the fleet list as a picker route but not the by-id detail route (#1264)', () => {
    expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/fleet/')).toBe(true)
    expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/fleet/$vehicleId')).toBe(false)
  })

  // The booking LIST is a picker route, but the by-id trip-detail is NOT (#1361) — same
  // rationale as fleet/$vehicleId: a by-id read the pick does not re-scope must not host
  // an interactive picker. The detail's status/cancel writes still bind via the retained
  // ?operator= param (useOperatorContext), so the picker chip is simply not shown there.
  it('treats the bookings list as a picker route but not the by-id trip-detail (#1361)', () => {
    expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/bookings/')).toBe(true)
    expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/bookings/$bookingId')).toBe(
      false,
    )
  })
})
