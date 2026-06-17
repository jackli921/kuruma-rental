import { describe, expect, it, vi } from 'vitest'

import { boundFetch } from '../../src/lib/bound-fetch'

describe('boundFetch', () => {
  it('calls the global fetch with this === globalThis even when invoked detached (#887/#893)', async () => {
    // CF Workers' global fetch is a branded builtin that throws "Illegal invocation"
    // unless called with this === globalThis. Node/vitest don't brand it, so simulate
    // the brand and prove boundFetch survives a DETACHED call (this = some other object)
    // — the prod failure mode that silently killed every email/geocode/translate (#887).
    const brandedFetch = async function (this: unknown): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
      }
      return new Response('ok')
    }
    vi.stubGlobal('fetch', brandedFetch)
    try {
      // Invoke detached: as a property of an unrelated object, so `this` is that object.
      // A bare `= fetch` capture would call brandedFetch with this = holder and throw.
      const holder = { fetchFn: boundFetch }
      const response = await holder.fetchFn('https://example.test')
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
