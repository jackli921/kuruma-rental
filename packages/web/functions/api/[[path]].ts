// CF Pages Function: proxy every /api/* request to the API Worker, stripping the
// /api prefix (the Hono API has no such prefix). Same-origin with the SPA so the
// kuruma_session cookie stays SameSite=Lax (#378 Slice 0, spec §5.5).
import { makeProxyHandler } from '../_shared/proxy'

export const onRequest = makeProxyHandler('/api')
