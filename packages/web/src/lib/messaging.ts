import { getApiBaseUrl } from './api-client'

export interface ThreadSummary {
  id: string
  bookingId: string | null
  participants: Array<{ userId: string; unreadCount: number }>
  lastMessage: { content: string; senderId: string; createdAt: string } | null
  createdAt: string
}

export interface ThreadDetail {
  id: string
  bookingId: string | null
  participants: Array<{ userId: string; unreadCount: number }>
  messages: Array<{
    id: string
    senderId: string
    content: string
    createdAt: string
  }>
}

export async function fetchThreads(userId: string): Promise<ThreadSummary[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/threads?userId=${encodeURIComponent(userId)}`)
    if (!res.ok) return []

    const body = await res.json()
    if (!body?.success || !Array.isArray(body?.data)) return []

    return body.data as ThreadSummary[]
  } catch {
    return []
  }
}

export async function fetchThread(threadId: string): Promise<ThreadDetail | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(threadId)}`)
    if (!res.ok) return null

    const body = await res.json()
    if (!body?.success || !body?.data) return null

    return body.data as ThreadDetail
  } catch {
    return null
  }
}

export async function sendMessage(threadId: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function markThreadRead(threadId: string, userId: string): Promise<void> {
  try {
    await fetch(`${getApiBaseUrl()}/threads/${encodeURIComponent(threadId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
  } catch {
    // Swallow -- mark-as-read failures should not block UI
  }
}
