import { describe, expect, it } from 'vitest'
import { isInAppBrowser } from './in-app-browser'

// Real-world UA strings. In-app/embedded webviews block Google OAuth
// (`disallowed_useragent`); real browsers do not.
const WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002824) NetType/WIFI Language/en'
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36'
const LINE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.5.0'
const FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/432.0.0.0;FBBV/12345]'
const INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113'

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'

describe('isInAppBrowser', () => {
  it('flags WeChat (MicroMessenger) — the actual beta blocker', () => {
    expect(isInAppBrowser(WECHAT)).toBe(true)
  })

  it('flags the generic Android System WebView ("; wv)" token)', () => {
    expect(isInAppBrowser(ANDROID_WEBVIEW)).toBe(true)
  })

  it('flags LINE, Facebook, and Instagram in-app browsers', () => {
    expect(isInAppBrowser(LINE)).toBe(true)
    expect(isInAppBrowser(FACEBOOK)).toBe(true)
    expect(isInAppBrowser(INSTAGRAM)).toBe(true)
  })

  it('does NOT flag real mobile browsers (iOS Safari, Android Chrome)', () => {
    expect(isInAppBrowser(IOS_SAFARI)).toBe(false)
    expect(isInAppBrowser(ANDROID_CHROME)).toBe(false)
  })

  it('does NOT flag desktop Chrome or Firefox', () => {
    expect(isInAppBrowser(DESKTOP_CHROME)).toBe(false)
    expect(isInAppBrowser(FIREFOX)).toBe(false)
  })

  it('returns false for an empty user-agent', () => {
    expect(isInAppBrowser('')).toBe(false)
  })
})
