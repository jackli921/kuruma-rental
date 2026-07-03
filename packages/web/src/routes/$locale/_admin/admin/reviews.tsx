import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { ReviewModerationView, reportedReviewsQueryOptions } from '@/vite/admin/review-moderation'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin review moderation queue (#1086, #1067 slice 6). The `_admin`
// parent layout already gates on platform-admin membership, so this owns only the
// data: prefetch the reported-reviews queue, then render the table with per-row
// hide actions. Discoverability is flag-gated in AdminSidebar (REVIEWS); the
// endpoint stays platform-admin-only server-side (requirePlatformAdmin).
export const Route = createFileRoute('/$locale/_admin/admin/reviews')({
  loader: ({ context }) => context.queryClient.ensureQueryData(reportedReviewsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: ReviewModerationError,
  component: ReviewModerationRoute,
})

function ReviewModerationRoute() {
  const { data, isPending } = useQuery(reportedReviewsQueryOptions())

  if (!data) return isPending ? <PageSkeleton /> : null
  return <ReviewModerationView reported={data} />
}

function ReviewModerationError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.reviewModeration')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8"
    />
  )
}
