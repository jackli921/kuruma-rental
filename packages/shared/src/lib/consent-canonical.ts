import { createHash } from 'node:crypto'

const FIELD_SEP = '\x1e'
const KV_SEP = '\x1f'

/**
 * Version tag bound INTO every canonical serialization. Any future field
 * reordering, addition, or semantics change MUST bump this so verifiers can
 * dispatch by version (#1050). Without the tag, a v1 row would silently fail
 * verification under a v2 codec, with no way to tell which side was wrong.
 * The tag rides as the first KV pair so it's literally in the signed bytes.
 */
export const CANONICAL_VERSION = 'v1'

/**
 * Deterministic, injection-proof serialization of an ordered field list.
 * Length-prefixing each value removes any delimiter ambiguity (spec §5).
 * `_canon:<version>` is prepended internally so every caller (signing +
 * content hashing) is automatically version-tagged — there is no way to opt
 * out. The optional `version` argument exists so a future v2 verifier can
 * re-canonicalize old rows under their original tag for byte-identical
 * comparison; production call sites must omit it and ride the default.
 */
export function canonicalizeFields(
  fields: ReadonlyArray<readonly [string, string | null]>,
  version: string = CANONICAL_VERSION,
): string {
  // `_canon` is reserved for the version tag; a caller-supplied field with
  // the same key would emit two `_canon` pairs and yield two valid pre-images
  // for the same hash. Today's call sites use static literals — this guard
  // protects future generic callers from a silent crypto regression.
  for (const [k] of fields) {
    if (k === '_canon') throw new Error('canonicalizeFields: "_canon" is a reserved key')
  }
  // `N:` marks null distinctly from the empty string (`0:`); a real value always
  // starts with a digit, so the null marker can never collide with one.
  return [['_canon', version] as const, ...fields]
    .map(([k, v]) => `${k}${KV_SEP}${v === null ? 'N:' : `${byteLen(v)}:${v}`}${FIELD_SEP}`)
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
