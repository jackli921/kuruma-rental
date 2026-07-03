import { ApiError } from '@/lib/api-error'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { ApplicationsReviewView } from '@/vite/admin/operator-applications/ApplicationsReviewView'
import {
  ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
  approveApplication,
  pendingOperatorApplicationsQueryOptions,
  rejectOperatorApplication,
  remintInvite,
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
// invite link. Instead we accumulate invite links keyed by application id and
// pass them down; each matching card enters a terminal "approved + invite reveal"
// state. Keyed (not a single row) so approving a second application never drops
// the first one's still-uncopied invite. The admin refreshes to clear resolved rows.
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
  const [approvedInvites, setApprovedInvites] = useState<Record<string, string>>({})

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
    onSuccess: (result, vars) =>
      setApprovedInvites((prev) => ({ ...prev, [vars.id]: result.inviteUrl })),
  })

  const remintMutation = useMutation({
    mutationFn: remintInvite,
    // Replace the revealed link with the freshly-minted one in place.
    onSuccess: (result, vars) =>
      setApprovedInvites((prev) => ({ ...prev, [vars.id]: result.inviteUrl })),
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
      approvedInvites={approvedInvites}
      onRemint={(id) => remintMutation.mutate({ id, csrfToken })}
      remintingId={remintMutation.isPending ? (remintMutation.variables?.id ?? null) : null}
      remintError={
        remintMutation.isError
          ? {
              id: remintMutation.variables?.id ?? null,
              // 404 (unknown / not approved) and 409 (owner already onboarded) are
              // terminal: a retry can't succeed, so show "no longer available"
              // instead of "try again". Anything else is a retryable failure.
              terminal:
                remintMutation.error instanceof ApiError &&
                (remintMutation.error.status === 404 || remintMutation.error.status === 409),
            }
          : null
      }
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
