import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from 'use-intl'

// Placeholder only. Real revenue aggregation (per-business gross / 4% fee / net
// payable, grouped monthly) reads successful `payment_events` via a future Hono
// route (GET /admin/revenue?month=YYYY-MM) — gated on #461; `payment_events` is
// not in schema.ts yet. No data here.
export function RevenuePlaceholderView() {
  const t = useTranslations('admin')

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
