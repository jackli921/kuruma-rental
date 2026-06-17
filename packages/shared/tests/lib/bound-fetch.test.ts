import { describe, expect, it, vi } from 'vitest'

import { boundFetch } from '../../src/lib/bound-fetch'

describe('boundFetch', () => {
  it('forwards every call to the current global fetch with this === globalThis, even when detached (#887/#893)', async () => {
    // CF Workers' global fetch is a branded builtin that throws "Illegal invocation"
    // unless called with this === globalThis. Prove BOTH properties via assertions —
    // never via a network side effect: boundFetch (a) reads the CURRENT global fetch,
    // so a stub installed after module load is seen, and (b) calls it with
    // this === globalThis even when boundFetch is itself invoked detached.
    let observedThis: unknown = 'unset'
    const stub = vi.fn(async function (this: unknown): Promise<Response> {
      observedThis = this
      return new Response('ok')
    })
    vi.stubGlobal('fetch', stub)
    try {
      // Detached: as a property of an unrelated object, so a bare `= fetch` (or an
      // eager `fetch.bind`) — which snapshots the global at module load — never reaches
      // `stub` and the call escapes to the network. Swallow that so the discriminator
      // is the assertion (`stub` was hit), not a non-deterministic DNS error.
      const holder = { fetchFn: boundFetch }
      await holder.fetchFn('https://example.test').catch(() => undefined)
      expect(stub).toHaveBeenCalledTimes(1)
      expect(observedThis).toBe(globalThis)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('forwards arguments to and returns the result of the current global fetch', async () => {
    const stub = vi.fn(async () => new Response('payload', { status: 201 }))
    vi.stubGlobal('fetch', stub)
    try {
      const response = await boundFetch('https://example.test/x', { method: 'POST' })
      expect(stub).toHaveBeenCalledWith('https://example.test/x', { method: 'POST' })
      expect(response.status).toBe(201)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
