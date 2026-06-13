import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorSession } from '@/vite/guards'
import { AddClassDialog } from '@/vite/operator-classes/AddClassDialog'
import { DeleteClassDialog } from '@/vite/operator-classes/DeleteClassDialog'
import { EditClassDialog } from '@/vite/operator-classes/EditClassDialog'
import { OperatorClassesView } from '@/vite/operator-classes/OperatorClassesView'
import { type OperatorClass, operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { sessionQueryOptions } from '@/vite/session'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator vehicle-classes management (#528). URL `/<locale>/manage/classes`,
// behind the `_business` membership guard — only business roles reach it and
// tenant scoping is server-side (the loader hits the protected, operator-scoped
// `/vehicle-classes/manage` list). includeArchived:true so owners see their
// soft-archived classes (muted badge). The loader prefetches into the query
// cache (no FOUC); the component reads the same options via useSuspenseQuery.
const classesQuery = operatorClassesQueryOptions({ includeArchived: true })

export const Route = createFileRoute('/$locale/_business/manage/classes')({
  loader: ({ context }) => context.queryClient.ensureQueryData(classesQuery),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorClassesError,
  component: OperatorClassesRoute,
})

export function OperatorClassesRoute() {
  const t = useTranslations('business.classes')
  const { data: classes } = useSuspenseQuery(classesQuery)
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<OperatorClass | null>(null)
  const [deleting, setDeleting] = useState<OperatorClass | null>(null)

  // Bypass roles (PLATFORM_ADMIN / legacy STAFF·ADMIN — no operatorId) read the
  // operator-scoped list for oversight but cannot write: a create needs a single
  // target tenant they don't carry, and the portal has no operator picker. So the
  // page is read-only for them, mirroring locations (#583, #529 review pattern).
  const canWrite = isOperatorSession(session)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          {canWrite && (
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('addClass')}
            </Button>
          )}
        </header>
        <OperatorClassesView
          classes={classes}
          onEdit={canWrite ? setEditing : undefined}
          onDelete={canWrite ? setDeleting : undefined}
        />
      </div>
      {canWrite && (
        <>
          <AddClassDialog open={showAdd} onOpenChange={setShowAdd} />
          <EditClassDialog
            vehicleClass={editing}
            onOpenChange={(open) => !open && setEditing(null)}
          />
          <DeleteClassDialog
            vehicleClass={deleting}
            onOpenChange={(open) => !open && setDeleting(null)}
          />
        </>
      )}
    </main>
  )
}

function OperatorClassesError(_props: ErrorComponentProps) {
  const t = useTranslations('business.classes')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
