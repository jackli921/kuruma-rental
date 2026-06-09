import type { DocumentStatus } from '@/vite/documents/api'
import { useTranslations } from 'use-intl'

// Explicit maps (not string-built keys) so Tailwind's content scanner sees every
// class literal and the translator can grep every key — a `bg-${tone}-100`
// template would be purged from the build and invisible to i18n tooling.
const STATUS_CLASSES: Record<DocumentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
}

const STATUS_LABEL_KEY: Record<DocumentStatus, string> = {
  PENDING: 'statusPending',
  APPROVED: 'statusApproved',
  REJECTED: 'statusRejected',
}

const BASE_CLASSES = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium'

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const t = useTranslations('documents')
  return (
    <span className={`${BASE_CLASSES} ${STATUS_CLASSES[status]}`}>
      {t(STATUS_LABEL_KEY[status])}
    </span>
  )
}
