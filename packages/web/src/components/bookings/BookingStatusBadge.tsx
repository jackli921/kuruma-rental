import { cn } from '@/lib/utils'

type BookingStatus = 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

interface BookingStatusBadgeProps {
  readonly status: BookingStatus
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; className: string }> = {
  CONFIRMED: {
    label: 'Confirmed',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  ACTIVE: {
    label: 'Active',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}
