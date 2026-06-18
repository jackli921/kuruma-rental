import { PageSkeleton } from '@/vite/PageSkeleton'
import { DocumentsReviewView } from '@/vite/admin/documents/DocumentsReviewView'
import {
  ADMIN_DOCUMENTS_QUERY_KEY,
  pendingDocumentsQueryOptions,
  verifyDocument,
} from '@/vite/admin/documents/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin renter-document review (#932). The `_admin` parent layout already
// gates on platform-admin membership, so this only owns the data: prefetch the
// pending queue in the loader, render the pure DocumentsReviewView, and wire its
// approve/reject callbacks to the verify mutation (CSRF token from the session).
export const Route = createFileRoute('/$locale/_admin/admin/documents')({
  loader: ({ context }) => context.queryClient.ensureQueryData(pendingDocumentsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: DocumentsError,
  component: DocumentsRoute,
})

function DocumentsRoute() {
  const { data } = useSuspenseQuery(pendingDocumentsQueryOptions())
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const mutation = useMutation({
    mutationFn: verifyDocument,
    // A recorded verdict leaves the PENDING queue, so refetch to drop the row.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DOCUMENTS_QUERY_KEY }),
  })

  return (
    <DocumentsReviewView
      documents={data}
      submittingId={mutation.isPending ? (mutation.variables?.id ?? null) : null}
      errorId={mutation.isError ? (mutation.variables?.id ?? null) : null}
      onVerify={(id, verdict) => mutation.mutate({ id, csrfToken, ...verdict })}
    />
  )
}

function DocumentsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.documents')
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
