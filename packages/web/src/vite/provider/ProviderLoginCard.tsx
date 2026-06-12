import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/vite/auth/GoogleIcon'
import { useTranslations } from 'use-intl'

interface ProviderLoginCardProps {
  /** A sanitised local path (the locale-scoped `/manage` landing) forwarded to
   *  the API. For provider intent the callback overrides it with the computed
   *  operator dashboard (§6), so it is only a fallback. */
  readonly returnTo: string
}

/** Provider sign-in screen (#521 §8). Same Google flow as the renter card, but
 *  carries `intent=provider` so the OAuth callback runs the operator-grant
 *  decision (existing membership or active invite) instead of the renter path.
 *  Intent alone never grants access — the API decides. A real form POST (not a
 *  fetch) so the browser follows Google's 302. */
export function ProviderLoginCard({ returnTo }: ProviderLoginCardProps) {
  const t = useTranslations('auth.provider')
  const action = `/auth/google/start?intent=provider&returnTo=${encodeURIComponent(returnTo)}`

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
            {t('continueAsProvider')}
          </Button>
        </form>
      </div>
    </main>
  )
}
