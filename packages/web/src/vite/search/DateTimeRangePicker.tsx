import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import {
  type DateTimePart,
  type DateTimeRange,
  combineDateTime,
  fromLocalDate,
  isPastDate,
  jstNowParts,
  rentalDays,
  resolveSlot,
  slotsForDate,
  splitDateTime,
  toLocalDate,
} from '@/vite/search/datetime-range'
import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useLocale, useTranslations } from 'use-intl'

const DESKTOP_QUERY = '(min-width: 768px)'

interface DateTimeRangePickerProps {
  /** Committed JST wall-clock range, or null when nothing is chosen yet. */
  readonly value: DateTimeRange | null
  /** Fires only when a COMPLETE range (both ends) is selected. */
  readonly onChange: (next: DateTimeRange) => void
  /** "Now" for past-gating; defaults to the real clock. Disables earlier days/slots. */
  readonly minDate?: Date
  /** Forwarded to the trigger button so a `<Label htmlFor>` can target it. */
  readonly id?: string
  readonly className?: string
}

type Draft = { from: DateTimePart | null; to: DateTimePart | null }

function toDraft(value: DateTimeRange | null): Draft {
  return {
    from: value ? splitDateTime(value.from) : null,
    to: value ? splitDateTime(value.to) : null,
  }
}

function formatPart(part: DateTimePart | null, locale: string): string {
  if (!part) return ''
  const d = toLocalDate(part.date)
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${part.time}`
}

/**
 * Renter pickup/return picker (#965): a range calendar + two 30-min time-slot
 * dropdowns, modeled on the car-rental standard. Desktop renders in a Popover,
 * mobile in a bottom Sheet — both wrap the same panel. The output contract is
 * unchanged: it emits the JST wall-clock `from`/`to` strings the old native
 * inputs produced, so `parseSearchRange`/the API stay untouched.
 */
export function DateTimeRangePicker({
  value,
  onChange,
  minDate,
  id,
  className,
}: DateTimeRangePickerProps) {
  const t = useTranslations('search.picker')
  const locale = useLocale()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(value))

  const now = minDate ?? new Date()

  // Re-seed the working draft from the committed `value` each time the panel
  // opens, so an externally-changed value (e.g. a parent "clear dates", or #955
  // pushing a value in) is reflected instead of showing stale draft state.
  function handleOpenChange(next: boolean): void {
    if (next) setDraft(toDraft(value))
    setOpen(next)
  }

  // Commit a draft; surface a complete range to the parent (drop-in contract).
  function commit(next: Draft): void {
    setDraft(next)
    if (next.from && next.to) {
      onChange({
        from: combineDateTime(next.from.date, next.from.time),
        to: combineDateTime(next.to.date, next.to.time),
      })
    }
  }

  function handleSelect(range: DateRange | undefined): void {
    const fromDate = range?.from ? fromLocalDate(range.from) : null
    const toDate = range?.to ? fromLocalDate(range.to) : null
    commit({
      from: fromDate
        ? { date: fromDate, time: resolveSlot(fromDate, draft.from?.time ?? null, now) }
        : null,
      to: toDate ? { date: toDate, time: resolveSlot(toDate, draft.to?.time ?? null, now) } : null,
    })
  }

  const selected: DateRange | undefined =
    draft.from || draft.to
      ? {
          from: draft.from ? toLocalDate(draft.from.date) : undefined,
          to: draft.to ? toLocalDate(draft.to.date) : undefined,
        }
      : undefined

  const jstToday = toLocalDate(jstNowParts(now).date)
  const days =
    draft.from && draft.to
      ? rentalDays({
          from: combineDateTime(draft.from.date, draft.from.time),
          to: combineDateTime(draft.to.date, draft.to.time),
        })
      : 0

  // Trigger reflects the COMMITTED value (not the in-flight draft), so the closed
  // control always tracks its controlled prop. value is null or a complete range.
  const committed = toDraft(value)
  const triggerLabel = value
    ? `${formatPart(committed.from, locale)} → ${formatPart(committed.to, locale)}`
    : t('placeholder')

  const panel = (
    <div className="flex flex-col gap-3">
      <Calendar
        mode="range"
        selected={selected}
        onSelect={handleSelect}
        disabled={(d) => isPastDate(fromLocalDate(d), now)}
        defaultMonth={selected?.from ?? jstToday}
        autoFocus
        className="mx-auto"
      />
      <div className="grid grid-cols-2 gap-2">
        <TimeField
          label={t('pickupTime')}
          time={draft.from?.time ?? null}
          slots={draft.from ? slotsForDate(draft.from.date, now) : []}
          onChange={(time) => draft.from && commit({ ...draft, from: { ...draft.from, time } })}
        />
        <TimeField
          label={t('returnTime')}
          time={draft.to?.time ?? null}
          slots={draft.to ? slotsForDate(draft.to.date, now) : []}
          onChange={(time) => draft.to && commit({ ...draft, to: { ...draft.to, time } })}
        />
      </div>
      {days > 0 && (
        <p className="px-1 text-sm text-muted-foreground">{t('days', { count: days })}</p>
      )}
      <Button type="button" size="sm" className="self-end" onClick={() => setOpen(false)}>
        {t('done')}
      </Button>
    </div>
  )

  const trigger = (
    <>
      <CalendarIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{triggerLabel}</span>
    </>
  )
  const triggerButton = (
    <Button
      id={id}
      type="button"
      variant="outline"
      className={cn('w-full justify-start font-normal', className)}
    />
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger render={triggerButton}>{trigger}</PopoverTrigger>
        <PopoverContent className="w-auto" align="start">
          {panel}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={triggerButton}>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto p-4">
        <SheetTitle>{t('placeholder')}</SheetTitle>
        {panel}
      </SheetContent>
    </Sheet>
  )
}

function TimeField({
  label,
  time,
  slots,
  onChange,
}: {
  readonly label: string
  readonly time: string | null
  readonly slots: readonly string[]
  readonly onChange: (time: string) => void
}) {
  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {time ? (
        <Select
          value={time}
          onValueChange={(next) => {
            if (next) onChange(next)
          }}
        >
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {slots.map((slot) => (
              <SelectItem key={slot} value={slot}>
                {slot}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
          --:--
        </span>
      )}
    </div>
  )
}
