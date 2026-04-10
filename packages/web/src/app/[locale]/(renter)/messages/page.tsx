import { MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function MessagesPage() {
  const t = useTranslations('messaging.threadList')

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

        <div className="mt-16 text-center">
          <MessageSquare className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      </div>
    </main>
  )
}
