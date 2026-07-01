/**
 * Interpret a raw `VITE_FEATURE_*` env value as a boolean gate.
 *
 * Strict-string on purpose: only the literal `'true'` enables a flag, so a missing
 * or typo'd value fails safe to OFF -- a billable feature must never leak on by
 * accident. This mirrors the sibling search-map gate in `vite/search/flags.ts` (#885).
 *
 * Both the build-time gate readers (`features.ts`) and the runtime-flag fallback
 * (`feature-flags-runtime.ts`) call this one predicate, so the two paths can never
 * diverge on how a value maps to a decision during the incremental flag migration
 * where both readers are live at once.
 *
 * Leaf module by design: it deliberately does NOT live in `features.ts`, so a test
 * that partially mocks that module can't break the runtime-flag reader, which also
 * depends on this predicate.
 */
export function isEnvTrue(value: string | undefined): boolean {
  return value === 'true'
}
