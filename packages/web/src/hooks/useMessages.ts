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

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation<MessageData, Error, SendMessageVariables, { previous?: ThreadDetailData }>({
    mutationFn: ({ threadId, content, idempotencyKey }) =>
      sendMessageAction(threadId, content, idempotencyKey).then(unwrap),

    onMutate: async ({ threadId, content, idempotencyKey, senderId }) => {
      const key = messageKeys.thread(threadId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ThreadDetailData>(key)

      if (previous) {
        const optimistic: MessageData = {
          id: `optimistic-${idempotencyKey}`,
          threadId,
          senderId,
          content,
          sourceLanguage: null,
          translations: '{}',
          idempotencyKey,
          createdAt: new Date().toISOString(),
        }
        queryClient.setQueryData<ThreadDetailData>(key, {
          ...previous,
          messages: [...previous.messages, optimistic],
        })
      }

      return previous ? { previous } : {}
    },

    onError: (_err, { threadId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(messageKeys.thread(threadId), context.previous)
      }
    },

    onSettled: (_data, _err, { threadId }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.thread(threadId) })
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
