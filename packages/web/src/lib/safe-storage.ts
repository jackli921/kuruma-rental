/**
 * localStorage access that never throws. Touching `window.localStorage` or its
 * methods raises in real renter environments — Safari "Block all cookies", some
 * privacy modes, and sandboxed in-app browser webviews (WeChat / LINE, common for
 * inbound tourists). These run during render at the `$locale` root, so an unguarded
 * throw blanks the whole app; degrade to the fallback / a silent no-op instead.
 */
export function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private-mode quota, sandboxed webview): the in-memory
    // state still updates; the choice just won't survive a reload. Not worth surfacing.
  }
}
