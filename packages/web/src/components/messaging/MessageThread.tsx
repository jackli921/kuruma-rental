'use client'

import { ComposeInput } from '@/components/messaging/ComposeInput'
import { MessageBubble } from '@/components/messaging/MessageBubble'
import { MessageThreadSkeleton } from '@/components/messaging/MessageThreadSkeleton'
import { useMarkAsRead, useSendMessage, useThread, useUserNames } from '@/hooks/useMessages'
import { getMyUnreadCount } from '@/lib/message-utils'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef } from 'react'

interface MessageThreadProps {
  readonly threadId: string
  readonly currentUserId: string
}

export function MessageThread({ threadId, currentUserId }: MessageThreadProps) {
  const t = useTranslations('messaging.thread')
  const { data: thread, isLoading, error } = useThread(threadId)
  const sendMessage = useSendMessage()
  const markAsRead = useMarkAsRead()
  const scrollRef = useRef<HTMLDivElement>(null)

  const otherParticipantIds = useMemo(() => {
    if (!thread) return [] as string[]
    return thread.participants.filter((p) => p.userId !== currentUserId).map((p) => p.userId)
  }, [thread, currentUserId])

  const { data: nameRows } = useUserNames(otherParticipantIds)
  const userNames = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of nameRows ?? []) m.set(r.id, r.name)
    return m
  }, [nameRows])

  // Mark as read only when the caller actually has unread. Depending on `thread`
  // itself would re-fire on every refetch — and markAsRead's onSuccess invalidates
  // the thread list, which can cascade into an infinite mark→invalidate→refetch
  // loop. `unread` is a primitive that increments when a new message arrives,
  // which is exactly when we want to re-mark.
  const unread = thread ? getMyUnreadCount(thread, currentUserId) : 0
  const markAsReadMutate = markAsRead.mutate
  useEffect(() => {
    if (unread > 0) markAsReadMutate(threadId)
  }, [threadId, unread, markAsReadMutate])

  // Auto-scroll to bottom whenever the messages array reference changes.
  const messages = thread?.messages
  useEffect(() => {
    if (!messages) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function handleSend(content: string) {
    if (!thread) return
    await sendMessage.mutateAsync({
      threadId: thread.id,
      content,
      idempotencyKey: crypto.randomUUID(),
      senderId: currentUserId,
    })
  }

  if (isLoading) return <MessageThreadSkeleton />

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="size-10 text-destructive/60 mb-3" />
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t('noMessages')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {thread.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">{t('noMessages')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {thread.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isMine={m.senderId === currentUserId}
                senderName={userNames.get(m.senderId) ?? null}
              />
            ))}
          </div>
        )}
      </div>
      <ComposeInput onSend={handleSend} disabled={sendMessage.isPending} />
    </div>
  )
}
