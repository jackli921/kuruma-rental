import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  onApprove: () => void | Promise<void>
  isApproving?: boolean
  approveError?: string | null
  /** When set, the card is in a terminal approved state: hide controls, show the invite link. */
  inviteUrl?: string | null
}

// Presentational review card (#1277): business details plus reject and approve
// controls. Owns only the draft rejection reason and clipboard-copied state;
// the route wires the mutations and passes callbacks. Keeping it router/query-free
// is what makes the approve/reject behaviour unit-testable in isolation.
//
// Terminal state: when `inviteUrl` is set the admin has just approved this row.
// We do NOT invalidate the pending query on approve (doing so would drop the row
// before the admin can copy the invite link). Instead the parent stores the invite
// and passes it down; the card renders a copyable reveal and hides the controls.
export function ApplicationReviewCard({
  application,
  onReject,
  isSubmitting = false,
  error = null,
  onApprove,
  isApproving = false,
  approveError = null,
  inviteUrl = null,
}: ApplicationReviewCardProps) {
  const t = useTranslations('admin.applications')
  const [rejectionReason, setRejectionReason] = useState('')
  const [copied, setCopied] = useState(false)

  const reasonId = `reason-${application.id}`
  const inviteInputId = `invite-url-${application.id}`
  const canReject = rejectionReason.trim() !== '' && !isSubmitting

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch {
      // Clipboard can reject on an insecure context or denied permission; the URL
      // stays visible in the readonly input as the fallback.
    }
  }

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

      {inviteUrl !== null ? (
        // Terminal approved state: show the one-time invite link for the admin to
        // copy and forward. The row stays visible until the admin refreshes.
        // <output> (implicit role=status) announces the newly-available invite link
        // to assistive tech, since the Approve control that had focus unmounts on success.
        <output className="block space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={inviteInputId}>{t('inviteReadyLabel')}</Label>
            <p className="text-sm text-muted-foreground">{t('inviteReadyHint')}</p>
            <Input
              id={inviteInputId}
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void handleCopy()}>
              {copied ? t('copied') : t('copy')}
            </Button>
            <span className="text-sm font-medium text-green-700">{t('approved')}</span>
          </div>
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
