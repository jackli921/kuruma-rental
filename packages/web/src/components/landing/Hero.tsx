import { useTranslations } from 'next-intl'
import { SearchWidget } from './SearchWidget'

export function Hero() {
  const t = useTranslations('landing.hero')

  return (
    <section className="relative min-h-[85vh] flex items-center px-4 sm:px-6 lg:px-8">
      {/* Background image with overlay */}
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage:
            'url("https://images.unsplash.com/photo-1524413840807-0c3cb6fa808d?w=1920&q=80")',
        }}
      />
      <div className="absolute inset-0 -z-10 bg-black/40" />

      <div className="max-w-5xl mx-auto w-full pt-16">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1] max-w-3xl">
          {t('title')}
        </h1>

        <p className="mt-4 text-lg sm:text-xl text-white/80 max-w-xl">{t('subtitle')}</p>

        <SearchWidget />
      </div>
    </section>
  )
}
