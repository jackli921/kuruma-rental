import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorTeamEnabled } from '@/vite/config/features'
import { isOperatorOwnerSession, isOperatorSession } from '@/vite/guards'
import { InviteStaffDialog } from '@/vite/operator-team/InviteStaffDialog'
import { TeamView } from '@/vite/operator-team/TeamView'
import { teamInvitesQueryOptions, teamMembersQueryOptions } from '@/vite/operator-team/api'
import { sessionQueryOptions } from '@/vite/session'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator self-service team management (#904). URL `/<locale>/manage/team` —
// behind the `_business` guard. The loader prefetches the session + members +
// pending invites (no FOUC); the component reads the same options via
// useSuspenseQuery. Tenant scoping is server-side (the client names no
// operatorId). Inviting is owner-only (isOperatorOwnerSession), mirroring the
// API's requireOperatorOwnerWrite gate; staff and bypass roles see read-only.
export const Route = createFileRoute('/$locale/_business/manage/team')({
  // Post-MVP feature (#904), hidden in the beta demo. The nav link is already
  // filtered out; this blocks a direct URL too, falling back to the bookings page.
  beforeLoad: ({ params }) => {
    if (!isOperatorTeamEnabled()) {
      throw redirect({ to: '/$locale/manage/bookings', params: { locale: params.locale } })
    }
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(sessionQueryOptions()),
      context.queryClient.ensureQueryData(teamMembersQueryOptions()),
      context.queryClient.ensureQueryData(teamInvitesQueryOptions()),
    ])
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorTeamError,
  component: OperatorTeamRoute,
})

export function OperatorTeamRoute() {
  const t = useTranslations('business.team')
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  const { data: invites } = useSuspenseQuery(teamInvitesQueryOptions())
  const [inviteOpen, setInviteOpen] = useState(false)

  // A bypass role (PLATFORM_ADMIN / legacy STAFF·ADMIN) carries no operatorId and
  // has no single team to manage — it onboards operators via the admin portal.
  const hasOperator = isOperatorSession(session)
  // Inviting is owner-only; staff see the team read-only (API is the real gate).
  const canInvite = isOperatorOwnerSession(session)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          {canInvite && (
            <Button onClick={() => setInviteOpen(true)} className="shrink-0">
              <UserPlus className="size-4" />
              {t('invite')}
            </Button>
          )}
        </header>

        {hasOperator ? (
          <>
            {!canInvite && <p className="mb-6 text-sm text-muted-foreground">{t('staffNotice')}</p>}
            <TeamView members={members} invites={invites} />
          </>
        ) : (
          <p className="text-muted-foreground">{t('noOperatorContext')}</p>
        )}

        {canInvite && session && (
          <InviteStaffDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            csrfToken={session.csrfToken}
          />
        )}
      </div>
    </main>
  )
}

function OperatorTeamError(_props: ErrorComponentProps) {
  const t = useTranslations('business.team')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
