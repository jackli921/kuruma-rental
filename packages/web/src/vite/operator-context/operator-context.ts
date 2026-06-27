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

// Reads the `operator` search param defined on the `_business` layout route.
// `undefined` = "All operators". Any `/manage/*` page is a descendant, so the
// param is in scope everywhere the console renders.
export function useOperatorContext(): { pickedOperatorId: string | undefined } {
  const { operator } = businessRoute.useSearch()
  return { pickedOperatorId: operator }
}
