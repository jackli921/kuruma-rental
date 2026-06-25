import { formatDateTime } from '@/lib/format'
import { NavBadge } from '@/vite/nav/NavBadge'
import { Link } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { useTranslations } from 'use-intl'
import type { ThreadSummaryDto } from './api'

interface ThreadListViewProps {
  readonly threads: readonly ThreadSummaryDto[]
  /** counterpart userId -> display name (resolved via GET /users?ids=). */
  readonly namesById: Record<string, string | null | undefined>
  readonly currentUserId: string
  readonly locale: string
}

// Presentational renter inbox (#1032). The route owns the loader / threads query
// / name resolution; this stays a pure function of the resolved data so it is
// unit-testable (FC/IS — the shell does I/O, this renders). Each row links to the
// conversation; the counterpart is the participant who is not the caller.
export function ThreadListView({ threads, namesById, currentUserId, locale }: ThreadListViewProps) {
  const t = useTranslations('messaging.threadList')

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20 text-center">
        <MessageSquare className="mb-4 size-12 text-muted-foreground/30" />
        <p className="mb-2 text-lg text-muted-foreground">{t('empty')}</p>
        <p className="text-sm text-muted-foreground/70">{t('emptyDescription')}</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {threads.map((thread) => {
        const counterpart = thread.participants.find((p) => p.userId !== currentUserId)
        const unread = thread.participants.find((p) => p.userId === currentUserId)?.unreadCount ?? 0
        const name = (counterpart && namesById[counterpart.userId]) || t('host')
        // No-message threads still show when they were created, not a blank slot.
        const timestamp = thread.lastMessage?.createdAt ?? thread.updatedAt
        return (
          <li key={thread.id}>
            <Link
              to="/$locale/messages/$threadId"
              params={{ locale, threadId: thread.id }}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{name}</span>
                  <NavBadge count={unread} label={t('unread', { count: unread })} />
                </div>
                {thread.lastMessage ? (
                  <span className="truncate text-sm text-muted-foreground">
                    {thread.lastMessage.content}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(timestamp, locale)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
