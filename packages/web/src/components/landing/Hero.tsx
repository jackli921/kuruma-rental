import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { Calendar, MapPin, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

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

        <p className="mt-4 text-lg sm:text-xl text-white/80 max-w-xl">
          {t('subtitle')}
        </p>

        {/* Search widget -- Airbnb-style action bar */}
        <div className="mt-10 bg-white rounded-2xl shadow-xl p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-2xl">
          <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted/50 transition-colors">
            <MapPin className="size-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t('search.location')}</p>
              <p className="text-sm font-semibold text-foreground">{t('search.locationValue')}</p>
            </div>
          </div>

          <div className="hidden sm:block w-px h-8 bg-border" />

          <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-muted/50 transition-colors">
            <Calendar className="size-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t('search.dates')}</p>
              <p className="text-sm text-muted-foreground">{t('search.datesPlaceholder')}</p>
            </div>
          </div>

          <Link
            href="/vehicles"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-red-600 hover:bg-red-700 text-white rounded-xl px-6 h-12 text-base font-semibold shrink-0',
            )}
          >
            <Search className="size-4 mr-2" />
            {t('search.button')}
          </Link>
        </div>
      </div>
    </section>
  )
}
