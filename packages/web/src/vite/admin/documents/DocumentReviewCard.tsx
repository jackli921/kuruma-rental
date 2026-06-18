import { DocumentStatusBadge } from '@/vite/documents/DocumentStatusBadge'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { type AdminDocumentDto, documentFileUrl } from './api'

export type DocumentVerdict =
  | { status: 'APPROVED'; expiryDate: string }
  | { status: 'REJECTED'; rejectionReason: string }

interface DocumentReviewCardProps {
  document: AdminDocumentDto
  onSubmit: (verdict: DocumentVerdict) => void | Promise<void>
  isSubmitting?: boolean
  error?: string | null
}

// Presentational review row (#932): the scan viewer plus an approve (expiry) and
// reject (reason) control. It owns only the draft inputs; the route wires the
// query + verify mutation and passes `onSubmit`. Keeping it router/query-free is
// what makes the approve/reject behaviour unit-testable in isolation.
export function DocumentReviewCard({
  document,
  onSubmit,
  isSubmitting = false,
  error = null,
}: DocumentReviewCardProps) {
  const t = useTranslations('admin.documents')
  const [expiryDate, setExpiryDate] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)

  const fileUrl = documentFileUrl(document.id)
  const expiryId = `expiry-${document.id}`
  const reasonId = `reason-${document.id}`
  const canApprove = expiryDate !== '' && !isSubmitting
  const canReject = rejectionReason.trim() !== '' && !isSubmitting

  return (
    <article className="space-y-4 rounded-lg border border-border p-4">
      <header className="flex items-start justify-between gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('renterLabel')}</dt>
          <dd className="font-medium">{document.renterId}</dd>
          <dt className="text-muted-foreground">{t('uploadedLabel')}</dt>
          <dd>{document.createdAt.slice(0, 10)}</dd>
        </dl>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{document.type}</span>
          <DocumentStatusBadge status={document.status} />
        </div>
      </header>

      <div className="rounded-md border border-border bg-muted/30 p-2">
        {previewFailed ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('viewerFallback')}</p>
        ) : (
          <img
            src={fileUrl}
            alt={t('viewerAlt')}
            onError={() => setPreviewFailed(true)}
            className="mx-auto max-h-80 w-auto rounded"
          />
        )}
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-primary underline"
        >
          {t('viewerOpen')}
        </a>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={expiryId} className="block text-sm font-medium">
            {t('expiryLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id={expiryId}
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!canApprove}
              onClick={() => canApprove && void onSubmit({ status: 'APPROVED', expiryDate })}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('approve')}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor={reasonId} className="block text-sm font-medium">
            {t('reasonLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id={reasonId}
              type="text"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!canReject}
              onClick={() =>
                canReject &&
                void onSubmit({ status: 'REJECTED', rejectionReason: rejectionReason.trim() })
              }
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('reject')}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
