import type { LucideIcon } from 'lucide-react'
import { Calendar, Car, Clock, Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'

const FEATURES: ReadonlyArray<{ key: string; Icon: LucideIcon }> = [
  { key: 'instantBooking', Icon: Calendar },
  { key: 'flexibleHours', Icon: Clock },
  { key: 'multilingualSupport', Icon: Globe },
  { key: 'localFleet', Icon: Car },
]

export function Features() {
  const t = useTranslations('landing.features')

  return (
    <section id="features" className="py-24 sm:py-32 px-4 bg-background scroll-mt-14">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-center">
          {t('heading')}
        </h2>

        {/* Decorative divider */}
        <div className="mx-auto mt-4 mb-16 w-12 h-0.5 bg-red-500/60 rounded-full" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {FEATURES.map(({ key, Icon }) => (
            <div key={key} className="group text-center sm:text-left">
              <div className="inline-flex items-center justify-center size-12 rounded-xl bg-red-50 text-red-600 mb-4 transition-colors group-hover:bg-red-100">
                <Icon className="size-6" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t(`${key}.title`)}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t(`${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
