import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/vite/auth/GoogleIcon'
import type { InvitePreviewData } from '@/vite/provider/api'
import { useTranslations } from 'use-intl'

interface ProviderInviteCardProps {
  readonly preview: InvitePreviewData
  /** The one-time invite token, threaded into the OAuth start so the callback
   *  can match it against the invited email and grant operator access. */
  readonly token: string
  /** Locale-scoped `/manage` fallback landing (the callback overrides it with the
   *  computed operator dashboard on success — §6). */
  readonly returnTo: string
}

/** Invite acceptance screen (#521 §8). For a live invite it names the inviting
 *  operator and offers Google sign-in carrying `intent=provider&invite=<token>`;
 *  the API verifies the invited email server-side, so the page never sees it.
 *  An expired/used/unknown invite renders an unavailable state with no CTA. */
export function ProviderInviteCard({ preview, token, returnTo }: ProviderInviteCardProps) {
  const t = useTranslations('auth.provider')

  if (!preview.valid) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('invite.expiredTitle')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('invite.expiredBody')}</p>
        </div>
      </main>
    )
  }

  const action =
    `/auth/google/start?intent=provider&invite=${encodeURIComponent(token)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          {t('invite.title', { operator: preview.operatorName ?? '' })}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">{t('invite.subtitle')}</p>
        <form method="POST" action={action} className="mt-8">
          <Button type="submit" variant="outline" size="lg" className="w-full gap-3">
            <GoogleIcon className="size-5" />
            {t('invite.continue')}
          </Button>
        </form>
      </div>
    </main>
  )
}
