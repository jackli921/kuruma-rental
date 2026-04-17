import {
  type ActionResult,
  fetchThreadAction,
  fetchThreadsAction,
  fetchUserNamesAction,
  markThreadAsReadAction,
  sendMessageAction,
} from '@/lib/message-actions'
import type {
  MessageData,
  ThreadDetailData,
  ThreadSummaryData,
  UserNameData,
} from '@/lib/message-api'
import { messageKeys } from '@/lib/query-keys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

async function unwrap<T>(result: ActionResult<T>): Promise<T> {
  if (!result.success) throw new Error(result.error)
  return result.data
}

export function useThreads() {
  return useQuery({
    queryKey: messageKeys.threads(),
    queryFn: () => fetchThreadsAction().then(unwrap),
  })
}

export function useThread(id: string | null) {
  return useQuery({
    queryKey: id ? messageKeys.thread(id) : [...messageKeys.all, 'thread', 'none'],
    queryFn: () => (id ? fetchThreadAction(id).then(unwrap) : Promise.resolve(null)),
    enabled: id !== null,
  })
}

export function useUserNames(ids: readonly string[]) {
  return useQuery({
    queryKey: messageKeys.userNames(ids),
    queryFn: () => fetchUserNamesAction([...ids]).then(unwrap),
    enabled: ids.length > 0,
  })
}

interface SendMessageVariables {
  threadId: string
  content: string
  idempotencyKey: string
  senderId: string
}

function optimisticIdFor(idempotencyKey: string): string {
  return `optimistic-${idempotencyKey}`
}

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation<MessageData, Error, SendMessageVariables>({
    mutationFn: ({ threadId, content, idempotencyKey }) =>
      sendMessageAction(threadId, content, idempotencyKey).then(unwrap),

    // Surgical insert: append the optimistic message identified by its
    // idempotencyKey. Snapshot/rollback would corrupt the cache when two sends
    // are in flight — restoring a snapshot taken before send #2 would erase
    // send #1's still-in-flight optimistic entry.
    onMutate: async ({ threadId, content, idempotencyKey, senderId }) => {
      const key = messageKeys.thread(threadId)
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<ThreadDetailData>(key, (prev) => {
        if (!prev) return prev
        const optimistic: MessageData = {
          id: optimisticIdFor(idempotencyKey),
          threadId,
          senderId,
          content,
          sourceLanguage: null,
          translations: '{}',
          idempotencyKey,
          createdAt: new Date().toISOString(),
        }
        return { ...prev, messages: [...prev.messages, optimistic] }
      })
    },

    // Surgical remove: drop only the failed entry by its optimistic id, leaving
    // any other in-flight optimistic messages untouched.
    onError: (_err, { threadId, idempotencyKey }) => {
      const key = messageKeys.thread(threadId)
      const optimisticId = optimisticIdFor(idempotencyKey)
      queryClient.setQueryData<ThreadDetailData>(key, (prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev,
      )
    },

    onSuccess: (real, { threadId, idempotencyKey }) => {
      const key = messageKeys.thread(threadId)
      const optimisticId = optimisticIdFor(idempotencyKey)
      queryClient.setQueryData<ThreadDetailData>(key, (prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === optimisticId ? real : m)) }
          : prev,
      )
    },

    onSettled: () => {
      // Refresh the inbox previews / unread counts; the thread cache is already
      // up to date via the surgical insert, so no extra fetch needed there.
      queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
    },
  })
}

export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation<null, Error, string>({
    mutationFn: (threadId) => markThreadAsReadAction(threadId).then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
    },
  })
}

export type { ThreadDetailData, ThreadSummaryData, MessageData, UserNameData }
