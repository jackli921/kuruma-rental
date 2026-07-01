import { PageSkeleton } from '@/vite/PageSkeleton'
import { ApplicationsReviewView } from '@/vite/admin/operator-applications/ApplicationsReviewView'
import {
  ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
  pendingOperatorApplicationsQueryOptions,
  rejectOperatorApplication,
} from '@/vite/admin/operator-applications/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin operator-application review (#1277). The `_admin` parent layout
// already gates on platform-admin membership, so this only owns the data:
// prefetch the pending queue in the loader, render the pure
// ApplicationsReviewView, and wire its reject callback to the reject mutation
// (CSRF token from the session).
export const Route = createFileRoute('/$locale/_admin/admin/operator-applications')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pendingOperatorApplicationsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: ApplicationsError,
  component: ApplicationsRoute,
})

function ApplicationsRoute() {
  const { data } = useSuspenseQuery(pendingOperatorApplicationsQueryOptions())
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const mutation = useMutation({
    mutationFn: rejectOperatorApplication,
    // A recorded rejection leaves the PENDING queue, so refetch to drop the row.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY }),
  })

  return (
    <ApplicationsReviewView
      applications={data}
      submittingId={mutation.isPending ? (mutation.variables?.id ?? null) : null}
      errorId={mutation.isError ? (mutation.variables?.id ?? null) : null}
      onReject={(id, reason) => mutation.mutate({ id, rejectionReason: reason, csrfToken })}
    />
  )
}

function ApplicationsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.applications')
  const router = useRouter()
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
