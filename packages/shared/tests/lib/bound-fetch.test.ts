import { describe, expect, it, vi } from 'vitest'

import { boundFetch } from '../../src/lib/bound-fetch'

describe('boundFetch', () => {
  it('invokes the global fetch with this === globalThis even when called detached (#887/#893)', async () => {
    // CF Workers' global fetch is a branded builtin that throws "Illegal invocation"
    // unless called with this === globalThis. Node/vitest don't brand it, so capture
    // the `this` the wrapper forwards and assert it directly — the brand survival is
    // the load-bearing assertion, not an incidental network failure on the mutant.
    let observedThis: unknown = 'unset'
    const brandedFetch = async function (this: unknown): Promise<Response> {
      observedThis = this
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
      }
      return new Response('ok')
    }
    vi.stubGlobal('fetch', brandedFetch)
    try {
      // Invoke detached: as a property of an unrelated object, so `this` is that object.
      // A bare `= fetch` capture would forward this = holder (or miss the stub entirely).
      const holder = { fetchFn: boundFetch }
      const response = await holder.fetchFn('https://example.test')
      expect(observedThis).toBe(globalThis)
      expect(await response.text()).toBe('ok')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('forwards arguments to and returns the result of the current global fetch', async () => {
    const spy = vi.fn(async () => new Response('payload', { status: 201 }))
    vi.stubGlobal('fetch', spy)
    try {
      const response = await boundFetch('https://example.test/x', { method: 'POST' })
      expect(spy).toHaveBeenCalledWith('https://example.test/x', { method: 'POST' })
      expect(response.status).toBe(201)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
