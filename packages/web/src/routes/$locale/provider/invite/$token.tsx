import { ProviderInviteCard } from '@/vite/provider/ProviderInviteCard'
import { fetchInvitePreview } from '@/vite/provider/api'
import { createFileRoute } from '@tanstack/react-router'

// Invite acceptance page (#521 §8). Public — the recipient has no session yet.
// The loader fetches the hash-keyed preview (operator name + validity, never the
// email); the card threads the token into Google sign-in for server-side accept.
export const Route = createFileRoute('/$locale/provider/invite/$token')({
  loader: ({ params }) => fetchInvitePreview(params.token),
  component: ProviderInvitePage,
})

function ProviderInvitePage() {
  const preview = Route.useLoaderData()
  const { locale, token } = Route.useParams()
  return <ProviderInviteCard preview={preview} token={token} returnTo={`/${locale}/manage`} />
}
