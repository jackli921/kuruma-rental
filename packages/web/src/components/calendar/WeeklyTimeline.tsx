'use client'

import type { CalendarBooking } from '@/lib/calendar'
import type { VehicleData } from '@/lib/vehicle-api'
import { addDays, differenceInHours, format, isSameDay } from 'date-fns'
import { useState } from 'react'
import { BookingBlock } from './BookingBlock'
import { BookingDetailDialog } from './BookingDetailDialog'

const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7
const HOUR_WIDTH_PX = 40
const VEHICLE_ROW_HEIGHT_PX = 36
const DAY_WIDTH_PX = HOURS_PER_DAY * HOUR_WIDTH_PX
const LABEL_WIDTH_PX = 160

interface WeeklyTimelineProps {
  readonly weekStart: Date
  readonly vehicles: VehicleData[]
  readonly bookings: CalendarBooking[]
}

function getBookingsForVehicle(
  bookings: ReadonlyArray<CalendarBooking>,
  vehicleId: string,
): CalendarBooking[] {
  return bookings.filter((b) => b.vehicleId === vehicleId)
}

function getBookingPosition(
  booking: CalendarBooking,
  weekStart: Date,
): { left: string; width: string } | null {
  const bookingStart = new Date(booking.startAt)
  const bookingEnd = new Date(booking.effectiveEndAt)
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK)

  // Clamp to visible range
  const visibleStart = bookingStart < weekStart ? weekStart : bookingStart
  const visibleEnd = bookingEnd > weekEnd ? weekEnd : bookingEnd

  if (visibleStart >= visibleEnd) return null

  const totalHours = DAYS_PER_WEEK * HOURS_PER_DAY
  const startHour =
    differenceInHours(visibleStart, weekStart, { roundingMethod: 'floor' }) +
    visibleStart.getMinutes() / 60
  const endHour =
    differenceInHours(visibleEnd, weekStart, { roundingMethod: 'floor' }) +
    visibleEnd.getMinutes() / 60

  const leftPct = (startHour / totalHours) * 100
  const widthPct = ((endHour - startHour) / totalHours) * 100

  return {
    left: `${leftPct}%`,
    width: `${Math.max(widthPct, 0.5)}%`,
  }
}

function DayHeaders({ weekStart }: { readonly weekStart: Date }) {
  return (
    <div className="flex" style={{ width: DAY_WIDTH_PX * DAYS_PER_WEEK }}>
      {Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
        const day = addDays(weekStart, i)
        const isToday = isSameDay(day, new Date())
        const dayKey = format(day, 'yyyy-MM-dd')
        return (
          <div
            key={dayKey}
            className="border-r border-border text-center text-xs py-1.5 font-medium"
            style={{ width: DAY_WIDTH_PX }}
          >
            <span
              className={
                isToday
                  ? 'bg-primary text-primary-foreground rounded-full px-2 py-0.5'
                  : 'text-muted-foreground'
              }
            >
              {format(day, 'EEE d')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function HourMarkers() {
  return (
    <div className="flex" style={{ width: DAY_WIDTH_PX * DAYS_PER_WEEK }}>
      {DAY_KEYS.map((dayKey) => (
        <div key={dayKey} className="flex border-r border-border" style={{ width: DAY_WIDTH_PX }}>
          {Array.from({ length: HOURS_PER_DAY }, (_, hourIdx) => {
            const hourKey = `${dayKey}-${hourIdx}`
            return (
              <div
                key={hourKey}
                className="border-r border-border/30 text-[9px] text-muted-foreground text-center"
                style={{ width: HOUR_WIDTH_PX }}
              >
                {hourIdx % 6 === 0 ? `${String(hourIdx).padStart(2, '0')}:00` : ''}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function VehicleRow({
  vehicle,
  bookings,
  weekStart,
  onBookingClick,
}: {
  readonly vehicle: VehicleData
  readonly bookings: CalendarBooking[]
  readonly weekStart: Date
  readonly onBookingClick: (booking: CalendarBooking) => void
}) {
  return (
    <div className="flex border-b border-border" style={{ height: VEHICLE_ROW_HEIGHT_PX }}>
      <div
        className="shrink-0 border-r border-border px-2 flex items-center text-xs font-medium truncate bg-card sticky left-0 z-10"
        style={{ width: LABEL_WIDTH_PX }}
      >
        {vehicle.name}
      </div>
      <div className="relative flex-1" style={{ width: DAY_WIDTH_PX * DAYS_PER_WEEK }}>
        {/* Day dividers */}
        {DAY_KEYS.map((dayKey, i) => (
          <div
            key={`divider-${dayKey}`}
            className="absolute top-0 bottom-0 border-r border-border/50"
            style={{ left: `${(i / DAYS_PER_WEEK) * 100}%` }}
          />
        ))}
        {/* Booking blocks */}
        {bookings.map((booking) => {
          const pos = getBookingPosition(booking, weekStart)
          if (!pos) return null
          return (
            <BookingBlock key={booking.id} booking={booking} style={pos} onClick={onBookingClick} />
          )
        })}
      </div>
    </div>
  )
}

export function WeeklyTimeline({ weekStart, vehicles, bookings }: WeeklyTimelineProps) {
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)

  return (
    <>
      <div className="border border-border rounded-lg overflow-auto bg-background">
        {/* Header row */}
        <div className="flex border-b border-border sticky top-0 z-20 bg-card">
          <div
            className="shrink-0 border-r border-border px-2 flex items-center text-xs font-medium text-muted-foreground sticky left-0 z-30 bg-card"
            style={{ width: LABEL_WIDTH_PX }}
          >
            Vehicle
          </div>
          <div className="flex-1">
            <DayHeaders weekStart={weekStart} />
            <HourMarkers />
          </div>
        </div>
        {/* Vehicle rows */}
        {vehicles.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No vehicles found</div>
        ) : (
          vehicles.map((vehicle) => (
            <VehicleRow
              key={vehicle.id}
              vehicle={vehicle}
              bookings={getBookingsForVehicle(bookings, vehicle.id)}
              weekStart={weekStart}
              onBookingClick={setSelectedBooking}
            />
          ))
        )}
      </div>
      <BookingDetailDialog booking={selectedBooking} onClose={() => setSelectedBooking(null)} />
    </>
  )
}
