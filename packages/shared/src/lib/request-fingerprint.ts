// §6 replay semantics: an idempotency key is bound to a request fingerprint so
// a reused key can never silently return evidence for a DIFFERENT claim.
// SHA-256 over key-sorted canonical JSON; Web Crypto (Workers-safe).
type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function sortKeysDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k] as Json)]),
    )
  }
  return value
}

export async function requestFingerprint(payload: Record<string, Json>): Promise<string> {
  const canonical = JSON.stringify(sortKeysDeep(payload))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
