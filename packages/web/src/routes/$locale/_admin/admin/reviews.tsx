import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import {
  type ModerationFilter,
  ReviewModerationView,
  reportedReviewsInfiniteQueryOptions,
} from '@/vite/admin/review-moderation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Platform-admin review moderation queue (#1086, #1067 slice 6; paginated #1451). The
// `_admin` parent layout already gates on platform-admin membership, so this owns only
// the data: prefetch the unactioned queue, then drive the keyset infinite query + the
// VISIBLE/HIDDEN filter, handing a flat page list to the presentational view.
// Discoverability is flag-gated in AdminSidebar (REVIEWS); the endpoint stays
// platform-admin-only server-side (requirePlatformAdmin).
export const Route = createFileRoute('/$locale/_admin/admin/reviews')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(reportedReviewsInfiniteQueryOptions('VISIBLE')),
  pendingComponent: PageSkeleton,
  errorComponent: ReviewModerationError,
  component: ReviewModerationRoute,
})

function ReviewModerationRoute() {
  const [status, setStatus] = useState<ModerationFilter>('VISIBLE')
  const { data, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
    reportedReviewsInfiniteQueryOptions(status),
  )

  if (!data) return isPending ? <PageSkeleton /> : null
  const items = data.pages.flatMap((page) => page.items)
  return (
    <ReviewModerationView
      items={items}
      status={status}
      onStatusChange={setStatus}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={() => fetchNextPage()}
    />
  )
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
