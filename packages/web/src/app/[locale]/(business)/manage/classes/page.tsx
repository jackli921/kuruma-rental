import { ClassList } from '@/modules/classes'
import { getTranslations } from 'next-intl/server'

export default async function ManageClassesPage() {
  const t = await getTranslations('business.classes')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">{t('subtitle')}</p>
      <ClassList />
    </div>
  )
}
