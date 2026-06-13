import {
  ProviderAccessDeniedPanel,
  type ProviderAccessError,
} from '@/vite/provider/ProviderAccessDeniedPanel'
import { ProviderLoginCard } from '@/vite/provider/ProviderLoginCard'
import { sessionQueryOptions } from '@/vite/session'
import { createFileRoute, redirect } from '@tanstack/react-router'

const PROVIDER_ACCESS_ERRORS = ['access_not_found', 'invite_invalid'] as const

// The callback only ever appends one of these two literals (§6). Anything else
// is a tampered/stale URL — drop it so the page falls back to the sign-in card.
function parseAccessError(value: unknown): ProviderAccessError | undefined {
  return (PROVIDER_ACCESS_ERRORS as readonly string[]).includes(value as string)
    ? (value as ProviderAccessError)
    : undefined
}

// Provider sign-in entry (#521 §8). Public — uninvited/renter accounts can reach
// it, but the OAuth callback (intent=provider) decides access from the database,
// never from this UI. An operator who is already signed in skips the door and
// lands on their own dashboard.
export const Route = createFileRoute('/$locale/provider/login')({
  validateSearch: (search: Record<string, unknown>): { error?: ProviderAccessError } => {
    const error = parseAccessError(search.error)
    return error ? { error } : {}
  },
  beforeLoad: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (session?.user.operatorSlug) {
      throw redirect({ to: '/$locale/dashboard', params: { locale: params.locale } })
    }
  },
  component: ProviderLoginPage,
})

function ProviderLoginPage() {
  const { locale } = Route.useParams()
  const { error } = Route.useSearch()

  // A denied provider attempt arrives signed-out (no session minted), so the
  // not-authorized panel replaces the sign-in card rather than sitting beside it.
  if (error) return <ProviderAccessDeniedPanel error={error} />
  return <ProviderLoginCard returnTo={`/${locale}/dashboard`} />
}
