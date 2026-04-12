import { fetchVehicleDetail } from '@/lib/vehicle-api'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { VehicleDetail } from './VehicleDetail'

interface VehicleDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function ManageVehicleDetailPage({ params }: VehicleDetailPageProps) {
  const { id } = await params
  const [vehicle, t] = await Promise.all([
    fetchVehicleDetail(id),
    getTranslations('business.vehicles.detail'),
  ])

  if (!vehicle) {
    notFound()
  }

  return <VehicleDetail vehicle={vehicle} t={t} />
}
