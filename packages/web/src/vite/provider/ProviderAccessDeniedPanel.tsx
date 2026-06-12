import { buttonVariants } from '@/components/ui/button'
import { useTranslations } from 'use-intl'

/** The two server-controlled outcomes the OAuth callback can bounce a failed
 *  provider sign-in to (`auth.ts` §6). Mirrors `OperatorGrantResult`'s reject
 *  discriminants; kept as a string union so the route's `validateSearch` and
 *  this panel agree on the contract. */
export type ProviderAccessError = 'access_not_found' | 'invite_invalid'

/** MVP placeholder. The real "request access" form is a §13 follow-up; until
 *  then the not-authorized state offers a plain mailto so a stranded operator
 *  has a way to reach a human. */
const PROVIDER_SUPPORT_EMAIL = 'operators@kuruma-rental.example'

interface ProviderAccessDeniedPanelProps {
  readonly error: ProviderAccessError
}

/** Shown on `provider/login?error=…` when the callback denied operator access
 *  (#521 §8). The failed provider attempt minted NO session (`auth.ts:197`), so
 *  there is nothing to sign out of — the only action is to request access. */
export function ProviderAccessDeniedPanel({ error }: ProviderAccessDeniedPanelProps) {
  const t = useTranslations('auth.provider')
  const title = error === 'access_not_found' ? t('accessNotFoundTitle') : t('inviteInvalidTitle')
  const body = error === 'access_not_found' ? t('accessNotFoundBody') : t('inviteInvalidBody')

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <a
          href={`mailto:${PROVIDER_SUPPORT_EMAIL}`}
          className={buttonVariants({ variant: 'outline', size: 'lg', className: 'mt-8 w-full' })}
        >
          {t('requestAccess')}
        </a>
      </div>
    </main>
  )
}
