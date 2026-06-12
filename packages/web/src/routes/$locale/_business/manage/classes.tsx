import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorClassesView } from '@/vite/operator-classes/OperatorClassesView'
import { operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
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

function OperatorClassesRoute() {
  const t = useTranslations('business.classes')
  const { data: classes } = useSuspenseQuery(classesQuery)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorClassesView classes={classes} />
      </div>
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
