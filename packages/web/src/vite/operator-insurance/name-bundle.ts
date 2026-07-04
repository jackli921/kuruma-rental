import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'

/**
 * Collapse the self-authored insurance-name form's three slots (#1437 slice 3)
 * into a LocalizedText bundle for the wire. `en` is the required floor; a blank
 * ja/zh slot is DROPPED so the server never stores an empty locale (the shared
 * `localizedTextSchema` rejects `''` anyway). Pure + trimming — the caller passes
 * raw form strings.
 *
 * A deliberate local copy of the add-on helper: importing
 * `@/vite/operator-add-ons/name-bundle` from this feature would be a cross-module
 * reach-in that `lint:modules` flags. Consolidating both to a vite-root util is a
 * follow-up (mirrors the #1382 shared-label hoist).
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
