'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent, useState } from 'react'

interface ComposeInputProps {
  readonly onSend: (content: string) => Promise<void> | void
  readonly disabled?: boolean
}

export function ComposeInput({ onSend, disabled = false }: ComposeInputProps) {
  const t = useTranslations('messaging.thread')
  const [value, setValue] = useState('')
  const [isSending, setIsSending] = useState(false)

  const trimmed = value.trim()
  const canSend = trimmed.length > 0 && !disabled && !isSending

  async function send() {
    if (!canSend) return
    const content = trimmed
    setValue('')
    setIsSending(true)
    try {
      await onSend(content)
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('sendPlaceholder')}
        disabled={disabled}
        rows={1}
        className="max-h-32 min-h-10 resize-none"
        aria-label={t('sendPlaceholder')}
      />
      <Button
        type="button"
        size="icon"
        onClick={() => void send()}
        disabled={!canSend}
        aria-label={t('send')}
      >
        <Send className="size-4" />
      </Button>
    </div>
  )
}
