// Public barrel for the operator-terms feature (#1110 module boundary): other
// vite features import from `@/vite/operator-terms`, never a deep file. Exposes
// the renter-facing published-terms read used by the reservation flow (#877).
export {
  fetchPublishedOperatorTerms,
  type PublishedOperatorTerms,
  publishedOperatorTermsQueryOptions,
  publishedOperatorTermsSchema,
} from './publishedApi'
