import { queryOptions, useQuery } from '@tanstack/react-query'

// The session the browser learns via GET /auth/session (spec §5.3). User is
// {id, role} only — no email (the API projects just what guards/nav need).
export interface Session {
  user: { id: string; role: string }
  csrfToken: string
}

// API responses use the ok() envelope: { success: true, data: {...} }.
interface SessionEnvelope {
  success: boolean
  data?: Session
}

function isSessionEnvelope(body: unknown): body is { success: true; data: Session } {
  if (typeof body !== 'object' || body === null) return false
  const envelope = body as SessionEnvelope
  return envelope.success === true && envelope.data?.user?.id != null
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

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ['session'],
    queryFn: fetchSession,
  })
}

export function useSession() {
  return useQuery(sessionQueryOptions())
}
