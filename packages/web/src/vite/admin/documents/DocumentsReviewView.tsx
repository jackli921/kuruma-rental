import { useTranslations } from 'use-intl'
import { DocumentReviewCard, type DocumentVerdict } from './DocumentReviewCard'
import type { AdminDocumentDto } from './api'

interface DocumentsReviewViewProps {
  documents: AdminDocumentDto[]
  onVerify: (id: string, verdict: DocumentVerdict) => void | Promise<void>
  /** Id of the row whose verdict is in flight, if any. */
  submittingId?: string | null
  /** Id of the row whose last verdict failed, if any. */
  errorId?: string | null
}

// Pure presentation of the platform-admin review queue (#932): the title block
// plus either the empty state or one DocumentReviewCard per pending document. All
// data + the verify mutation live in the route; this stays render-only so the
// list/empty behaviour is unit-testable without a router or query client.
export function DocumentsReviewView({
  documents,
  onVerify,
  submittingId = null,
  errorId = null,
}: DocumentsReviewViewProps) {
  const t = useTranslations('admin.documents')

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {documents.map((document) => (
            <li key={document.id}>
              <DocumentReviewCard
                document={document}
                onSubmit={(verdict) => onVerify(document.id, verdict)}
                isSubmitting={submittingId === document.id}
                error={errorId === document.id ? t('error') : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
