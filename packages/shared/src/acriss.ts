/**
 * ACRISS vehicle-class taxonomy (epic #385, slice 3 / #388).
 *
 * The single source of truth for the ACRISS code format. The Zod validator
 * reuses `ACRISS_PATTERN` and the DB CHECK mirrors it — do NOT re-write the
 * regex anywhere else (proposal §2; issue #388 scope).
 *
 * MVP ships format-only validation: any four-character code of `[A-Z9]`
 * passes. The dictionary below is therefore a known *subset*, not a closed
 * allowlist — codes may legitimately arrive via API/seed/import outside the 8
 * (operators may enter their own). Positional/structural validation and the
 * full (~hundreds) ACRISS table are deferred post-MVP (#388 out-of-scope).
 *
 * No runtime deps: this module is imported by both the Zod validator (shared)
 * and indirectly by the DB CHECK; keeping it dependency-free preserves the
 * `@kuruma/shared` "no runtime deps on api or web" boundary.
 */

// Four characters, each an upper-case letter or the digit 9 (the ACRISS
// "or higher" axis marker, e.g. "9" seats). Anchored so a valid code embedded
// in a longer string is rejected.
export const ACRISS_PATTERN = /^[A-Z9]{4}$/

// The 8-code MVP subset (proposal §9 item 9: "6-8 ACRISS codes" demo floor).
// Each code maps to its i18n message key under the `acriss.*` namespace. The
// renter-facing label is resolved from this key; an off-dictionary code falls
// back to rendering the raw code (issue #388 acceptance).
export const ACRISS_CODES = {
  MCAR: 'acriss.MCAR',
  ECAR: 'acriss.ECAR',
  CCAR: 'acriss.CCAR',
  ICAR: 'acriss.ICAR',
  SCAR: 'acriss.SCAR',
  FCAR: 'acriss.FCAR',
  IVAR: 'acriss.IVAR',
  SUVR: 'acriss.SUVR',
} as const

export type AcrissCode = keyof typeof ACRISS_CODES
