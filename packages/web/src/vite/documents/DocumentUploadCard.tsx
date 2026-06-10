import { DocumentStatusBadge } from '@/vite/documents/DocumentStatusBadge'
import { type DocumentType, myDocumentsQueryOptions, uploadDocument } from '@/vite/documents/api'
import { useSession } from '@/vite/session'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

const DOCUMENT_TYPES: ReadonlyArray<{ value: DocumentType; labelKey: string }> = [
  { value: 'IDP', labelKey: 'typeIdp' },
  { value: 'PASSPORT', labelKey: 'typePassport' },
]

/**
 * Renter document upload + status list (#459). First mutation in the Vite shell:
 * a cookie-authenticated, CSRF-gated multipart POST. The session (and its CSRF
 * token) come from the `_renter` guard's already-loaded session query.
 */
export function DocumentUploadCard() {
  const t = useTranslations('documents')
  const session = useSession()
  const documents = useQuery(myDocumentsQueryOptions())
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<DocumentType>('IDP')
  const [file, setFile] = useState<File | null>(null)

  const csrfToken = session.data?.csrfToken

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !csrfToken) {
        throw new Error('Missing file or CSRF token')
      }
      return uploadDocument({ type, file, csrfToken })
    },
    onSuccess: async () => {
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await queryClient.invalidateQueries({ queryKey: ['documents', 'me'] })
    },
  })

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    mutation.mutate()
  }

  const typeLabelKey = (docType: DocumentType): string =>
    docType === 'IDP' ? 'typeIdp' : 'typePassport'

  return (
    <section className="rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="doc-type" className="block text-sm font-medium">
            {t('typeLabel')}
          </label>
          <select
            id="doc-type"
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className="block w-full rounded-md border px-3 py-2 text-sm"
          >
            {DOCUMENT_TYPES.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="doc-file" className="block text-sm font-medium">
            {t('fileLabel')}
          </label>
          <input
            id="doc-file"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={!file || mutation.isPending}
          className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? t('uploading') : t('uploadButton')}
        </button>

        {mutation.isError && (
          <p role="alert" className="text-sm text-red-600">
            {t('uploadError')}
          </p>
        )}
      </form>

      <div className="mt-8 border-t pt-6">
        {documents.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : documents.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-3">
            {documents.data?.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t(typeLabelKey(doc.type))}</p>
                  {doc.expiryDate && (
                    <p className="text-xs text-muted-foreground">
                      {t('expiresOn', { date: doc.expiryDate })}
                    </p>
                  )}
                </div>
                <DocumentStatusBadge status={doc.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
