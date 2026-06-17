/**
 * A `fetch` you can hand around safely.
 *
 * On the Cloudflare Workers/Pages runtime the global `fetch` is a branded builtin
 * that must be called with `this === globalThis`. Captured detached — stored as a
 * field/param and later invoked as `this.fetchFn(...)` (this = the instance) — it
 * throws "Illegal invocation" and the call silently FAILS. Node/vitest don't brand
 * `fetch`, so the bug is invisible in CI and only bites the live runtime. It bit
 * four sites at once, silently killing every outbound email (#887).
 *
 * Import this instead of writing `fetch.bind(globalThis)` per call site: the safety
 * is the default, not something each caller must remember. Injectable `fetchFn`
 * params default to `boundFetch`; tests still pass their own mock to override it.
 *
 * It is a thin wrapper (not an eager `fetch.bind`) so it reads the *current* global
 * `fetch` on each call — `apply(globalThis, …)` fixes the `this` — which keeps it
 * stubbable in tests (`vi.stubGlobal('fetch', …)`) while staying Workers-correct.
 */
export const boundFetch: typeof fetch = ((...args: Parameters<typeof fetch>) =>
  fetch.apply(globalThis, args)) as typeof fetch
