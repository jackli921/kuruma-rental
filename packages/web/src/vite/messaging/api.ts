import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// JSON-serialized messaging read models (#335). Dates are ISO strings (no Date
// instances) — the Vite shell owns these DTOs so they stay free of the API's
// process.env path. The interfaces are the single source of truth for the shape;
// the schemas below pin the runtime parse to them via `satisfies z.ZodType<…>`
// (#711), so a dropped/renamed field fails as a ParseError at the network seam
// instead of surfacing as `undefined` deep in a thread render.
export interface MessageDto {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: Record<string, string>
  createdAt: string
}

export interface ThreadParticipantDto {
  id: string
  threadId: string
  userId: string
  unreadCount: number
}

interface ThreadBase {
  id: string
  bookingId: string | null
  createdAt: string
  updatedAt: string
  participants: ThreadParticipantDto[]
}

export interface ThreadSummaryDto extends ThreadBase {
  lastMessage: MessageDto | null
}

export interface ThreadDetailDto extends ThreadBase {
  messages: MessageDto[]
}

export interface TranslationDto {
  translatedText: string
  language: string
  cached: boolean
}

// Public projection from `GET /users?ids=` (id + display name only; the API
// scopes which ids a renter may resolve to their own thread co-participants).
// Used to label inbox rows with the counterpart's name.
export interface UserSummaryDto {
  id: string
  name: string | null
}

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string(),
  content: z.string(),
  sourceLanguage: z.string().nullable(),
  translations: z.record(z.string(), z.string()),
  createdAt: z.string(),
}) satisfies z.ZodType<MessageDto>

const participantSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  userId: z.string(),
  unreadCount: z.number(),
}) satisfies z.ZodType<ThreadParticipantDto>

const threadBase = {
  id: z.string(),
  bookingId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  participants: z.array(participantSchema),
}

const threadSummarySchema = z.object({
  ...threadBase,
  lastMessage: messageSchema.nullable(),
}) satisfies z.ZodType<ThreadSummaryDto>

const threadDetailSchema = z.object({
  ...threadBase,
  messages: z.array(messageSchema),
}) satisfies z.ZodType<ThreadDetailDto>

const translationSchema = z.object({
  translatedText: z.string(),
  language: z.string(),
  cached: z.boolean(),
}) satisfies z.ZodType<TranslationDto>

const userSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
}) satisfies z.ZodType<UserSummaryDto>

// Single-owner operation at 40-50 vehicles: a renter has a handful of threads, so
// the inbox fetches one generous page rather than paginating.
const THREAD_PAGE_LIMIT = 100

function jsonHeaders(csrfToken: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
}

export async function fetchThreads(): Promise<ThreadSummaryDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/threads?limit=${THREAD_PAGE_LIMIT}`, {
    credentials: 'include',
  })
  return unwrap(res, z.array(threadSummarySchema))
}

export async function fetchThreadById(id: string): Promise<ThreadDetailDto | null> {
  const res = await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap(res, threadDetailSchema)
}

export async function sendMessage(
  threadId: string,
  content: string,
  idempotencyKey: string,
  csrfToken: string,
): Promise<MessageDto> {
  const res = await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders(csrfToken),
    body: JSON.stringify({ content, idempotencyKey }),
  })
  return unwrap(res, messageSchema)
}

export async function markThreadRead(threadId: string, csrfToken: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(threadId)}/read`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders(csrfToken),
  })
  await unwrap(res)
}

export async function translateMessage(
  messageId: string,
  targetLanguage: string,
  csrfToken: string,
): Promise<TranslationDto> {
  const res = await fetch(
    `${getApiBaseUrl()}/messages/${encodeURIComponent(messageId)}/translate`,
    {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify({ targetLanguage }),
    },
  )
  return unwrap(res, translationSchema)
}

// Resolve display names for a batch of user ids (inbox counterpart labels). An
// empty list would otherwise issue a pointless `?ids=` request that the API
// rejects/empties anyway, so short-circuit to [] before touching the network.
export async function fetchUsersByIds(ids: readonly string[]): Promise<UserSummaryDto[]> {
  if (ids.length === 0) return []
  const res = await fetch(`${getApiBaseUrl()}/users?ids=${encodeURIComponent(ids.join(','))}`, {
    credentials: 'include',
  })
  return unwrap(res, z.array(userSummarySchema))
}

export const THREADS_QUERY_KEY = ['messaging', 'threads'] as const

// The inbox and the nav unread-badge share this one cache entry. A slow poll +
// refetch-on-focus keeps the badge live without websockets (out of scope); 60s
// is plenty for a single-owner operation and matches the operator "new order"
// badge (operator-bookings/new-bookings.ts).
const THREADS_REFETCH_MS = 60_000

export function threadsQueryOptions() {
  return queryOptions({
    queryKey: THREADS_QUERY_KEY,
    queryFn: fetchThreads,
    refetchOnWindowFocus: true,
    refetchInterval: THREADS_REFETCH_MS,
    staleTime: 30_000,
  })
}

export function threadByIdQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['messaging', 'thread', id],
    queryFn: () => fetchThreadById(id),
  })
}

// Counterpart display names for the inbox, keyed by the (order-independent) id
// set so the same batch caches across renders. Disabled for an empty set.
export function usersByIdsQueryOptions(ids: readonly string[]) {
  const key = [...ids].sort()
  return queryOptions({
    queryKey: ['messaging', 'users', key],
    queryFn: () => fetchUsersByIds(key),
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
  })
}
