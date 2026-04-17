'use client'

import { EmptyState } from '@/components/EmptyState'
import { ThreadListItem } from '@/components/messaging/ThreadListItem'
import { ThreadListSkeleton } from '@/components/messaging/ThreadListSkeleton'
import { useThreads, useUserNames } from '@/hooks/useMessages'
import { getCounterpartyId } from '@/lib/message-utils'
import { AlertCircle, MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

interface MessageInboxProps {
  readonly currentUserId: string
  readonly selectedThreadId: string | null
  readonly onSelectThread: (threadId: string) => void
}

export function MessageInbox({
  currentUserId,
  selectedThreadId,
  onSelectThread,
}: MessageInboxProps) {
  const t = useTranslations('messaging.threadList')
  const { data: threads, isLoading, error } = useThreads()

  const counterpartyIds = useMemo(() => {
    if (!threads) return [] as string[]
    const ids = new Set<string>()
    for (const thread of threads) {
      const id = getCounterpartyId(thread, currentUserId)
      if (id) ids.add(id)
    }
    return [...ids]
  }, [threads, currentUserId])

  const { data: nameRows } = useUserNames(counterpartyIds)

  const userNames = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const row of nameRows ?? []) {
      map.set(row.id, row.name)
    }
    return map
  }, [nameRows])

  if (isLoading) return <ThreadListSkeleton />

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="size-10 text-destructive/60 mb-3" />
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  if (!threads || threads.length === 0) {
    return <EmptyState icon={MessageSquare} message={t('empty')} />
  }

  return (
    <ul className="divide-y divide-border">
      {threads.map((thread) => (
        <li key={thread.id}>
          <ThreadListItem
            thread={thread}
            currentUserId={currentUserId}
            userNames={userNames}
            isSelected={thread.id === selectedThreadId}
            onSelect={onSelectThread}
          />
        </li>
      ))}
    </ul>
  )
}
