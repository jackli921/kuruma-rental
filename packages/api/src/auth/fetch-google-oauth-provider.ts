// Concrete GoogleOAuthProvider over global fetch (CF Workers + Node). Thin HTTP
// boundary, deliberately NOT unit-tested — the manual round-trip (#378 Phase 2d)
// is the real proof; a fetch mock would only restate this file. Constructed in
// index.ts (composition root); the route depends on the GoogleOAuthProvider port.

import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  type GoogleOAuthConfig,
  type GoogleOAuthProvider,
  type GoogleProfile,
} from './google'

export class FetchGoogleOAuthProvider implements GoogleOAuthProvider {
  async exchangeCode(code: string, config: GoogleOAuthConfig): Promise<{ accessToken: string }> {
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
    const data = (await res.json()) as { access_token?: string }
    if (!data.access_token) throw new Error('Google token response missing access_token')
    return { accessToken: data.access_token }
  }

  async getUserInfo(accessToken: string): Promise<GoogleProfile> {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Google userinfo request failed (${res.status})`)
    const p = (await res.json()) as {
      sub?: string
      email?: string
      name?: string
      picture?: string
    }
    if (!p.sub) throw new Error('Google userinfo response missing sub')
    // exactOptionalPropertyTypes: omit optional keys rather than set undefined.
    return {
      sub: p.sub,
      ...(p.email !== undefined ? { email: p.email } : {}),
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.picture !== undefined ? { picture: p.picture } : {}),
    }
  }
}
