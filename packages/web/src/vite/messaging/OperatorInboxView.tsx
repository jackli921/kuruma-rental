import { formatDateTime } from '@/lib/format'
import { NavBadge } from '@/vite/nav/NavBadge'
import { Link } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { useTranslations } from 'use-intl'
import type { ThreadSummaryDto } from './api'

interface OperatorInboxViewProps {
  readonly threads: readonly ThreadSummaryDto[]
  readonly locale: string
}

// Presentational operator inbox (#1205 slice 3). The renter ThreadListView labels
// each row by the counterpart's resolved name; the operator can't (the /users
// directory fail-closes operators, and the operator isn't a thread participant),
// so this is preview-led: last message + time + the tenant-level unread badge. The
// conversation view shows the renter's name (resolved from the booking). Pure
// function of resolved data (FC/IS) so it is unit-testable without the network.
export function OperatorInboxView({ threads, locale }: OperatorInboxViewProps) {
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

  // Newest activity first, regardless of server order — deterministic for the test
  // and the obvious reading order for an inbox.
  const ordered = [...threads].sort(
    (a, b) =>
      new Date(b.lastMessage?.createdAt ?? b.updatedAt).getTime() -
      new Date(a.lastMessage?.createdAt ?? a.updatedAt).getTime(),
  )

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((thread) => {
        const unread = thread.operatorUnreadCount
        const timestamp = thread.lastMessage?.createdAt ?? thread.updatedAt
        return (
          <li key={thread.id}>
            <Link
              to="/$locale/manage/messages/$threadId"
              params={{ locale, threadId: thread.id }}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <NavBadge count={unread} label={t('unread', { count: unread })} />
                {thread.lastMessage ? (
                  <span className="truncate text-sm text-muted-foreground">
                    {thread.lastMessage.content}
                  </span>
                ) : (
                  <span className="truncate text-sm text-muted-foreground/70">
                    {t('emptyDescription')}
                  </span>
                )}
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
