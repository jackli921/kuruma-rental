import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  REVIEW_AUTHOR_ROLES,
  REVIEW_MODERATION_STATUSES,
  REVIEW_SUBJECTS,
} from '@kuruma/shared/enums'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin review moderation (#1086). Cookie-based (credentials:'include') so
// the API gates on the session role server-side (requirePlatformAdmin). The Vite
// shell owns this DTO — it never imports the api package's Review interface (the
// api↔web boundary). Non-strict: server-only fields on the wire are validated away.
// Enum domains anchor to the @kuruma/shared/enums SSoT so the parse can't drift.
const reportedReviewSchema = z.object({
  review: z.object({
    id: z.string(),
    subject: z.enum(REVIEW_SUBJECTS),
    authorRole: z.enum(REVIEW_AUTHOR_ROLES),
    overall: z.number(),
    comment: z.string().nullable(),
    moderationStatus: z.enum(REVIEW_MODERATION_STATUSES),
    submittedAt: z.string(),
  }),
  reportCount: z.number(),
  reasons: z.array(z.string()),
})
export type ReportedReviewDto = z.infer<typeof reportedReviewSchema>

// The moderation queue is partitioned (#1451): VISIBLE = unactioned (needs review),
// HIDDEN = already resolved. Anchored to the shared enum so the filter can't drift.
export type ModerationFilter = (typeof REVIEW_MODERATION_STATUSES)[number]

// Opaque keyset cursor echoed back to fetch the next page (recency instant + id tiebreak).
const cursorSchema = z.object({ lastReportedAt: z.string(), reviewId: z.string() })
export type ReportedCursor = z.infer<typeof cursorSchema>

// The server always sends nextCursor (null when the queue is exhausted) — modelled as a
// required, nullable field so a faithful response is validated, not silently defaulted.
const reportedReviewsResponseSchema = z.object({
  reported: z.array(reportedReviewSchema),
  nextCursor: cursorSchema.nullable(),
})

export interface ReportedReviewsPage {
  items: ReportedReviewDto[]
  nextCursor: ReportedCursor | null
}

export const ADMIN_REPORTED_REVIEWS_QUERY_KEY = ['admin-reported-reviews'] as const

export async function fetchReportedReviews(params: {
  status: ModerationFilter
  cursor?: ReportedCursor | null
}): Promise<ReportedReviewsPage> {
  const query = new URLSearchParams({ status: params.status })
  if (params.cursor) {
    query.set('cursorTs', params.cursor.lastReportedAt)
    query.set('cursorId', params.cursor.reviewId)
  }
  const { reported, nextCursor } = await unwrap(
    await fetch(`${getApiBaseUrl()}/admin/reviews/reported?${query}`, { credentials: 'include' }),
    reportedReviewsResponseSchema,
  )
  return { items: reported, nextCursor }
}

// Keyset-paginated queue (#1451). Each status partition is its own infinite query so the
// filter toggle swaps cleanly; the page param is the previous page's nextCursor (null =
// first page / no more pages).
export function reportedReviewsInfiniteQueryOptions(status: ModerationFilter) {
  return infiniteQueryOptions({
    queryKey: [...ADMIN_REPORTED_REVIEWS_QUERY_KEY, status],
    queryFn: ({ pageParam }) => fetchReportedReviews({ status, cursor: pageParam }),
    initialPageParam: null as ReportedCursor | null,
    getNextPageParam: (lastPage: ReportedReviewsPage) => lastPage.nextCursor,
  })
}

// Soft-hide a reported review (#1086). Cookie-authenticated + CSRF-gated; the server
// (requirePlatformAdmin) rejects a non-admin. The response is validated but discarded
// — the caller invalidates ADMIN_REPORTED_REVIEWS_QUERY_KEY (prefix-matches every status
// partition) to refetch the queue.
const hideResponseSchema = z.object({
  review: z.object({ id: z.string(), moderationStatus: z.enum(REVIEW_MODERATION_STATUSES) }),
})

export async function hideReview(params: { id: string; csrfToken: string }): Promise<void> {
  const { id, csrfToken } = params
  const res = await fetch(`${getApiBaseUrl()}/admin/reviews/${encodeURIComponent(id)}/hide`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  await unwrap(res, hideResponseSchema)
}
