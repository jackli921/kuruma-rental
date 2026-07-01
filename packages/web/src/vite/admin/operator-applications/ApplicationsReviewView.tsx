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
}

// Pure presentation of the platform-admin operator-application review queue
// (#1277): the title block plus either the empty state or one
// ApplicationReviewCard per pending application. All data + the reject mutation
// live in the route; this stays render-only so the list/empty behaviour is
// unit-testable without a router or query client.
export function ApplicationsReviewView({
  applications,
  onReject,
  submittingId = null,
  errorId = null,
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
          {applications.map((app) => (
            <li key={app.id}>
              <ApplicationReviewCard
                application={app}
                onReject={(reason) => onReject(app.id, reason)}
                isSubmitting={submittingId === app.id}
                error={errorId === app.id ? t('error') : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
