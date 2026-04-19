import { ClassDetailView, fetchClassBySlug } from '@/modules/classes'
import { notFound } from 'next/navigation'

interface ClassDetailPageProps {
  params: Promise<{ slug: string; locale: string }>
}

// Renter-facing class detail page. Thin shell: resolves the slug via the
// public catalog endpoint, then delegates rendering to ClassDetailView.
// No auth required.
export default async function ClassDetailPage({ params }: ClassDetailPageProps) {
  const { slug } = await params
  const vc = await fetchClassBySlug(slug)

  if (!vc) {
    notFound()
  }

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <ClassDetailView vehicleClass={vc} />
    </main>
  )
}
