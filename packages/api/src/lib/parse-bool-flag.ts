/**
 * Parse a boolean feature-flag env var. Only the explicit strings `'true'` and
 * `'1'` enable the flag — everything else (including `undefined`, `''`, and a
 * mis-cased `'TRUE'`) is treated as OFF. Strict-on-purpose: a safety gate like
 * `REQUIRE_DOCUMENT_VERIFICATION` must never flip on from a typo'd value.
 */
export function parseBoolFlag(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}
