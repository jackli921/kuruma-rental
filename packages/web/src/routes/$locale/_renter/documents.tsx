import { isRenterDocumentsEnabled } from '@/vite/config/features'
import { DocumentUploadCard } from '@/vite/documents/DocumentUploadCard'
import { createFileRoute, redirect } from '@tanstack/react-router'

// Renter document upload (#459). Sits under `_renter`, so it inherits the
// session guard (redirect to login if signed out).
export const Route = createFileRoute('/$locale/_renter/documents')({
  // Post-MVP feature, hidden in the beta demo: the instant-book flow doesn't
  // gate on uploaded documents, so this page is orphaned. The nav link is
  // filtered out; this blocks a direct URL too, falling back to search.
  beforeLoad: ({ params }) => {
    if (!isRenterDocumentsEnabled()) {
      throw redirect({ to: '/$locale/search', params: { locale: params.locale } })
    }
  },
  component: DocumentsRoute,
})

function DocumentsRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <DocumentUploadCard />
    </main>
  )
}
