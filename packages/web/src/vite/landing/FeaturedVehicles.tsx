import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AcrissCode } from '@kuruma/shared'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

// Browse-by-category tiles. Each maps an ACRISS class to a representative photo;
// the label is resolved from the shared `acriss.*` namespace (same source as the
// search filter chips), and the tile deep-links into /search prefiltered by that
// class so the card lands the renter inside the real booking funnel, not the
// static /vehicles marketing catalog it used to dead-end on.
const CATEGORIES: readonly { code: AcrissCode; image: string }[] = [
  {
    code: 'MCAR',
    image: 'https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80',
  },
  {
    code: 'CCAR',
    image: 'https://images.unsplash.com/photo-1638618164682-12b986ec2a75?w=600&q=80',
  },
  {
    code: 'SUVR',
    image: 'https://images.unsplash.com/photo-1622071356556-47f1b87743de?w=600&q=80',
  },
  { code: 'IVAR', image: 'https://images.unsplash.com/photo-1558101847-e017d5e414a4?w=600&q=80' },
]

export function FeaturedVehicles() {
  const t = useTranslations('landing.featured')
  const tAcriss = useTranslations('acriss')
  const locale = useLocale()

  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('heading')}</h2>
            <p className="mt-2 text-lg text-muted-foreground">{t('subheading')}</p>
          </div>
          <Link
            to="/$locale/search"
            params={{ locale }}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'hidden sm:inline-flex text-red-600 hover:text-red-700 hover:bg-red-50',
            )}
          >
            {t('viewAll')}
            <ArrowRight className="size-4 ml-1" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {CATEGORIES.map((category) => (
            <Link
              key={category.code}
              to="/$locale/search"
              params={{ locale }}
              search={{ class: category.code }}
              className="group block rounded-xl overflow-hidden bg-background shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                <img
                  src={category.image}
                  alt={tAcriss(category.code)}
                  // 4:3 intrinsic hint lets the browser reserve the box before load (#846);
                  // h-full/w-full still drive the rendered size inside the aspect wrapper.
                  width={400}
                  height={300}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <h3 className="font-semibold text-foreground">{tAcriss(category.code)}</h3>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link
            to="/$locale/search"
            params={{ locale }}
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}
          >
            {t('viewAll')}
            <ArrowRight className="size-4 ml-1" />
          </Link>
        </div>
      </div>
    </section>
  )
}
