// CF Pages Function: proxy every /auth/* request to the API Worker, path kept
// verbatim. proxyRequest uses redirect:'manual', so the OAuth 302s (to Google and
// back to the app) and the Set-Cookie that mints kuruma_session pass through to
// the browser unchanged (#378 Slice 0, spec §5.5).
import { makeProxyHandler } from '../_shared/proxy'

export const onRequest = makeProxyHandler('')
