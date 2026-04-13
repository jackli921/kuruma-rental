import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatJpy } from '@/lib/format'
import type { MaintenanceLogData } from '@/lib/vehicle-api'
import { Wrench } from 'lucide-react'
import type { getTranslations } from 'next-intl/server'

type Translator = Awaited<ReturnType<typeof getTranslations>>

interface MaintenanceHistoryCardProps {
  logs: MaintenanceLogData[]
  t: Translator
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function MaintenanceHistoryCard({ logs, t }: MaintenanceHistoryCardProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h2 className="text-lg font-medium mb-4">
          <Wrench className="inline size-4 mr-1.5 -mt-0.5" />
          {t('maintenanceHistory')}
        </h2>
        {logs.length > 0 ? (
          <ul className="space-y-3">
            {logs.map((log) => (
              <li key={log.id} className="border-b last:border-0 pb-3 last:pb-0">
                <p className="text-sm font-medium">{log.reason}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{formatDate(log.startedAt)}</span>
                  {log.resolvedAt ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                      {t('resolved')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                      {t('ongoing')}
                    </Badge>
                  )}
                  {log.costJpy != null && (
                    <span className="ml-auto font-medium">{formatJpy(log.costJpy)}</span>
                  )}
                </div>
                {log.notes && <p className="mt-1 text-xs text-muted-foreground">{log.notes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noMaintenanceHistory')}</p>
        )}
      </CardContent>
    </Card>
  )
}
