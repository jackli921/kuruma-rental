import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import type { MessageDto } from './api'

type TranslateStatus = 'idle' | 'loading' | 'error'

interface MessageBubbleProps {
  readonly message: MessageDto
  readonly isOwn: boolean
  /** Display name for a foreign (counterpart) bubble. */
  readonly speakerName: string
  /** UI locale — both the `translations[locale]` cache key and the translate target. */
  readonly locale: string
  /** Injected I/O: fetch the translated text (the shell wires this to translateMessage). */
  readonly onTranslate: (messageId: string, targetLanguage: string) => Promise<string>
}

// One conversation bubble (#1032). The transcript stays a pure map (ThreadView);
// per-message translate state lives here so each bubble toggles independently.
// `data-own` carries the speaker side so tests assert it instead of CSS.
export function MessageBubble({
  message,
  isOwn,
  speakerName,
  locale,
  onTranslate,
}: MessageBubbleProps) {
  const t = useTranslations('messaging.thread')
  const [showTranslation, setShowTranslation] = useState(false)
  const [fetched, setFetched] = useState<string | null>(null)
  const [status, setStatus] = useState<TranslateStatus>('idle')

  const translated = message.translations[locale] ?? fetched
  const body = showTranslation && translated != null ? translated : message.content

  function revealTranslation() {
    if (status === 'loading') return
    if (translated != null) {
      setShowTranslation(true)
      return
    }
    setStatus('loading')
    onTranslate(message.id, locale)
      .then((text) => {
        setFetched(text)
        setShowTranslation(true)
        setStatus('idle')
      })
      .catch(() => setStatus('error'))
  }

  function handleToggle() {
    if (showTranslation) setShowTranslation(false)
    else revealTranslation()
  }

  return (
    <li data-own={isOwn} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{isOwn ? t('you') : speakerName}</span>
        <span>{formatDateTime(message.createdAt, locale)}</span>
      </div>
      <div
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
          isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {body}
      </div>
      {status === 'loading' ? (
        <Skeleton aria-label={t('translating')} className="h-4 w-32" />
      ) : status === 'error' ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('translationUnavailable')}</span>
          <button
            type="button"
            onClick={revealTranslation}
            className="font-medium underline underline-offset-2"
          >
            {t('retry')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleToggle}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showTranslation ? t('showOriginal') : t('translate')}
        </button>
      )}
    </li>
  )
}
