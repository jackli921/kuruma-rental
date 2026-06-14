import { Button } from '@/components/ui/button'
import { formatDateTime, formatJpy, formatVehicleRate } from '@/lib/format'
import { EditVehicleSheet } from '@/vite/operator-fleet/EditVehicleSheet'
import { PhotoUpload } from '@/vite/operator-fleet/PhotoUpload'
import { type VehicleDetailResponse, vehicleRowFromDetail } from '@/vite/operator-fleet/api'
import { StatusPill } from '@/vite/operator-fleet/cells'
import { Car, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface VehicleDetailProps {
  readonly detail: VehicleDetailResponse
  readonly locale: string
  // False for bypass roles (no operatorId): the page is read-only — no Edit,
  // no photo management — mirroring the fleet list (#598). [[shell-guard-vs-action-authz]]
  readonly canWrite: boolean
}

const HOURS_PER_DAY = 24

// Single-vehicle drill-down (#527), ported from the frozen Next.js detail page to
// the Vite shell. The frozen react-big-calendar is replaced by a "calendar-lite":
// a compact upcoming-bookings list plus a 30-day utilization strip — enough
// operator oversight without the heavy calendar dep. Presentation (status / price)
// reuses the shared fleet cells; the edit affordance reuses EditVehicleSheet via
// `vehicleRowFromDetail` so there is no second fetch.
export function VehicleDetail({ detail, locale, canWrite }: VehicleDetailProps) {
  const t = useTranslations('business.vehicles.detail')
  const tFleet = useTranslations('business.vehicles.fleet')
  const [editOpen, setEditOpen] = useState(false)

  const photos = detail.photos
  const primaryPhoto = photos[0]
  const row = vehicleRowFromDetail(detail)
  const specParts = [
    t('seats', { count: detail.seats }),
    detail.transmission === 'AUTO' ? t('auto') : t('manual'),
    detail.fuelType,
  ].filter((p): p is string => Boolean(p))

  const utilization = detail.utilizationLast30Days
  const avgUtilization =
    utilization.length > 0
      ? Math.round(
          // Clamp each day to the 24h window: overlapping MANUAL / unassigned
          // bookings can sum a single day past 24h, which would push the average
          // over 100%. The per-bar strip already clamps; mirror it here.
          (utilization.reduce((sum, d) => sum + Math.min(HOURS_PER_DAY, d.bookedHours), 0) /
            (utilization.length * HOURS_PER_DAY)) *
            100,
        )
      : 0
  const nextBooking = detail.upcomingBookings[0]
  const priceLabel = formatVehicleRate(detail.dailyRateJpy, detail.hourlyRateJpy, {
    perDay: tFleet('perDay'),
    perHour: tFleet('perHour'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
          {primaryPhoto ? (
            <img
              src={primaryPhoto}
              alt={detail.name}
              // 3:2 intrinsic hint lets the browser reserve the box before load (#846);
              // h-full/w-full still drive the rendered size inside the fixed wrapper.
              width={300}
              height={200}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Car className="size-6 text-muted-foreground/30" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-semibold text-2xl tracking-tight">{detail.name}</h1>
            <StatusPill status={detail.status} label={tFleet(`status.${detail.status}`)} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-muted-foreground text-sm">
            {detail.licensePlate && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {detail.licensePlate}
              </span>
            )}
            <span>{specParts.join(' · ')}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {priceLabel && <p className="font-semibold text-lg">{priceLabel}</p>}
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              {t('editVehicle')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('utilizationShort')} value={`${avgUtilization}%`} />
        <Stat
          label={t('upcomingShort')}
          value={String(detail.upcomingBookings.length)}
          hint={
            nextBooking
              ? `${t('nextBookingShort')} ${formatDateTime(nextBooking.startAt, locale)}`
              : undefined
          }
        />
        <Stat
          label={t('revenueLast30dShort')}
          value={detail.revenueLast30d > 0 ? formatJpy(detail.revenueLast30d) : '--'}
        />
        <Stat label={t('maintenanceHistory')} value={String(detail.maintenanceLogs.length)} />
      </div>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold text-sm">{t('upcomingBookings')}</h2>
        {detail.upcomingBookings.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noUpcomingBookings')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.upcomingBookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="tabular-nums">
                  {formatDateTime(b.startAt, locale)} – {formatDateTime(b.endAt, locale)}
                </span>
                <span className="text-muted-foreground">
                  {b.renterName ?? '—'} · {b.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold text-sm">{t('utilization')}</h2>
        <div className="flex h-16 items-end gap-0.5" aria-hidden>
          {utilization.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.bookedHours}h`}
              className="flex-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.min(100, (d.bookedHours / HOURS_PER_DAY) * 100)}%` }}
            />
          ))}
        </div>
      </section>

      {canWrite ? (
        <EditVehicleSheet
          open={editOpen}
          vehicle={row}
          onOpenChange={setEditOpen}
          onSaved={() => setEditOpen(false)}
        />
      ) : (
        photos.length > 0 && (
          <section className="rounded-xl border border-border p-4">
            <h2 className="mb-3 font-semibold text-sm">{t('photos')}</h2>
            <ul className="grid grid-cols-5 gap-2">
              {photos.map((url, idx) => (
                <li key={url} className="aspect-square">
                  <img
                    src={url}
                    alt={`${detail.name} ${idx + 1}`}
                    // 1:1 intrinsic hint lets the browser reserve the box before load (#846);
                    // h-full/w-full still drive the rendered size inside the square wrapper.
                    width={300}
                    height={300}
                    className="h-full w-full rounded-md border object-cover"
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {canWrite && <PhotoUpload key={detail.id} vehicleId={detail.id} photos={photos} />}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 font-semibold text-xl">{value}</p>
      {hint && <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}
