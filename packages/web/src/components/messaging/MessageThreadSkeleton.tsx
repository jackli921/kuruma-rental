import { Skeleton } from '@/components/ui/skeleton'

const KEYS = [
  { id: 'a', mine: false, w: 'w-48' },
  { id: 'b', mine: true, w: 'w-32' },
  { id: 'c', mine: false, w: 'w-56' },
  { id: 'd', mine: true, w: 'w-40' },
] as const

export function MessageThreadSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {KEYS.map((k) => (
        <div key={k.id} className={`flex ${k.mine ? 'justify-end' : 'justify-start'}`}>
          <Skeleton className={`h-10 ${k.w} rounded-2xl`} />
        </div>
      ))}
    </div>
  )
}
