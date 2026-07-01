/**
 * Canonical slug for catalog templates. The SAME function derives seed template
 * `key`s (key = slugify of the canonical English name) AND matches/mints in the
 * catalog backfill, so a seed key equals slugify of its name.
 *
 * UNICODE-AWARE (`\p{L}\p{N}`, not `[a-z0-9]`): this is a JP-market app whose
 * operators author Japanese names, and an ASCII-only class would strip every CJK
 * char to '' — collapsing distinct offerings onto one empty key, which the
 * backfill's intra-operator merge would then ARCHIVE (silent data loss).
 *
 * Pure and zero-import (edge-safe) so any layer can call it.
 */

/**
 * FNV-1a 32-bit — deterministic, dependency-free. Only used to keep two
 * degenerate (all-punctuation → empty) names apart; not cryptographic.
 */
function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function slugify(name: string): string {
  const trimmed = name.trim()
  const slug = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_|_$/g, '')
  // A name that is all punctuation still yields ''; key it by a stable hash so
  // two such names never share a key (which would drive a merge).
  return slug || `x_${stableHash(trimmed)}`
}
