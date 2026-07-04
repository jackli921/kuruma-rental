// Platform-admin review moderation (#1086, #1067 slice 6; paginated #1451). Consumed
// through this barrel by the admin route — see docs/architecture/modules.md.
export { ReviewModerationView } from './ReviewModerationView'
export {
  type ModerationFilter,
  type ReportedReviewDto,
  reportedReviewsInfiniteQueryOptions,
} from './api'
