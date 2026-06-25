// Concrete GoogleOAuthProvider over global fetch (CF Workers + Node). Thin HTTP
// boundary, deliberately NOT unit-tested — the manual round-trip (#378 Phase 2d)
// is the real proof; a fetch mock would only restate this file. The id_token
// verification LOGIC it delegates to lives in `verifyGoogleIdToken`, which IS unit
// tested (#1055). Constructed in the composition root; the route depends on the port.

import { createRemoteJWKSet } from 'jose'
import {
  GOOGLE_JWKS_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  type GoogleOAuthConfig,
  type GoogleOAuthProvider,
  type GoogleProfile,
  verifyGoogleIdToken,
} from './google'

// Google's JWKS resolver. createRemoteJWKSet caches keys per isolate with a cooldown
// and only fetches on first verify (no module-scope I/O), so it's safe to build once
// and reuse — mirroring the lazy-singleton rule for backing services on Workers.
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_ENDPOINT))

export class FetchGoogleOAuthProvider implements GoogleOAuthProvider {
  async exchangeCode(code: string, config: GoogleOAuthConfig): Promise<{ idToken: string }> {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
    const data = (await res.json()) as { id_token?: string }
    if (!data.id_token) throw new Error('Google token response missing id_token')
    return { idToken: data.id_token }
  }

  verifyIdToken(idToken: string, config: GoogleOAuthConfig, nonce: string): Promise<GoogleProfile> {
    return verifyGoogleIdToken(idToken, googleJwks, { clientId: config.clientId, nonce })
  }
}
