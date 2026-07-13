import type {
  OperatorApplicationBusinessType,
  OperatorApplicationFleetSize,
} from '@kuruma/shared/enums'
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

// Enum values are storage codes ("6-20", "INDIVIDUAL"), never display text — map
// each to its localized message key so the admin sees a proper label per locale.
// A Record keyed by the enum makes a new enum member a compile error here, not a
// raw code leaking to the UI.
const FLEET_SIZE_LABEL_KEYS: Record<OperatorApplicationFleetSize, string> = {
  '1-5': 'fleetSize.1-5',
  '6-20': 'fleetSize.6-20',
  '21-50': 'fleetSize.21-50',
  '50+': 'fleetSize.50+',
}

const BUSINESS_TYPE_LABEL_KEYS: Record<OperatorApplicationBusinessType, string> = {
  INDIVIDUAL: 'businessType.INDIVIDUAL',
  COMPANY: 'businessType.COMPANY',
}

interface ApplicationReviewCardProps {
  application: OperatorApplicationDto
  onReject: (reason: string) => void | Promise<void>
  isSubmitting?: boolean
  error?: string | null
  onApprove: () => void | Promise<void>
  isApproving?: boolean
  approveError?: string | null
  /** When true, the card is in a terminal approved state: hide controls, show plain confirmation. */
  approved?: boolean
}

// Presentational review card (#1277): business details plus reject and approve
// controls. Owns only the draft rejection reason; the route wires the mutations
// and passes callbacks. Keeping it router/query-free is what makes the
// approve/reject behaviour unit-testable in isolation.
//
// Terminal state: when `approved` is true the admin has just approved this row.
// We do NOT invalidate the pending query on approve (doing so would drop the row
// before the admin sees the confirmation). The card renders a plain "Approved"
// message and hides the controls until the admin refreshes.
export function ApplicationReviewCard({
  application,
  onReject,
  isSubmitting = false,
  error = null,
  onApprove,
  isApproving = false,
  approveError = null,
  approved = false,
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
          <dd>{t(FLEET_SIZE_LABEL_KEYS[application.estimatedFleetSize])}</dd>
          {application.businessType !== null ? (
            <>
              <dt className="text-muted-foreground">{t('businessTypeLabel')}</dt>
              <dd>{t(BUSINESS_TYPE_LABEL_KEYS[application.businessType])}</dd>
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

      {approved ? (
        // Terminal approved state: the applicant's account was promoted directly to
        // OPERATOR_OWNER. No invite link is issued. The <output> (implicit role=status)
        // announces the confirmation to assistive tech since the Approve button that
        // had focus unmounts on success.
        <output className="block">
          <span className="text-sm font-medium text-green-700">{t('approved')}</span>
        </output>
      ) : (
        // Normal state: show approve/reject controls.
        <>
          {approveError ? (
            <p role="alert" className="text-sm text-destructive">
              {approveError}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isApproving}
              onClick={() => void onApprove()}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isApproving ? t('approving') : t('approve')}
            </button>
          </div>

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
        </>
      )}
    </article>
  )
}
