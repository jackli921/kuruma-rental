import { auth } from '@/auth'
import { getVehicleById } from '@/lib/vehicles'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { BookingForm } from './BookingForm'

interface NewBookingPageProps {
  searchParams: Promise<{ vehicleId?: string }>
}

export default async function NewBookingPage({ searchParams }: NewBookingPageProps) {
  const { vehicleId } = await searchParams
  const [session, t] = await Promise.all([auth(), getTranslations('bookings.new')])

  if (!vehicleId) {
    notFound()
  }

  const vehicle = await getVehicleById(vehicleId)
  if (!vehicle) {
    notFound()
  }

  const isAuthenticated = !!session?.user

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight mb-8">{t('title')}</h1>
        <BookingForm
          vehicle={{
            id: vehicle.id,
            name: vehicle.name,
            photos: vehicle.photos ?? [],
            seats: vehicle.seats,
            transmission: vehicle.transmission,
            fuelType: vehicle.fuelType,
          }}
          isAuthenticated={isAuthenticated}
        />
      </div>
    </main>
  )
}
