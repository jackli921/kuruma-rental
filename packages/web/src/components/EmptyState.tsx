import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  readonly icon: LucideIcon
  readonly message: string
}

export function EmptyState({ icon: Icon, message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Icon className="size-12 text-muted-foreground/30 mb-4" />
      <p className="text-lg text-muted-foreground">{message}</p>
    </div>
  )
}
