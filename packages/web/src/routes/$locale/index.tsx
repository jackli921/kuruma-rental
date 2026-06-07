import { createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Landing placeholder proving use-intl renders inside the locale layout.
// The full landing port (current marketplace `[locale]/page.tsx`) lands in 5d.
export const Route = createFileRoute('/$locale/')({
  component: LandingPlaceholder,
})

function LandingPlaceholder() {
  const t = useTranslations('common')
  return (
    <main>
      <h1>{t('appName')}</h1>
    </main>
  )
}
