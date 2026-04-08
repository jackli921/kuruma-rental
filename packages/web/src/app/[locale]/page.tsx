import { useTranslations } from 'next-intl'

export default function Home() {
  const t = useTranslations('common')

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-6 py-32 px-16 bg-white dark:bg-black">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t('appName')}
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">{t('loading')}</p>
      </main>
    </div>
  )
}
