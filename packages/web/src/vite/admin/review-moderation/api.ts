import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  REVIEW_AUTHOR_ROLES,
  REVIEW_MODERATION_STATUSES,
  REVIEW_SUBJECTS,
} from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
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

const reportedReviewsResponseSchema = z.object({ reported: z.array(reportedReviewSchema) })

export const ADMIN_REPORTED_REVIEWS_QUERY_KEY = ['admin-reported-reviews'] as const

export async function fetchReportedReviews(): Promise<ReportedReviewDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/admin/reviews/reported`, { credentials: 'include' })
  return (await unwrap(res, reportedReviewsResponseSchema)).reported
}

export function reportedReviewsQueryOptions() {
  return queryOptions({
    queryKey: ADMIN_REPORTED_REVIEWS_QUERY_KEY,
    queryFn: fetchReportedReviews,
  })
}

// Soft-hide a reported review (#1086). Cookie-authenticated + CSRF-gated; the server
// (requirePlatformAdmin) rejects a non-admin. The response is validated but discarded
// — the caller invalidates ADMIN_REPORTED_REVIEWS_QUERY_KEY to refetch the queue.
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
