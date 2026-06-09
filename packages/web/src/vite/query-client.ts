import { QueryClient } from '@tanstack/react-query'

// Single client shared by the router (loader context) and the React tree
// (QueryClientProvider in __root). Loaders prefetch via ensureQueryData; the
// matching useQuery in components serves the cached result (spec §4.4).
export const queryClient = new QueryClient()
