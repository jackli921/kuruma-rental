import { type FormEvent, useState } from 'react'
import { useTranslations } from 'use-intl'

interface MessageComposerProps {
  readonly onSend: (content: string) => void
  /** A send is in flight — block re-submits until it settles. */
  readonly pending: boolean
  /** The thread is read-only (e.g. the booking was cancelled). */
  readonly disabled: boolean
  /** Shown in place of the input when disabled (why it's locked). */
  readonly disabledReason?: string | undefined
}

// Presentational message composer (#1032). Owns only the draft text; the parent
// owns the network send (CQS — this asks for nothing, just reports a send intent
// via onSend). Sending is blocked when the draft is blank, a send is pending, or
// the thread is locked, so a disabled button can never fire an empty/double send.
export function MessageComposer({
  onSend,
  pending,
  disabled,
  disabledReason,
}: MessageComposerProps) {
  const t = useTranslations('messaging.thread')
  const [draft, setDraft] = useState('')

  const trimmed = draft.trim()
  const canSend = trimmed !== '' && !pending && !disabled

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      {disabled && disabledReason ? (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-center text-sm text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          aria-label={t('composeLabel')}
          placeholder={t('sendPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          rows={2}
          className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {t('send')}
        </button>
      </form>
    </div>
  )
}
