import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { DocumentUploadCard } from '@/vite/documents/DocumentUploadCard'
import { createFileRoute, redirect } from '@tanstack/react-router'

// Renter document upload (#459). Sits under `_renter`, so it inherits the
// session guard (redirect to login if signed out).
export const Route = createFileRoute('/$locale/_renter/documents')({
  // Post-MVP feature, hidden in the beta demo: the instant-book flow doesn't
  // gate on uploaded documents, so this page is orphaned. The nav link is
  // filtered out; this blocks a direct URL too, falling back to search.
  // Reads the runtime-toggleable flag (#1322): a dashboard override opens/closes
  // the route live. resolveFeatureFlag = override ?? build-time env ?? false.
  beforeLoad: async ({ context, params }) => {
    // fetchQuery (not ensureQueryData) so a hard load honors a switchboard override,
    // not the seeded build-time default (#1486); fetchFeatureFlagOverrides is fail-safe.
    const overrides = await context.queryClient.fetchQuery(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'RENTER_DOCUMENTS')) {
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
