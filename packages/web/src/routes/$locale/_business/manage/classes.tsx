import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { AddClassDialog } from '@/vite/operator-classes/AddClassDialog'
import { DeleteClassDialog } from '@/vite/operator-classes/DeleteClassDialog'
import { EditClassDialog } from '@/vite/operator-classes/EditClassDialog'
import { OperatorClassesView } from '@/vite/operator-classes/OperatorClassesView'
import { type OperatorClass, operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { useOperatorScope } from '@/vite/operator-context'
import { RouteRetryError } from '@/vite/route-error'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator vehicle-classes management (#528). URL `/<locale>/manage/classes`,
// behind the `_business` membership guard — only business roles reach it and
// tenant scoping is server-side (the loader hits the protected, operator-scoped
// `/vehicle-classes/manage` list). includeArchived:true so owners see their
// soft-archived classes (muted badge). The loader prefetches into the query
// cache (no FOUC); the component reads the same options via useSuspenseQuery.
export const Route = createFileRoute('/$locale/_business/manage/classes')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      operatorClassesQueryOptions({ includeArchived: true }, deps.operator),
    ),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorClassesError,
  component: OperatorClassesRoute,
})

export function OperatorClassesRoute() {
  const t = useTranslations('business.classes')
  const scope = useOperatorScope()
  const { data: classes } = useSuspenseQuery(
    operatorClassesQueryOptions({ includeArchived: true }, scope.pickedOperatorId),
  )
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<OperatorClass | null>(null)
  const [deleting, setDeleting] = useState<OperatorClass | null>(null)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          {scope.canWrite && (
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('addClass')}
            </Button>
          )}
        </header>
        <OperatorClassesView
          classes={classes}
          onEdit={scope.canWrite ? setEditing : undefined}
          onDelete={scope.canWrite ? setDeleting : undefined}
        />
      </div>
      {scope.canWrite && (
        <>
          <AddClassDialog
            open={showAdd}
            onOpenChange={setShowAdd}
            pickedOperatorId={scope.pickedOperatorId}
          />
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

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-7xl py-20 text-center"
      />
    </main>
  )
}
