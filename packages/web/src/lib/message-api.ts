import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

// JSON-serialized message types — dates come as ISO strings from the API.

export interface ThreadParticipantData {
  id: string
  threadId: string
  userId: string
  unreadCount: number
}

export interface MessageData {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: string
  idempotencyKey: string | null
  createdAt: string
}

export interface ThreadSummaryData {
  id: string
  bookingId: string | null
  idempotencyKey: string | null
  createdAt: string
  updatedAt: string
  participants: ThreadParticipantData[]
  lastMessage: MessageData | null
}

export interface ThreadDetailData extends Omit<ThreadSummaryData, 'lastMessage'> {
  messages: MessageData[]
}

export interface UserNameData {
  id: string
  name: string | null
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
  }

  return body.data
}

export async function fetchThreads(token?: string): Promise<ThreadSummaryData[]> {
  const client = createApiClient(token)
  const res = await client.threads.$get()
  return unwrap<ThreadSummaryData[]>(res)
}

export async function fetchThread(id: string, token?: string): Promise<ThreadDetailData | null> {
  const client = createApiClient(token)
  try {
    const res = await client.threads[':id'].$get({ param: { id } })
    return await unwrap<ThreadDetailData>(res)
  } catch (e) {
    if (e instanceof Error && e.message === 'Thread not found') return null
    throw e
  }
}

export async function sendMessage(
  threadId: string,
  content: string,
  idempotencyKey: string,
  token?: string,
): Promise<MessageData> {
  const client = createApiClient()
  const url = client.threads[':id'].messages.$url({ param: { id: threadId } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, idempotencyKey }),
  })
  return unwrap<MessageData>(res)
}

export async function markThreadAsRead(threadId: string, token?: string): Promise<void> {
  const client = createApiClient()
  const url = client.threads[':id'].read.$url({ param: { id: threadId } })
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers })
  await unwrap<null>(res)
}

export async function fetchUserNames(ids: string[], token?: string): Promise<UserNameData[]> {
  if (ids.length === 0) return []
  const client = createApiClient(token)
  const res = await client.users.$get({ query: { ids: ids.join(',') } })
  return unwrap<UserNameData[]>(res)
}
