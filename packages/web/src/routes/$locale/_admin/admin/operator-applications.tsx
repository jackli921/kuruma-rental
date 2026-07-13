import { ApiError } from '@/lib/api-error'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { ApplicationsReviewView } from '@/vite/admin/operator-applications/ApplicationsReviewView'
import {
  ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
  approveApplication,
  pendingOperatorApplicationsQueryOptions,
  rejectOperatorApplication,
} from '@/vite/admin/operator-applications/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Platform-admin operator-application review (#1277). The `_admin` parent layout
// already gates on platform-admin membership, so this only owns the data:
// prefetch the pending queue in the loader, render the pure
// ApplicationsReviewView, and wire its reject + approve callbacks to their
// respective mutations (CSRF token from the session).
//
// Approve design: on success we do NOT invalidate the pending query, because
// invalidating would drop the just-approved row before the admin sees the
// confirmation. Instead we accumulate approved ids and pass them down; each
// matching card enters a terminal "Approved" state. The admin refreshes to clear
// resolved rows.
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
  const [approvedIds, setApprovedIds] = useState<ReadonlySet<string>>(() => new Set())

  const rejectMutation = useMutation({
    mutationFn: rejectOperatorApplication,
    // A recorded rejection leaves the PENDING queue, so refetch to drop the row.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY }),
  })

  const approveMutation = useMutation({
    mutationFn: approveApplication,
    // Do NOT invalidate here — the approved row must stay visible so the admin
    // can see the plain "Approved" confirmation. The card enters a terminal state
    // until the admin manually refreshes.
    onSuccess: (_result, vars) => setApprovedIds((prev) => new Set(prev).add(vars.id)),
  })

  return (
    <ApplicationsReviewView
      applications={data}
      submittingId={rejectMutation.isPending ? (rejectMutation.variables?.id ?? null) : null}
      errorId={rejectMutation.isError ? (rejectMutation.variables?.id ?? null) : null}
      onReject={(id, reason) => rejectMutation.mutate({ id, rejectionReason: reason, csrfToken })}
      onApprove={(id) => approveMutation.mutate({ id, csrfToken })}
      approvingId={approveMutation.isPending ? (approveMutation.variables?.id ?? null) : null}
      approveError={
        approveMutation.isError
          ? {
              id: approveMutation.variables?.id ?? null,
              // A 409 means already-reviewed / email-in-use (a distinct, actionable
              // message); anything else (500, network) is a generic retryable failure.
              alreadyReviewed:
                approveMutation.error instanceof ApiError && approveMutation.error.status === 409,
            }
          : null
      }
      approvedIds={approvedIds}
    />
  )
}

function ApplicationsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.applications')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8"
    />
  )
}
