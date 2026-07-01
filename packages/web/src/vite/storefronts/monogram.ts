/**
 * Derive a 1-2 character monogram from a store name for the branded fallback
 * tile (#1302). There is no store image field, so the initials stand in as the
 * store's visual identity on the search grid.
 *
 * Rule: for a multi-word name, take the first character of the first two words
 * ("Best Car Rental Osaka" -> "BC"); for a single token (including space-less
 * CJK names) take its first two characters ("Toyota" -> "TO", "大阪レンタカー"
 * -> "大阪"). Latin output is uppercased; a blank name yields "".
 */
export function storeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''

  const chars =
    words.length >= 2
      ? [firstChar(words[0]), firstChar(words[1])]
      : Array.from(words[0] ?? '').slice(0, 2)

  return chars.join('').toUpperCase()
}

function firstChar(word: string | undefined): string {
  return Array.from(word ?? '')[0] ?? ''
}
