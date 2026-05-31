// Operator slug generation (proposal §9 item 15): kebab-case, ASCII, max 32
// chars; collisions append a numeric suffix (`acme-2`). Slugs are server-derived
// from the operator name and power `/manage/<slug>/...` routing.

const SLUG_MAX = 32
const MAX_SUFFIX_ATTEMPTS = 1000

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, '')
}

export function slugify(name: string): string {
  // Strip combining diacritical marks left by NFKD (e.g. é -> e).
  const ascii = name.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  const slug = trimHyphens(
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, SLUG_MAX),
  )
  return slug || 'operator'
}

/**
 * Find a free slug, appending `-2`, `-3`, ... until `exists` returns false.
 * The base is truncated so the suffixed result still fits within 32 chars.
 * The DB unique constraint on operators.slug is the ultimate guard; this just
 * keeps generated slugs human-friendly.
 */
export async function resolveUniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base
  for (let n = 2; n < MAX_SUFFIX_ATTEMPTS; n++) {
    const suffix = `-${n}`
    const candidate = `${trimHyphens(base.slice(0, SLUG_MAX - suffix.length))}${suffix}`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`resolveUniqueSlug: exhausted ${MAX_SUFFIX_ATTEMPTS} attempts for "${base}"`)
}
