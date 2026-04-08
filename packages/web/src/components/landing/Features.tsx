import { Calendar, Car, Clock, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
    <section id="features" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-background">
      <div className="max-w-6xl mx-auto">
        <p className="text-sm font-semibold text-red-600 tracking-wide uppercase text-center">
          {t('eyebrow')}
        </p>
        <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-center">
          {t('heading')}
        </h2>
        <p className="mt-4 text-lg text-muted-foreground text-center max-w-2xl mx-auto">
          {t('subheading')}
        </p>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {FEATURES.map(({ key, Icon }) => (
            <div key={key} className="flex flex-col items-center text-center">
              <div className="flex items-center justify-center size-14 rounded-2xl bg-red-50 text-red-600 mb-5">
                <Icon className="size-7" />
              </div>
              <h3 className="text-lg font-semibold">{t(`${key}.title`)}</h3>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                {t(`${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
