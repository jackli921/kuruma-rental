import { timingSafeEqual } from 'node:crypto'

import { SignJWT, jwtVerify } from 'jose'

import { type AuthUser, type UserRole, isValidRole } from './roles'

// The web package mints API tokens with these claims (packages/web/src/lib/
// api-token.ts). verifyJwt asserts both so a token minted with the shared
// AUTH_SECRET for any other purpose cannot be replayed as an API caller.
export const API_TOKEN_ISSUER = 'kuruma-web'
export const API_TOKEN_AUDIENCE = 'kuruma-api'

// Cookie that carries the browser session JWT (Vite/CF Pages migration, #378).
// Set by the API at OAuth sign-in; read by requireAuth's cookie path, the CSRF
// middleware, and GET /auth/session. See design spec §5.3.
export const SESSION_COOKIE = 'kuruma_session'

/** Display-only profile a session token may carry (navbar avatar/name/email).
 *  Deliberately separate from AuthUser: these fields NEVER participate in
 *  authorization, so they can't widen any access check. Mirrors the name/email/
 *  image NextAuth carried in its session JWT before the #378 migration. */
export interface SessionProfile {
  readonly name?: string
  readonly email?: string
  readonly image?: string
}

/** A verified session: the caller identity plus the CSRF token bound to it.
 *  `csrf` is absent for Bearer API tokens (they carry no csrf claim and are
 *  CSRF-immune anyway — see middleware/csrf.ts). `profile` is absent on Bearer
 *  tokens and on legacy session cookies minted before profile claims existed. */
export interface VerifiedSession {
  readonly user: AuthUser
  readonly csrf?: string
  readonly profile?: SessionProfile
  // Operator slug for the granted tenant (#521 §8). Lets the web /manage/$slug
  // guard match the URL segment. Session metadata, NOT an authz field — authz is
  // role + operatorId (on `user`), so this never widens an access check. Present
  // only when operatorId is, derived server-side from the stored operators.slug.
  readonly operatorSlug?: string
}

/** Read the optional display profile from a token payload. Returns undefined
 *  when no profile claim is present (so the caller omits the key entirely under
 *  exactOptionalPropertyTypes), never a partially-empty object. */
function readProfile(payload: Record<string, unknown>): SessionProfile | undefined {
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const email = typeof payload.email === 'string' ? payload.email : undefined
  const image = typeof payload.image === 'string' ? payload.image : undefined
  if (name === undefined && email === undefined && image === undefined) return undefined
  return {
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(image !== undefined ? { image } : {}),
  }
}

/** Verify an HS256 token (Bearer API token or session cookie) and map its
 *  payload to a caller + CSRF token. Single verification path so the cookie and
 *  Bearer flows can never diverge on what a valid token means. */
async function verifyAndMap(token: string): Promise<VerifiedSession | null> {
  const secret = process.env.AUTH_SECRET
  if (!secret) return null

  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: API_TOKEN_ISSUER,
      audience: API_TOKEN_AUDIENCE,
    })

    const id = payload.sub
    if (!id) return null

    const rawRole = typeof payload.role === 'string' ? payload.role : undefined
    const role: UserRole = rawRole && isValidRole(rawRole) ? rawRole : 'RENTER'
    const operatorId = typeof payload.operatorId === 'string' ? payload.operatorId : undefined
    const operatorSlug = typeof payload.operatorSlug === 'string' ? payload.operatorSlug : undefined
    const csrf = typeof payload.csrf === 'string' ? payload.csrf : undefined
    // exactOptionalPropertyTypes: omit optional keys entirely rather than set undefined.
    const user: AuthUser = operatorId !== undefined ? { id, role, operatorId } : { id, role }
    const profile = readProfile(payload)
    return {
      user,
      ...(csrf !== undefined ? { csrf } : {}),
      ...(profile !== undefined ? { profile } : {}),
      ...(operatorSlug !== undefined ? { operatorSlug } : {}),
    }
  } catch {
    return null
  }
}

export async function verifyJwt(token: string): Promise<AuthUser | null> {
  const session = await verifyAndMap(token)
  return session ? session.user : null
}

/** Verify a `kuruma_session` cookie JWT → caller + CSRF token, or null if
 *  invalid/expired/tampered. Used by GET /auth/session and the CSRF middleware. */
export async function verifySessionCookie(token: string): Promise<VerifiedSession | null> {
  return verifyAndMap(token)
}

// 7-day session, matching Auth.js today and the cookie maxAge (design spec §5.3).
const SESSION_TTL = '7d'

/**
 * Mint a `kuruma_session` JWT for a signed-in user. Kept beside
 * `verifySessionCookie` so the two halves of the session contract (and its
 * iss/aud) can't drift. Shared by the Google sign-in flow (the only provider).
 */
export async function mintSessionToken(
  claims: {
    sub: string
    role: UserRole
    operatorId?: string
    operatorSlug?: string
    csrf: string
    name?: string
    email?: string
    image?: string
  },
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const payload: Record<string, unknown> = { role: claims.role, csrf: claims.csrf }
  if (claims.operatorId !== undefined) payload.operatorId = claims.operatorId
  if (claims.operatorSlug !== undefined) payload.operatorSlug = claims.operatorSlug
  if (claims.name !== undefined) payload.name = claims.name
  if (claims.email !== undefined) payload.email = claims.email
  if (claims.image !== undefined) payload.image = claims.image
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setExpirationTime(SESSION_TTL)
    .sign(key)
}

export function verifyApiKey(key: string): AuthUser | null {
  const expected = process.env.PARTNER_API_KEY
  if (!expected) return null

  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return { id: 'partner:api-key', role: 'PARTNER' }
}
