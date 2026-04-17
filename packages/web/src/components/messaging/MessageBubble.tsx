import type { MessageData } from '@/lib/message-api'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  readonly message: MessageData
  readonly isMine: boolean
  readonly senderName: string | null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function MessageBubble({ message, isMine, senderName }: MessageBubbleProps) {
  const isOptimistic = message.id.startsWith('optimistic-')

  return (
    <div className={cn('flex flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
      {!isMine && senderName && (
        <span className="px-3 text-xs text-muted-foreground">{senderName}</span>
      )}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2 text-sm',
          isMine
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm',
          isOptimistic && 'opacity-60',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
      <span className="px-3 text-[11px] text-muted-foreground">
        {formatTime(message.createdAt)}
      </span>
    </div>
  )
}
