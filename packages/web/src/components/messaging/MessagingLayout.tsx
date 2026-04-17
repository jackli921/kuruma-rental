'use client'

import { MessageInbox } from '@/components/messaging/MessageInbox'
import { MessageThread } from '@/components/messaging/MessageThread'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface MessagingLayoutProps {
  readonly currentUserId: string
}

export function MessagingLayout({ currentUserId }: MessagingLayoutProps) {
  const t = useTranslations('messaging')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)

  return (
    <div className="flex h-[calc(100dvh-4rem)] overflow-hidden border-t border-border">
      {/* Inbox: full-width on mobile when no thread selected; sidebar on md+ */}
      <aside
        className={cn(
          'flex w-full flex-col border-r border-border md:w-80 md:max-w-sm md:flex-shrink-0',
          selectedThreadId && 'hidden md:flex',
        )}
      >
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">{t('threadList.title')}</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          <MessageInbox
            currentUserId={currentUserId}
            selectedThreadId={selectedThreadId}
            onSelectThread={setSelectedThreadId}
          />
        </div>
      </aside>

      {/* Conversation: hidden on mobile until selected */}
      <section className={cn('flex flex-1 flex-col', !selectedThreadId && 'hidden md:flex')}>
        {selectedThreadId ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedThreadId(null)}
                aria-label="Back to inbox"
              >
                <ArrowLeft className="size-5" />
              </Button>
            </header>
            <MessageThread threadId={selectedThreadId} currentUserId={currentUserId} />
          </>
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center md:flex">
            <MessageSquare className="size-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">{t('threadList.empty')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
