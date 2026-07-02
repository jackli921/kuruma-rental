import { useTranslations } from 'use-intl'

interface RegistrationSuccessProps {
  email: string
}

// Shown after a successful operator application submission (#1277 §2.4).
// Purely presentational - no network calls, no mutation state.
export function RegistrationSuccess({ email }: RegistrationSuccessProps) {
  const t = useTranslations('business.register.success')
  return (
    <output className="block rounded-lg border bg-card p-8 text-center space-y-2">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body', { email })}</p>
    </output>
  )
}
