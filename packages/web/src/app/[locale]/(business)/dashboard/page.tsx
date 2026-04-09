import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchDashboardStats } from '@/lib/dashboard-stats'
import { Calendar, Car, MessageSquare, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function DashboardPage() {
  const [t, stats] = await Promise.all([getTranslations('business'), fetchDashboardStats()])

  const cards = [
    {
      labelKey: 'stats.totalBookings' as const,
      icon: Calendar,
      value: stats?.totalBookings,
    },
    {
      labelKey: 'stats.activeVehicles' as const,
      icon: Car,
      value: stats?.activeVehicles,
    },
    {
      labelKey: 'stats.totalCustomers' as const,
      icon: Users,
      value: stats?.totalCustomers,
    },
    {
      labelKey: 'stats.unreadMessages' as const,
      icon: MessageSquare,
      value: stats?.unreadMessages,
    },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map(({ labelKey, icon: Icon, value }) => (
          <Card key={labelKey}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(labelKey)}
              </CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">
                {value != null ? value.toLocaleString() : '---'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
