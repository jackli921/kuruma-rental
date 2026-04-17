// Render a country ISO-3166 alpha-2 code as the matching flag emoji. Browsers
// render the regional-indicator pair as a single flag glyph. Returns an empty
// string for missing/invalid codes so the UI can degrade gracefully.
const OFFSET = 0x1f1e6 - 'A'.charCodeAt(0)

export function countryFlag(code: string | null | undefined): string {
  if (!code) return ''
  const trimmed = code.trim().toUpperCase()
  if (trimmed.length !== 2 || !/^[A-Z]{2}$/.test(trimmed)) return ''
  return String.fromCodePoint(...[...trimmed].map((c) => c.charCodeAt(0) + OFFSET))
}
