import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, Car, MessageSquare, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function DashboardPage() {
  const t = await getTranslations('business')

  const stats = [
    { labelKey: 'stats.totalBookings' as const, icon: Calendar },
    { labelKey: 'stats.activeVehicles' as const, icon: Car },
    { labelKey: 'stats.totalCustomers' as const, icon: Users },
    { labelKey: 'stats.unreadMessages' as const, icon: MessageSquare },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map(({ labelKey, icon: Icon }) => (
          <Card key={labelKey}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(labelKey)}
              </CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">---</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
