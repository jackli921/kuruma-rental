import { useTranslations } from 'next-intl'

export default function CallbackPage() {
  const t = useTranslations('common')

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-800" />
      <p className="text-sm text-zinc-600">{t('loading')}</p>
    </div>
  )
}
