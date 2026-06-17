import type { ResultView } from './SearchViewToggle'

/**
 * Build-time gate for the interactive search map (#885).
 *
 * The map + list experience is a post-MVP / post-contract premium feature, so beta
 * builds ship it OFF and the search page renders the store list only. A full build
 * opts in by baking `VITE_SEARCH_MAP_ENABLED=true` at build time.
 *
 * Strict-string on purpose: only the literal `'true'` enables it, so a missing or
 * typo'd value fails safe to OFF — a premium feature must never leak on by accident.
 */
export function isSearchMapEnabled(): boolean {
  return import.meta.env.VITE_SEARCH_MAP_ENABLED === 'true'
}

/**
 * The effective results view. With the map gated off (beta) the map view is
 * unreachable, so a stale `?view=map` link collapses to the store list instead of
 * loading a map that will never render. `mapEnabled` is passed in (not read here)
 * so this stays a pure function — the route composes it with `isSearchMapEnabled()`.
 */
export function resolveResultView(
  requested: ResultView | undefined,
  mapEnabled: boolean,
): ResultView {
  return mapEnabled && requested === 'map' ? 'map' : 'stores'
}
