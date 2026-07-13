import { canWriteAsOperator, isCrossOperatorReader } from '@/vite/guards'
import { useSession } from '@/vite/session'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useRouterState } from '@tanstack/react-router'
import { operatorsQueryOptions } from './api'

// The query fragment a config-list read appends: a specific operator when picked,
// otherwise `includeAll=true` (the bypass-role read default that satisfies the API's
// cross-operator guard — this is what clears the fees/insurance 400). Operator
// sessions never pick, so they always send `includeAll=true`, which the API ignores
// (they auto-scope server-side).
export function buildScopeParam(pickedOperatorId: string | undefined): string {
  return pickedOperatorId ? `operatorId=${encodeURIComponent(pickedOperatorId)}` : 'includeAll=true'
}

const businessRoute = getRouteApi('/$locale/_business')

// Parses the `_business` route's `operator` search param. Key ABSENT -> {} so
// retainSearchParams carries the current value forward; key PRESENT (incl. an
// explicit `undefined` from the picker's "All operators") -> { operator: <id|undefined> }
// so the explicit clear is preserved instead of being re-added. This split is the
// retain-vs-clear contract the whole picker depends on, kept pure so it is unit-tested
// directly rather than only through the router.
export function parseOperatorSearch(search: Record<string, unknown>): {
  operator?: string | undefined
} {
  if (!('operator' in search)) return {}
  const value = search.operator
  return { operator: typeof value === 'string' && value.length > 0 ? value : undefined }
}

// Reads the `operator` search param defined on the `_business` layout route.
// `undefined` = "All operators". Any `/manage/*` page is a descendant, so the
// param is in scope everywhere the console renders.
export function useOperatorContext(): { pickedOperatorId: string | undefined } {
  const { operator } = businessRoute.useSearch()
  return { pickedOperatorId: operator }
}

// Route-safe read of the picked operator id from ANYWHERE — including nav chrome
// (Navbar) that also renders OUTSIDE the `_business` route in renter view, where
// `useOperatorContext`'s route-scoped `businessRoute.useSearch()` would throw. Pulls
// the id off the `_business` match's search when that route is active, else returns
// undefined. Used by the new-bookings badge, which mounts in both nav surfaces.
export function useOptionalPickedOperatorId(): string | undefined {
  return useRouterState({
    select: (s) => {
      const match = s.matches.find((m) => m.routeId === '/$locale/_business')
      // Reuse the pinned retain-vs-clear normalizer so the empty-string -> undefined
      // rule lives in exactly one place (parseOperatorSearch).
      return parseOperatorSearch((match?.search as Record<string, unknown>) ?? {}).operator
    },
  })
}

// The single seam that mutates the operator context. The search reducer always
// keeps the `operator` key present (`{ ...prev, operator }`) so passing `undefined`
// is an explicit clear that survives retainSearchParams, while omitting the key
// (sidebar links) retains the current value. Route-scoped navigate is load-bearing:
// an unscoped `useNavigate()` can't infer the target search shape, so its reducer
// return type collapses to `never`.
export function useSetOperatorContext(): (operatorId: string | undefined) => void {
  const navigate = businessRoute.useNavigate()
  return (operatorId) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, operator: operatorId }) })
}

// The operator-context scope a config page operates under, derived once from the
// session + the picked operator. `showOperator` (all-mode labeling) and the
// operators fetch are gated on `isCrossOperatorReader` — NOT `!pickedOperatorId` —
// so a normal operator session never fetches /operators or sees labels.
export interface OperatorScope {
  readonly pickedOperatorId: string | undefined
  readonly canWrite: boolean
  readonly showOperator: boolean
  readonly operatorNameById: ReadonlyMap<string, string>
}

export function useOperatorScope(): OperatorScope {
  const { pickedOperatorId } = useOperatorContext()
  const { data: session } = useSession()
  const showOperator = isCrossOperatorReader(session ?? null) && !pickedOperatorId
  const { data: operators } = useQuery({ ...operatorsQueryOptions(), enabled: showOperator })
  const canWrite = canWriteAsOperator(session ?? null, pickedOperatorId)
  const operatorNameById = new Map((operators ?? []).map((o) => [o.id, o.name]))
  return { pickedOperatorId, canWrite, showOperator, operatorNameById }
}

// Create bodies for a picker-admin carry the picked operatorId; operator sessions omit it.
export type WithOperatorId<T> = T & { operatorId?: string }

// Routes whose loaders/components actually thread `?operator` into their reads
// (Slice 1). The picker is shown ONLY on these — on other business pages the
// param is retained silently but the page is unscoped, so showing the picker
// there would misrepresent data scope. Each later slice (settings, classes/fleet,
// dashboard, bookings, team) adds its route id here as it lands.
export const OPERATOR_CONTEXT_ROUTE_IDS: ReadonlySet<string> = new Set([
  '/$locale/_business/dashboard', // slice 4 — overview + fleet-overview narrow to picked operator
  '/$locale/_business/manage/add-ons',
  '/$locale/_business/manage/bookings/', // slice 5a — bookings reads narrow to picked operator
  // NB: the by-id trip-detail ($bookingId) is intentionally NOT registered — like
  // fleet/$vehicleId (#1264). Its read is by-id (not pick-scoped), so showing an
  // interactive picker there would let the pick diverge from the booking on screen and
  // dead-end the write at the API's ownership 404 (#1361). The write still binds: the
  // route reads the ?operator= param (retained by _business) via useOperatorContext.
  '/$locale/_business/manage/classes',
  '/$locale/_business/manage/combo-deals', // #464 slice 7 — combo-deals list narrows to picked operator
  '/$locale/_business/manage/fees',
  '/$locale/_business/manage/fleet/', // slice 4 residual (#1264) — list reads narrow; detail is by-id, intentionally NOT registered
  '/$locale/_business/manage/insurance',
  '/$locale/_business/manage/locations',
  '/$locale/_business/manage/settings', // slice 2 — picker honored on settings
  '/$locale/_business/manage/team', // slice 6 (#1230) — picker honored on team management
  '/$locale/_business/manage/terms', // operator rental-terms — list narrows to picked operator
])

// True when the active route is one that honors `?operator` (a descendant match
// counts, so any of the supported manage pages returns true). Reads the router's
// match chain so the picker can be hidden where the param would lie about scope.
export function useIsOperatorContextRoute(): boolean {
  const matches = useRouterState({ select: (s) => s.matches })
  return matches.some((m) => OPERATOR_CONTEXT_ROUTE_IDS.has(m.routeId))
}
