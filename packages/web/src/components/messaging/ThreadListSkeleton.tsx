import { Skeleton } from '@/components/ui/skeleton'

const KEYS = ['a', 'b', 'c', 'd', 'e'] as const

export function ThreadListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {KEYS.map((k) => (
        <div key={k} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}
