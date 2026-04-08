import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { ArrowRight, Star, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'

const VEHICLES = [
  {
    name: 'Honda N-BOX',
    type: 'Kei Car',
    image: 'https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80',
    price: 3500,
    seats: 4,
    rating: 4.9,
  },
  {
    name: 'Toyota Aqua',
    type: 'Compact Hybrid',
    image: 'https://images.unsplash.com/photo-1638618164682-12b986ec2a75?w=600&q=80',
    price: 5000,
    seats: 5,
    rating: 4.8,
  },
  {
    name: 'Suzuki Jimny',
    type: 'Compact SUV',
    image: 'https://images.unsplash.com/photo-1622071356556-47f1b87743de?w=600&q=80',
    price: 7000,
    seats: 4,
    rating: 4.9,
  },
  {
    name: 'Toyota Alphard',
    type: 'Luxury Van',
    image: 'https://images.unsplash.com/photo-1558101847-e017d5e414a4?w=600&q=80',
    price: 12000,
    seats: 7,
    rating: 4.9,
  },
] as const

export function FeaturedVehicles() {
  const t = useTranslations('landing.featured')

  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('heading')}</h2>
            <p className="mt-2 text-lg text-muted-foreground">{t('subheading')}</p>
          </div>
          <Link
            href="/vehicles"
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
          {VEHICLES.map((vehicle) => (
            <Link
              key={vehicle.name}
              href="/vehicles"
              className="group block rounded-xl overflow-hidden bg-background shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                <img
                  src={vehicle.image}
                  alt={vehicle.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">{vehicle.name}</h3>
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="size-3.5 fill-foreground text-foreground" />
                    <span className="font-medium">{vehicle.rating}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{vehicle.type}</p>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm">
                    <span className="font-semibold">
                      {t('currency', { price: vehicle.price.toLocaleString() })}
                    </span>
                    <span className="text-muted-foreground"> / {t('perDay')}</span>
                  </p>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="size-3.5" />
                    <span>{vehicle.seats}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link
            href="/vehicles"
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
