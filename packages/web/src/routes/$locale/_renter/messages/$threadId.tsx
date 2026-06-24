import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Conversation view (#1032). Placeholder shell so inbox rows link to a real
// route; the message list + composer + translate toggle land in the next slice.
export const Route = createFileRoute('/$locale/_renter/messages/$threadId')({
  component: ThreadRoute,
})

function ThreadRoute() {
  const t = useTranslations('messaging.thread')
  const { locale } = Route.useParams()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/$locale/messages"
          params={{ locale }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t('back')}
        </Link>
        <p className="mt-8 text-muted-foreground">{t('noMessages')}</p>
      </div>
    </main>
  )
}
