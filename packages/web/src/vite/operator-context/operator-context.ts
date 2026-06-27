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
  '/$locale/_business/manage/add-ons',
  '/$locale/_business/manage/fees',
  '/$locale/_business/manage/insurance',
  '/$locale/_business/manage/locations',
])

// True when the active route is one that honors `?operator` (a descendant match
// counts, so any of the supported manage pages returns true). Reads the router's
// match chain so the picker can be hidden where the param would lie about scope.
export function useIsOperatorContextRoute(): boolean {
  const matches = useRouterState({ select: (s) => s.matches })
  return matches.some((m) => OPERATOR_CONTEXT_ROUTE_IDS.has(m.routeId))
}
