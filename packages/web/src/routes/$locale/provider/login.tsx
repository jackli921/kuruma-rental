import { ProviderLoginCard } from '@/vite/provider/ProviderLoginCard'
import { sessionQueryOptions } from '@/vite/session'
import { createFileRoute, redirect } from '@tanstack/react-router'

// Provider sign-in entry (#521 §8). Public — uninvited/renter accounts can reach
// it, but the OAuth callback (intent=provider) decides access from the database,
// never from this UI. An operator who is already signed in skips the door and
// lands on their own dashboard.
export const Route = createFileRoute('/$locale/provider/login')({
  beforeLoad: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (session?.user.operatorSlug) {
      throw redirect({
        to: '/$locale/manage/$operatorSlug/dashboard',
        params: { locale: params.locale, operatorSlug: session.user.operatorSlug },
      })
    }
  },
  component: ProviderLoginPage,
})

function ProviderLoginPage() {
  const { locale } = Route.useParams()
  return <ProviderLoginCard returnTo={`/${locale}/manage`} />
}
