import { getTranslations } from 'next-intl/server'

export default async function AdminHomePage() {
  const t = await getTranslations('admin')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('home.title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('home.subtitle')}</p>
    </div>
  )
}
