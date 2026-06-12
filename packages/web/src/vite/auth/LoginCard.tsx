import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/vite/auth/GoogleIcon'
import { useTranslations } from 'use-intl'

interface LoginCardProps {
  /** A sanitised local path to return to after sign-in (validated by the route
   *  via `safeReturnPath`). Forwarded to the API so the OAuth callback can land
   *  the user back where the guard intercepted them. */
  readonly returnTo?: string
}

/** The renter/operator sign-in screen for the Vite shell (#510). Google sign-in
 *  is a real form POST to `/auth/google/start` (same-origin behind the Pages
 *  proxy) so the browser follows the 302 to Google — a `fetch` cannot. */
export function LoginCard({ returnTo }: LoginCardProps) {
  const t = useTranslations('auth')
  const action = returnTo
    ? `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
    : '/auth/google/start'

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          {t('signInTitle')}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">{t('signInSubtitle')}</p>
        <form method="POST" action={action} className="mt-8">
          <Button type="submit" variant="outline" size="lg" className="w-full gap-3">
            <GoogleIcon className="size-5" />
            {t('continueWithGoogle')}
          </Button>
        </form>
      </div>
    </main>
  )
}
