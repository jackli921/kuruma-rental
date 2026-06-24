import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

interface MessageHostLinkProps {
  readonly threadId: string
  readonly locale: string
  readonly className?: string
}

// Deep-link from a booking surface to that booking's conversation (#1032). The
// caller resolves the threadId (indexThreadIdsByBooking) and renders this only
// when one exists, so the link always points at a real thread.
export function MessageHostLink({ threadId, locale, className }: MessageHostLinkProps) {
  const t = useTranslations('messaging.entry')
  return (
    <Link
      to="/$locale/messages/$threadId"
      params={{ locale, threadId }}
      className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0', className)}
    >
      {t('messageHost')}
    </Link>
  )
}
