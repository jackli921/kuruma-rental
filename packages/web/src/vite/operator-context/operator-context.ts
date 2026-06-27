import { getRouteApi } from '@tanstack/react-router'

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
