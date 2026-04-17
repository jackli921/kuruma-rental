'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { ThreadSummaryData } from '@/lib/message-api'
import { formatRelativeTime, getCounterpartyId, getMyUnreadCount } from '@/lib/message-utils'
import { cn } from '@/lib/utils'

interface ThreadListItemProps {
  readonly thread: ThreadSummaryData
  readonly currentUserId: string
  readonly userNames: ReadonlyMap<string, string | null>
  readonly isSelected: boolean
  readonly onSelect: (threadId: string) => void
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function ThreadListItem({
  thread,
  currentUserId,
  userNames,
  isSelected,
  onSelect,
}: ThreadListItemProps) {
  const counterpartyId = getCounterpartyId(thread, currentUserId)
  const counterpartyName = counterpartyId ? (userNames.get(counterpartyId) ?? null) : null
  const displayName = counterpartyName ?? counterpartyId?.slice(0, 8) ?? 'Unknown'
  const unread = getMyUnreadCount(thread, currentUserId)
  const lastMessageAt = thread.lastMessage?.createdAt ?? thread.updatedAt
  const preview = thread.lastMessage?.content ?? ''

  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
        isSelected && 'bg-muted',
      )}
      aria-current={isSelected ? 'true' : undefined}
    >
      <Avatar size="default">
        <AvatarFallback>{initials(counterpartyName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              unread > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {displayName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(lastMessageAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm',
              unread > 0 ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {preview || '\u00a0'}
          </p>
          {unread > 0 && (
            <Badge variant="default" className="h-5 min-w-5 shrink-0 px-1.5 text-xs">
              {unread}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}
