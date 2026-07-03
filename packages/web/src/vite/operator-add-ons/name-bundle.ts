import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'

/**
 * Collapse the self-authored name form's three slots (#1437) into a LocalizedText
 * bundle for the wire. `en` is the required floor; a blank ja/zh slot is DROPPED so
 * the server never stores an empty locale (the shared schema rejects `''` anyway).
 * Pure + trimming — the caller passes raw form strings.
 */
export function buildNameBundle(en: string, ja: string, zh: string): LocalizedText {
  const jaTrimmed = ja.trim()
  const zhTrimmed = zh.trim()
  return {
    en: en.trim(),
    ...(jaTrimmed ? { ja: jaTrimmed } : {}),
    ...(zhTrimmed ? { zh: zhTrimmed } : {}),
  }
}
