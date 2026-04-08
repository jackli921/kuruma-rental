import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function CallToAction() {
  const t = useTranslations('landing.cta')

  return (
    <section className="py-24 sm:py-32 px-4">
      <div
        className="max-w-3xl mx-auto text-center rounded-2xl p-12 sm:p-16 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%)',
        }}
      >
        {/* Subtle red glow */}
        <div
          className="absolute top-0 right-0 w-64 h-64 -z-0 opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #dc2626, transparent)' }}
        />

        <h2 className="relative text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          {t('heading')}
        </h2>
        <p className="relative mt-4 text-base text-white/70 max-w-md mx-auto">{t('description')}</p>
        <div className="relative mt-8">
          <Link
            href="/vehicles"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-red-600 hover:bg-red-700 text-white px-8',
            )}
          >
            {t('button')}
            <ArrowRight className="size-4 ml-2" />
          </Link>
        </div>
      </div>
    </section>
  )
}
