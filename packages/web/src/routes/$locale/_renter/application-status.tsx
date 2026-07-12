import { myApplicationQueryOptions } from '@/vite/operator-registration/api'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Applicant application-status surface (#1549). Sits under `_renter`, so it inherits
// the session guard (redirect to login if signed out). Reads GET /operator-applications/me
// (auth-only, returns the applicant's own row or 404) and branches on status.
export const Route = createFileRoute('/$locale/_renter/application-status')({
  component: ApplicationStatusRoute,
})

function ApplicationStatusRoute() {
  const { locale } = Route.useParams()
  return <ApplicationStatusPage locale={locale} />
}

// Exported for unit-testing: the component accepts locale as a prop so tests can
// render it directly without a real router.
export function ApplicationStatusPage({ locale }: { locale: string }) {
  const t = useTranslations('operator.applicationStatus')
  const { data: application, isPending } = useQuery(myApplicationQueryOptions())

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">{t('title')}&hellip;</p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      {application === null || application === undefined ? (
        <NoApplicationView locale={locale} t={t} />
      ) : application.status === 'PENDING' ? (
        <PendingView t={t} />
      ) : application.status === 'APPROVED' ? (
        <ApprovedView locale={locale} t={t} />
      ) : (
        <RejectedView rejectionReason={application.rejectionReason} t={t} />
      )}
    </main>
  )
}

type TranslateFn = ReturnType<typeof useTranslations<'operator.applicationStatus'>>

function NoApplicationView({ locale, t }: { locale: string; t: TranslateFn }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('noApplication')}</p>
      <Link
        to="/$locale/business/register"
        params={{ locale }}
        className="mt-6 inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {t('applyNow')}
      </Link>
    </div>
  )
}

function PendingView({ t }: { t: TranslateFn }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('pendingTitle')}</h1>
      <p className="mt-4 text-muted-foreground">{t('pendingBody')}</p>
    </div>
  )
}

function ApprovedView({ locale, t }: { locale: string; t: TranslateFn }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('approvedTitle')}</h1>
      <p className="mt-4 text-muted-foreground">{t('approvedBody')}</p>
      <Link
        to="/$locale/dashboard"
        params={{ locale }}
        className="mt-6 inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {t('goToPortal')}
      </Link>
    </div>
  )
}

function RejectedView({
  rejectionReason,
  t,
}: {
  rejectionReason: string | null
  t: TranslateFn
}) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('rejectedTitle')}</h1>
      <p className="mt-4 text-muted-foreground">{t('rejectedBody')}</p>
      {rejectionReason !== null && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('rejectionReason', { reason: rejectionReason })}
        </p>
      )}
    </div>
  )
}
