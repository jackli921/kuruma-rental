import { useState } from 'react'
import { useTranslations } from 'use-intl'
import type { OperatorApplicationDto } from './api'

// The submit path already rejects non-http(s) website schemes, but re-check at the
// render seam before turning the value into an admin-clicked link: a stored
// javascript:/data: URL must never reach an href regardless of how the row landed
// in the DB. A failing check degrades to plain text, not a broken queue load.
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

interface ApplicationReviewCardProps {
  application: OperatorApplicationDto
  onReject: (reason: string) => void | Promise<void>
  isSubmitting?: boolean
  error?: string | null
}

// Presentational review card (#1277): business details plus a reject control.
// It owns only the draft rejection reason; the route wires the query + mutation
// and passes `onReject`. Keeping it router/query-free is what makes the
// reject behaviour unit-testable in isolation.
export function ApplicationReviewCard({
  application,
  onReject,
  isSubmitting = false,
  error = null,
}: ApplicationReviewCardProps) {
  const t = useTranslations('admin.applications')
  const [rejectionReason, setRejectionReason] = useState('')

  const reasonId = `reason-${application.id}`
  const canReject = rejectionReason.trim() !== '' && !isSubmitting

  return (
    <article className="space-y-4 rounded-lg border border-border p-4">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">{application.businessName}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('contactLabel')}</dt>
          <dd className="font-medium">{application.contactName}</dd>
          <dt className="text-muted-foreground">{t('emailLabel')}</dt>
          <dd>{application.contactEmail}</dd>
          <dt className="text-muted-foreground">{t('phoneLabel')}</dt>
          <dd>{application.contactPhone}</dd>
          <dt className="text-muted-foreground">{t('serviceAreaLabel')}</dt>
          <dd>{application.serviceArea}</dd>
          <dt className="text-muted-foreground">{t('fleetSizeLabel')}</dt>
          <dd>{application.estimatedFleetSize}</dd>
          {application.businessType !== null ? (
            <>
              <dt className="text-muted-foreground">{t('businessTypeLabel')}</dt>
              <dd>{application.businessType}</dd>
            </>
          ) : null}
          {application.website !== null ? (
            <>
              <dt className="text-muted-foreground">{t('websiteLabel')}</dt>
              <dd>
                {isHttpUrl(application.website) ? (
                  <a
                    href={application.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {application.website}
                  </a>
                ) : (
                  application.website
                )}
              </dd>
            </>
          ) : null}
          {application.message !== null ? (
            <>
              <dt className="text-muted-foreground">{t('messageLabel')}</dt>
              <dd>{application.message}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t('submittedLabel')}</dt>
          <dd>{application.createdAt.slice(0, 10)}</dd>
        </dl>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={reasonId} className="block text-sm font-medium">
          {t('reasonLabel')}
        </label>
        <div className="flex gap-2">
          <textarea
            id={reasonId}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            rows={3}
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!canReject}
            onClick={() => canReject && void onReject(rejectionReason.trim())}
            className="self-start rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('reject')}
          </button>
        </div>
      </div>
    </article>
  )
}
