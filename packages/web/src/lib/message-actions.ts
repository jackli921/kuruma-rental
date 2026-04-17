'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type MessageData,
  type ThreadDetailData,
  type ThreadSummaryData,
  type UserNameData,
  fetchThread,
  fetchThreads,
  fetchUserNames,
  markThreadAsRead,
  sendMessage,
} from '@/lib/message-api'

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<ActionResult<T>> {
  const token = await getApiToken()
  if (!token) {
    return { success: false, error: 'Authentication required' }
  }
  try {
    const data = await fn(token)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'An error occurred' }
  }
}

export async function fetchThreadsAction(): Promise<ActionResult<ThreadSummaryData[]>> {
  return withAuth((token) => fetchThreads(token))
}

export async function fetchThreadAction(
  id: string,
): Promise<ActionResult<ThreadDetailData | null>> {
  return withAuth((token) => fetchThread(id, token))
}

export async function sendMessageAction(
  threadId: string,
  content: string,
  idempotencyKey: string,
): Promise<ActionResult<MessageData>> {
  return withAuth((token) => sendMessage(threadId, content, idempotencyKey, token))
}

export async function markThreadAsReadAction(threadId: string): Promise<ActionResult<null>> {
  return withAuth(async (token) => {
    await markThreadAsRead(threadId, token)
    return null
  })
}

export async function fetchUserNamesAction(ids: string[]): Promise<ActionResult<UserNameData[]>> {
  return withAuth((token) => fetchUserNames(ids, token))
}
