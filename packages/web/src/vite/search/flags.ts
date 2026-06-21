/**
 * Build-time gate for the interactive search map (#885).
 *
 * The map + list experience is a post-MVP / post-contract premium feature, so beta
 * builds ship it OFF and the search page renders the store list only. A full build
 * opts in by baking `VITE_SEARCH_MAP_ENABLED=true` at build time. Since slice 3b
 * (#885 desktop unification) this is the *single* source of truth for which results
 * view mounts: ON → unified car-first map+list, OFF → store grid. There is no
 * `?view` data-mode param anymore, so no stale link to reconcile.
 *
 * Strict-string on purpose: only the literal `'true'` enables it, so a missing or
 * typo'd value fails safe to OFF — a premium feature must never leak on by accident.
 */
export function isSearchMapEnabled(): boolean {
  return import.meta.env.VITE_SEARCH_MAP_ENABLED === 'true'
}
