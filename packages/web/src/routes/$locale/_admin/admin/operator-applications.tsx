import { ApiError } from '@/lib/api-error'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { ApplicationsReviewView } from '@/vite/admin/operator-applications/ApplicationsReviewView'
import {
  ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
  approveApplication,
  pendingOperatorApplicationsQueryOptions,
  rejectOperatorApplication,
} from '@/vite/admin/operator-applications/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Platform-admin operator-application review (#1277). The `_admin` parent layout
// already gates on platform-admin membership, so this only owns the data:
// prefetch the pending queue in the loader, render the pure
// ApplicationsReviewView, and wire its reject + approve callbacks to their
// respective mutations (CSRF token from the session).
//
// Approve design: on success we do NOT invalidate the pending query, because
// invalidating would drop the just-approved row before the admin can copy the
// invite link. Instead we store {id, inviteUrl} in local state and pass it down
// to the matching card, which enters a terminal "approved + invite reveal" state.
// The admin refreshes the page to clear resolved rows.
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
  const [approvedInvite, setApprovedInvite] = useState<{ id: string; inviteUrl: string } | null>(
    null,
  )

  const rejectMutation = useMutation({
    mutationFn: rejectOperatorApplication,
    // A recorded rejection leaves the PENDING queue, so refetch to drop the row.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY }),
  })

  const approveMutation = useMutation({
    mutationFn: approveApplication,
    // Do NOT invalidate here — the approved row must stay visible so the admin can
    // copy the one-time invite link. The card enters a terminal approved state
    // until the admin manually refreshes.
    onSuccess: (result, vars) => setApprovedInvite({ id: vars.id, inviteUrl: result.inviteUrl }),
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
      approvedInvite={approvedInvite}
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
