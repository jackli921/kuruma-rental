import { ALL_ROLES, type UserRole } from '@kuruma/shared/auth/roles'
import { queryOptions, useQuery } from '@tanstack/react-query'

// The session the browser learns via GET /auth/session (spec §5.3). `id`/`role`
// drive guards; the optional `name`/`email`/`image` are display-only profile the
// session token carries for the navbar avatar/menu (mirrors NextAuth's old JWT).
// They are absent for users whose OAuth profile omitted them.
export interface Session {
  // `operatorId`/`operatorSlug` are present only for operator sessions (#521).
  // `operatorSlug` presence marks the session as an operator (provider login
  // redirects them on to the dashboard); the portal is scoped by `operatorId`.
  user: {
    id: string
    role: UserRole
    operatorId?: string
    operatorSlug?: string
    name?: string
    email?: string
    image?: string
  }
  csrfToken: string
}

// API responses use the ok() envelope: { success: true, data: {...} }.
interface SessionEnvelope {
  success: boolean
  data?: Session
}

function isValidRole(value: unknown): value is UserRole {
  return typeof value === 'string' && ALL_ROLES.has(value)
}

function isSessionEnvelope(body: unknown): body is { success: true; data: Session } {
  if (typeof body !== 'object' || body === null) return false
  const envelope = body as SessionEnvelope
  // Validate role at the HTTP boundary: the API could add a role tomorrow that
  // the web's UserRole union doesn't know about (or send a typo'd string). Treat
  // those as "no session" rather than letting an unvalidated literal into the
  // compile-time-typed Session.user.role.
  return (
    envelope.success === true &&
    envelope.data?.user?.id != null &&
    isValidRole(envelope.data.user.role)
  )
}

/**
 * Read the current session. 401 -> null (signed out). A 200 that is not a valid
 * ok() envelope is treated as no-session, never mistaken for auth (review #6).
 * Other failures throw so the router surfaces them rather than silently logging out.
 */
export async function fetchSession(): Promise<Session | null> {
  const response = await fetch('/auth/session', { credentials: 'include' })
  if (response.status === 401) return null
  if (!response.ok) {
    throw new Error(`Failed to load session: ${response.status}`)
  }
  const body: unknown = await response.json()
  return isSessionEnvelope(body) ? body.data : null
}

/**
 * End the session (spec §5.4). The API clears the `kuruma_session` cookie and
 * replies 204. As a cookie-authenticated POST it is CSRF-gated, so the caller
 * must echo the session's CSRF token in the `X-CSRF-Token` header — a value a
 * cross-origin attacker can't read.
 */
export async function signOut(csrfToken: string): Promise<void> {
  const response = await fetch('/auth/signout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  if (!response.ok) {
    throw new Error(`Sign out failed: ${response.status}`)
  }
}

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ['session'],
    queryFn: fetchSession,
  })
}

export function useSession() {
  return useQuery(sessionQueryOptions())
}
