// Shared logic for the CF Pages Functions proxy (#378 Slice 0, Phase 4). The
// `_shared` dir is underscore-prefixed and exports no onRequest handler, so CF
// Pages never routes it — it's a plain helper module imported by the route
// Functions. Kept pure/injectable so it's unit-testable without a network.
//
// Why a proxy at all: the web app is served same-origin with the API via these
// Functions, so the `kuruma_session` cookie can stay `SameSite=Lax` (Safari-safe)
// instead of `SameSite=None`. See design spec §5.5.

/** Env the proxy Functions read at the server edge. `API_ORIGIN` is the API
 *  Worker's public URL, set as a Pages Functions variable (spec §7.3). */
export interface ProxyEnv {
  API_ORIGIN?: string
}

/** Minimal shape of the CF Pages Functions `EventContext` this proxy uses. Typed
 *  structurally on purpose: pulling in @cloudflare/workers-types globally would
 *  clash with the web package's DOM lib. The real runtime context has more. */
export interface PagesProxyContext {
  request: Request
  env: ProxyEnv
}

/**
 * Map a same-origin browser URL to the upstream API URL. `stripPrefix` is the
 * route prefix the Pages Function lives under: `/api` for the data routes
 * (stripped — the API has no `/api` prefix), `''` for `/auth/*` (kept verbatim).
 * Stripping only happens on a path-segment boundary so `/apidocs` is left alone.
 */
export function resolveUpstreamUrl(
  requestUrl: string,
  apiOrigin: string,
  stripPrefix: string,
): string {
  const url = new URL(requestUrl)
  const origin = apiOrigin.replace(/\/$/, '')
  let pathname = url.pathname
  if (stripPrefix && (pathname === stripPrefix || pathname.startsWith(`${stripPrefix}/`))) {
    pathname = pathname.slice(stripPrefix.length) || '/'
  }
  return `${origin}${pathname}${url.search}`
}

// fetch sets Host from the target URL; forwarding the Pages hostname would point
// the upstream at the wrong vhost. The rest of the headers (incl. Cookie) ride
// through so the API sees the session and CSRF token.
const STRIPPED_REQUEST_HEADERS = ['host'] as const

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

/**
 * Proxy a request to the API origin and return the upstream response verbatim.
 * `redirect: 'manual'` is essential: the OAuth `/auth/google/start` and
 * `/callback` return 302s that must reach the browser, not be followed here.
 * `fetchImpl` is injectable for tests. Small request bodies are buffered (the
 * API takes JSON/form posts only) to avoid streaming-duplex differences.
 */
export async function proxyRequest(
  request: Request,
  apiOrigin: string,
  stripPrefix: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const upstreamUrl = resolveUpstreamUrl(request.url, apiOrigin, stripPrefix)

  const headers = new Headers(request.headers)
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name)

  // null (not undefined) so it satisfies `BodyInit | null` under
  // exactOptionalPropertyTypes; fetch treats a null body as "no body".
  const body = METHODS_WITHOUT_BODY.has(request.method) ? null : await request.arrayBuffer()

  return fetchImpl(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  })
}

/**
 * Build a CF Pages `onRequest` handler that proxies its route to the API origin.
 * Both route Functions are one line over this — `/api` strips the prefix, `/auth`
 * keeps it. A missing `API_ORIGIN` is a deploy misconfig → 500 (fail loud, never
 * silently serve the SPA fallback for an API path).
 */
export function makeProxyHandler(stripPrefix: string) {
  return async (context: PagesProxyContext): Promise<Response> => {
    const apiOrigin = context.env.API_ORIGIN
    if (!apiOrigin) {
      return new Response('API_ORIGIN is not configured', { status: 500 })
    }
    return proxyRequest(context.request, apiOrigin, stripPrefix)
  }
}
