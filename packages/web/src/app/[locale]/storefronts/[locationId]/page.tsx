import {
  StorefrontDetailView,
  fetchStorefrontDetail,
  normalizeClassFilter,
  parseSearchRange,
} from '@/modules/storefronts'
import { notFound, redirect } from 'next/navigation'

interface StorefrontDetailPageProps {
  params: Promise<{ locale: string; locationId: string }>
  searchParams: Promise<{ from?: string; to?: string; class?: string | string[] }>
}

// Storefront drill-down (#391). Public — anonymous renters see the available
// cars at one store for their date range. A direct link without a usable range
// can't compute availability, so we bounce back to /search to pick dates. An
// unknown/archived store is a 404; a known-but-full store is a 200 empty list.
export default async function StorefrontDetailPage({
  params,
  searchParams,
}: StorefrontDetailPageProps) {
  const { locale, locationId } = await params
  const sp = await searchParams

  const range = parseSearchRange(sp.from, sp.to)
  if (!range) redirect(`/${locale}/search`)

  const classes = normalizeClassFilter(sp.class)
  const detail = await fetchStorefrontDetail(locationId, {
    from: range.from,
    to: range.to,
    ...(classes.length > 0 ? { classes } : {}),
  })
  if (!detail) notFound()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <StorefrontDetailView detail={detail} from={sp.from ?? ''} to={sp.to ?? ''} />
    </main>
  )
}
