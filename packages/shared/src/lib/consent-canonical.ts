import { createHash } from 'node:crypto'

const FIELD_SEP = '\x1e'
const KV_SEP = '\x1f'

/**
 * Deterministic, injection-proof serialization of an ordered field list.
 * Length-prefixing each value removes any delimiter ambiguity (spec §5).
 */
export function canonicalizeFields(
  fields: ReadonlyArray<readonly [string, string | null]>,
): string {
  return fields
    .map(([k, v]) => `${k}${KV_SEP}${v === null ? '0:' : `${byteLen(v)}:${v}`}${FIELD_SEP}`)
    .join('')
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

export interface DisclosureArtifact {
  title: string
  body: string
  acceptanceLabel: string
}

/** §5.1 — sha256 over the full disclosure a subject was shown. */
export function computeContentHash(d: DisclosureArtifact): string {
  const canonical = canonicalizeFields([
    ['title', d.title],
    ['body', d.body],
    ['acceptanceLabel', d.acceptanceLabel],
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
