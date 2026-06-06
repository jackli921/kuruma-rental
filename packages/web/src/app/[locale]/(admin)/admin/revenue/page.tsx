import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTranslations } from 'next-intl/server'

// Placeholder only. Revenue aggregation (per-business gross / 4% fee / net
// payable, grouped monthly) reads successful `payment_events` via a new Hono
// API route (e.g. GET /admin/revenue?month=YYYY-MM) — gated on #461; the
// `payment_events` table does not exist in schema.ts yet. No data here.
export default async function RevenuePage() {
  const t = await getTranslations('admin')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('revenue.title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('revenue.subtitle')}</p>

      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('revenue.comingSoon')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('revenue.model')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
