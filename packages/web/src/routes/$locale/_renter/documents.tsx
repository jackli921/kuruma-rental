import { DocumentUploadCard } from '@/vite/documents/DocumentUploadCard'
import { createFileRoute } from '@tanstack/react-router'

// Renter document upload (#459). Sits under `_renter`, so it inherits the
// session guard (redirect to login if signed out) without its own beforeLoad.
export const Route = createFileRoute('/$locale/_renter/documents')({
  component: DocumentsRoute,
})

function DocumentsRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <DocumentUploadCard />
    </main>
  )
}
