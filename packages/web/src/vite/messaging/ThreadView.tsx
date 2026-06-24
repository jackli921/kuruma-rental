import { useTranslations } from 'use-intl'
import { MessageBubble } from './MessageBubble'
import type { MessageDto } from './api'

interface ThreadViewProps {
  readonly messages: readonly MessageDto[]
  readonly currentUserId: string
  /** Display name for every foreign (counterpart) bubble, already resolved. */
  readonly counterpartName: string
  readonly locale: string
  /** Injected I/O for per-message translation (the shell wires translateMessage). */
  readonly onTranslate: (messageId: string, targetLanguage: string) => Promise<string>
}

// Presentational conversation transcript (#1032). Pure map over resolved data
// (FC/IS — the container owns the I/O, this only renders), so it is unit-testable
// without a query client. Each row is a self-contained `MessageBubble` that owns
// its own translate toggle; this view only decides the empty state and ordering.
export function ThreadView({
  messages,
  currentUserId,
  counterpartName,
  locale,
  onTranslate,
}: ThreadViewProps) {
  const t = useTranslations('messaging.thread')

  if (messages.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">{t('noMessages')}</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {messages.map((msg) => (
        // Key on locale too: a per-message translation is cached in the bubble's
        // local state and is only valid for one target language, so switching the
        // UI locale must remount the bubble to drop a now-wrong-language result.
        <MessageBubble
          key={`${msg.id}:${locale}`}
          message={msg}
          isOwn={msg.senderId === currentUserId}
          speakerName={counterpartName}
          locale={locale}
          onTranslate={onTranslate}
        />
      ))}
    </ul>
  )
}
