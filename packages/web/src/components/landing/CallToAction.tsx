import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function CallToAction() {
  const t = useTranslations('landing.cta')

  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto relative overflow-hidden rounded-3xl px-8 py-16 sm:px-16 sm:py-24">
        {/* Background image with overlay */}
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1920&q=80")',
          }}
        />
        <div className="absolute inset-0 -z-10 bg-black/60" />

        <div className="max-w-lg">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            {t('heading')}
          </h2>
          <p className="mt-4 text-lg text-white/80">{t('description')}</p>
          <div className="mt-8">
            <Link
              href="/vehicles"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'bg-white text-foreground hover:bg-white/90 rounded-xl px-8 h-12 text-base font-semibold',
              )}
            >
              {t('button')}
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
