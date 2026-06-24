import { formatDateTime } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { MessageDto } from './api'

interface ThreadViewProps {
  readonly messages: readonly MessageDto[]
  readonly currentUserId: string
  /** Display name for every foreign (counterpart) bubble, already resolved. */
  readonly counterpartName: string
  readonly locale: string
}

// Presentational conversation transcript (#1032). Pure function of resolved data
// (FC/IS — the container owns the I/O, this only renders), so it is unit-testable
// without a query client. A bubble is "own" when the caller sent it: own bubbles
// align right and read "You"; foreign bubbles align left under the counterpart's
// name. `data-own` carries that flag so tests assert the speaker side, not CSS.
export function ThreadView({ messages, currentUserId, counterpartName, locale }: ThreadViewProps) {
  const t = useTranslations('messaging.thread')

  if (messages.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">{t('noMessages')}</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {messages.map((msg) => {
        const isOwn = msg.senderId === currentUserId
        return (
          <li
            key={msg.id}
            data-own={isOwn}
            className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{isOwn ? t('you') : counterpartName}</span>
              <span>{formatDateTime(msg.createdAt, locale)}</span>
            </div>
            <div
              className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
                isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              {msg.content}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
