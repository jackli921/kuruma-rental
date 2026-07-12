import { sessionQueryOptions } from '@/vite/session'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Welcome landing for operator applicants whose account was just promoted
// server-side from RENTER → OPERATOR_OWNER. The cached ['session'] query still
// holds a stale RENTER session, so we invalidate first to force a re-fetch from
// GET /auth/session, which re-mints the session with the new role and operatorSlug.
// If the fresh session carries operatorSlug the applicant is approved → redirect
// into the operator portal. Otherwise they're still pending → render a holding page.
export const Route = createFileRoute('/$locale/operator/welcome')({
  beforeLoad: async ({ context, params }) => {
    // Invalidate before ensureQueryData so the next read hits the server, not
    // the stale RENTER cache. Without this, a returning approved operator would
    // see the pending page until their next hard reload.
    await context.queryClient.invalidateQueries({ queryKey: ['session'] })
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (session?.user.operatorSlug) {
      throw redirect({ to: '/$locale/dashboard', params: { locale: params.locale } })
    }
    // Still pending — fall through to the holding component below.
  },
  component: OperatorWelcomePending,
})

function OperatorWelcomePending() {
  const t = useTranslations('operator.welcome')

  return (
    <main className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-4 text-muted-foreground">{t('body')}</p>
        <p className="mt-6 text-sm text-muted-foreground">{t('hint')}</p>
      </div>
    </main>
  )
}
