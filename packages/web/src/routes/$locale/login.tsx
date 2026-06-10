import { LoginCard } from '@/vite/auth/LoginCard'
import { sessionQueryOptions } from '@/vite/session'
import { safeReturnPath } from '@kuruma/shared/lib/return-path'
import { createFileRoute, redirect } from '@tanstack/react-router'

// Public sign-in screen (#510). The renter/business guards redirect here with a
// `?returnTo=<intended path>`; after Google sign-in the OAuth callback lands the
// user back there. `returnTo` is sanitised to a local path at this boundary so
// the form action and the already-authenticated redirect never open-redirect.
export const Route = createFileRoute('/$locale/login')({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => {
    const returnTo = safeReturnPath(
      typeof search.returnTo === 'string' ? search.returnTo : undefined,
    )
    return returnTo ? { returnTo } : {}
  },
  beforeLoad: async ({ context, params, search }) => {
    // Already signed in? Skip the login screen and honour returnTo, falling back
    // to the locale home. The session fetch is held by the parent's skeleton.
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (session) {
      throw redirect({ href: search.returnTo ?? `/${params.locale}` })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { returnTo } = Route.useSearch()
  // exactOptionalPropertyTypes: omit the prop rather than pass `undefined`.
  return <LoginCard {...(returnTo !== undefined ? { returnTo } : {})} />
}
