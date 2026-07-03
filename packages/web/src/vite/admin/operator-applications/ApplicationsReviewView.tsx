import { useTranslations } from 'use-intl'
import { ApplicationReviewCard } from './ApplicationReviewCard'
import type { OperatorApplicationDto } from './api'

interface ApplicationsReviewViewProps {
  applications: OperatorApplicationDto[]
  onReject: (id: string, reason: string) => void | Promise<void>
  /** Id of the row whose rejection is in flight, if any. */
  submittingId?: string | null
  /** Id of the row whose last rejection failed, if any. */
  errorId?: string | null
  onApprove: (id: string) => void | Promise<void>
  /** Id of the row whose approval is in flight, if any. */
  approvingId?: string | null
  /**
   * The row whose last approval failed, plus whether it was a 409 (already
   * reviewed / email-in-use) vs a generic retryable failure — so the card can
   * show the right message instead of silently swallowing non-409 errors.
   */
  approveError?: { id: string | null; alreadyReviewed: boolean } | null
  /**
   * Invite links revealed after successful approvals, keyed by application id.
   * Keyed (not a single row) so approving a second application never drops the
   * first one's still-uncopied invite link. A card enters its terminal reveal
   * state when its id is present here.
   */
  approvedInvites?: Record<string, string>
  /** Re-mint the OWNER invite for a revealed row (#1370). */
  onRemint?: (id: string) => void | Promise<void>
  /** Id of the row whose re-mint is in flight, if any. */
  remintingId?: string | null
  /** Id of the row whose last re-mint failed, if any. */
  remintErrorId?: string | null
}

// Pure presentation of the platform-admin operator-application review queue
// (#1277): the title block plus either the empty state or one
// ApplicationReviewCard per pending application. All data + the reject/approve
// mutations live in the route; this stays render-only so the list/empty behaviour
// is unit-testable without a router or query client.
export function ApplicationsReviewView({
  applications,
  onReject,
  submittingId = null,
  errorId = null,
  onApprove,
  approvingId = null,
  approveError = null,
  approvedInvites = {},
  onRemint,
  remintingId = null,
  remintErrorId = null,
}: ApplicationsReviewViewProps) {
  const t = useTranslations('admin.applications')

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>

      {applications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {applications.map((app) => {
            const approveErrorKey = approveError?.alreadyReviewed
              ? 'alreadyReviewed'
              : 'approveFailed'
            const approveErrorText = approveError?.id === app.id ? t(approveErrorKey) : null
            return (
              <li key={app.id}>
                <ApplicationReviewCard
                  application={app}
                  onReject={(reason) => onReject(app.id, reason)}
                  isSubmitting={submittingId === app.id}
                  error={errorId === app.id ? t('error') : null}
                  onApprove={() => onApprove(app.id)}
                  isApproving={approvingId === app.id}
                  approveError={approveErrorText}
                  inviteUrl={approvedInvites[app.id] ?? null}
                  // exactOptionalPropertyTypes: omit onRemint entirely rather than
                  // passing undefined when no remint handler is wired.
                  {...(onRemint ? { onRemint: () => onRemint(app.id) } : {})}
                  isReminting={remintingId === app.id}
                  remintError={remintErrorId === app.id ? t('regenerateFailed') : null}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
