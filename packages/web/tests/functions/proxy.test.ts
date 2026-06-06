import { describe, expect, test } from 'vitest'
import { makeProxyHandler, proxyRequest, resolveUpstreamUrl } from '../../functions/_shared/proxy'

const API = 'https://kuruma-api.workers.dev'

describe('resolveUpstreamUrl', () => {
  test('strips the /api prefix and points at the API origin', () => {
    expect(resolveUpstreamUrl('https://web.test/api/vehicles', API, '/api')).toBe(`${API}/vehicles`)
  })

  test('preserves the query string', () => {
    expect(resolveUpstreamUrl('https://web.test/api/bookings?from=1&to=2', API, '/api')).toBe(
      `${API}/bookings?from=1&to=2`,
    )
  })

  test('bare /api maps to the API root', () => {
    expect(resolveUpstreamUrl('https://web.test/api', API, '/api')).toBe(`${API}/`)
  })

  test('keeps the full path when prefix is empty (auth routes)', () => {
    expect(resolveUpstreamUrl('https://web.test/auth/google/start', API, '')).toBe(
      `${API}/auth/google/start`,
    )
  })

  test('only strips on a segment boundary, not a substring', () => {
    // /apidocs must NOT become /docs
    expect(resolveUpstreamUrl('https://web.test/apidocs', API, '/api')).toBe(`${API}/apidocs`)
  })

  test('normalises a trailing slash on the origin', () => {
    expect(resolveUpstreamUrl('https://web.test/api/x', `${API}/`, '/api')).toBe(`${API}/x`)
  })
})

describe('proxyRequest', () => {
  function fakeFetch() {
    const calls: {
      url?: string
      init?: RequestInit & { headers: Headers }
      response?: Response
    } = {}
    const fn = (async (url: string, init: RequestInit) => {
      calls.url = url
      calls.init = { ...init, headers: new Headers(init.headers) }
      const headers = new Headers({ location: '/en/dashboard' })
      headers.append('set-cookie', 'kuruma_session=abc; HttpOnly')
      calls.response = new Response('ok', { status: 302, headers })
      return calls.response
    }) as unknown as typeof fetch
    return { calls, fn }
  }

  test('forwards method + rewritten URL + headers, drops Host', async () => {
    const { calls, fn } = fakeFetch()
    // NB: `Cookie` is a forbidden request header in the DOM/happy-dom test env,
    // so it can't be set here — but the proxy copies ALL headers uniformly and
    // only deletes Host, so proving Authorization/CSRF pass through proves the
    // session cookie does too (the Workers runtime imposes no such restriction).
    const req = new Request('https://web.test/api/bookings', {
      method: 'POST',
      headers: { host: 'web.test', authorization: 'Bearer t', 'x-csrf-token': 'csrf1' },
      body: JSON.stringify({ a: 1 }),
    })

    await proxyRequest(req, API, '/api', fn)

    expect(calls.url).toBe(`${API}/bookings`)
    expect(calls.init?.method).toBe('POST')
    expect(calls.init?.headers.get('host')).toBeNull()
    expect(calls.init?.headers.get('authorization')).toBe('Bearer t')
    expect(calls.init?.headers.get('x-csrf-token')).toBe('csrf1')
  })

  test('does NOT follow redirects (OAuth 302 must reach the browser)', async () => {
    const { calls, fn } = fakeFetch()
    const req = new Request('https://web.test/auth/google/start', { headers: { host: 'web.test' } })

    const res = await proxyRequest(req, API, '', fn)

    expect(calls.init?.redirect).toBe('manual')
    // Returned verbatim: the proxy hands back the exact upstream Response, so its
    // 302 + Set-Cookie (the freshly-minted kuruma_session) reach the browser
    // untouched. Identity is the strongest passthrough assertion and sidesteps
    // the env's Set-Cookie header filtering.
    expect(res).toBe(calls.response)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/en/dashboard')
  })

  test('handler returns 500 when API_ORIGIN is unconfigured', async () => {
    const handler = makeProxyHandler('/api')
    const res = await handler({ request: new Request('https://web.test/api/x'), env: {} })
    expect(res.status).toBe(500)
  })

  test('forwards a POST body but sends none for GET', async () => {
    const post = fakeFetch()
    await proxyRequest(
      new Request('https://web.test/api/x', { method: 'POST', body: 'payload' }),
      API,
      '/api',
      post.fn,
    )
    expect(post.calls.init?.body).toBeDefined()

    const get = fakeFetch()
    await proxyRequest(new Request('https://web.test/api/x'), API, '/api', get.fn)
    expect(get.calls.init?.body).toBeNull()
  })
})
