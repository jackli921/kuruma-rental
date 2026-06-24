import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { MessageComposer } from './MessageComposer'
import { ThreadView } from './ThreadView'
import {
  type MessageDto,
  THREADS_QUERY_KEY,
  markThreadRead,
  sendMessage,
  threadByIdQueryKey,
} from './api'

interface ConversationViewProps {
  readonly threadId: string
  readonly currentUserId: string
  readonly messages: readonly MessageDto[]
  readonly counterpartName: string
  readonly disabled: boolean
  readonly disabledReason?: string
  readonly csrfToken: string
  readonly locale: string
}

// The conversation's imperative shell (#1032): transcript + composer plus the two
// writes the route can't express declaratively. On mount it marks the thread read
// and invalidates the inbox/badge cache so the unread count drops to 0 with no
// extra request. A send posts with a fresh idempotency key (a retry replays
// server-side instead of duplicating) then invalidates the thread + inbox caches;
// the refetch is the source of truth for the appended message (no optimistic UI).
export function ConversationView({
  threadId,
  currentUserId,
  messages,
  counterpartName,
  disabled,
  disabledReason,
  csrfToken,
  locale,
}: ConversationViewProps) {
  const queryClient = useQueryClient()

  useEffect(() => {
    void markThreadRead(threadId, csrfToken).then(() =>
      queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }),
    )
  }, [threadId, csrfToken, queryClient])

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendMessage(threadId, content, crypto.randomUUID(), csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadByIdQueryKey(threadId) })
      queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <ThreadView
        messages={messages}
        currentUserId={currentUserId}
        counterpartName={counterpartName}
        locale={locale}
      />
      <MessageComposer
        onSend={(content) => sendMutation.mutate(content)}
        pending={sendMutation.isPending}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </div>
  )
}
