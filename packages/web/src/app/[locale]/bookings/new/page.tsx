import { fetchClassBySlug } from '@/modules/classes'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ClassBookingForm } from './ClassBookingForm'
import { ClassSummaryCard } from './ClassSummaryCard'

interface NewBookingPageProps {
  searchParams: Promise<{ classSlug?: string }>
}

// Issue #311: renter booking flow. The entry point is the class detail page,
// which links here with ?classSlug=<slug>. Middleware gates the whole
// /bookings/* tree, so by the time we render we know the caller is signed
// in. We resolve the class server-side so the form knows the classId (which
// the API requires) without a second round-trip.
export default async function NewBookingPage({ searchParams }: NewBookingPageProps) {
  const { classSlug } = await searchParams
  if (!classSlug) {
    notFound()
  }

  const [t, vc] = await Promise.all([getTranslations('bookings.new'), fetchClassBySlug(classSlug)])
  if (!vc) {
    notFound()
  }

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <ClassSummaryCard vehicleClass={vc} />
        <ClassBookingForm vehicleClass={{ id: vc.id, slug: vc.slug, name: vc.name }} />
      </div>
    </main>
  )
}
