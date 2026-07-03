import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { canPickOperatorContext, canWriteAsOperatorOwner } from '@/vite/guards'
import { OperatorBadge, operatorsQueryOptions, useOperatorContext } from '@/vite/operator-context'
import { DeactivateMemberDialog } from '@/vite/operator-team/DeactivateMemberDialog'
import { InviteStaffDialog } from '@/vite/operator-team/InviteStaffDialog'
import { RevokeInviteDialog } from '@/vite/operator-team/RevokeInviteDialog'
import { TeamView } from '@/vite/operator-team/TeamView'
import { teamInvitesQueryOptions, teamMembersQueryOptions } from '@/vite/operator-team/api'
import { sessionQueryOptions } from '@/vite/session'
import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, redirect } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator self-service team management (#904) + platform-admin picker (#1230
// slice 6). URL `/<locale>/manage/team` — behind the `_business` guard. An
// operator manages its own tenant; a PLATFORM_ADMIN manages the PICKED operator's
// team (the API resolves the tenant through `resolveTeamOperatorId`). All-mode (no
// pick) fires NO team read and shows a pick-prompt — the operatorId-gated child
// never mounts. Inviting/revoking/deactivating is owner-tier (canWriteAsOperatorOwner),
// mirroring the API's requireOperatorOwnerWrite gate; staff see read-only.
export const Route = createFileRoute('/$locale/_business/manage/team')({
  // Post-MVP feature (#904), hidden in the beta demo. The nav link is already
  // filtered out; this blocks a direct URL too, falling back to the bookings page.
  // Reads the runtime-toggleable flag (#1322): a dashboard override opens/closes the
  // route live. resolveFeatureFlag = override ?? build-time env ?? false.
  beforeLoad: async ({ context, params }) => {
    const overrides = await context.queryClient.ensureQueryData(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'OPERATOR_TEAM')) {
      throw redirect({ to: '/$locale/manage/bookings', params: { locale: params.locale } })
    }
  },
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: async ({ context, deps }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // Capability-gated: a retained ?operator= is honored only for a picker-admin,
    // never a legacy STAFF/ADMIN (whose team read would 403). Search params are
    // input, not permission — derive from session capability first.
    const picked = canPickOperatorContext(session ?? null) ? deps.operator : undefined
    const operatorId = session?.user.operatorId ?? picked
    if (operatorId) {
      await Promise.all([
        context.queryClient.ensureQueryData(teamMembersQueryOptions(operatorId)),
        context.queryClient.ensureQueryData(teamInvitesQueryOptions(operatorId)),
      ])
    }
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorTeamError,
  component: OperatorTeamRoute,
})

export function OperatorTeamRoute() {
  const t = useTranslations('business.team')
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { pickedOperatorId } = useOperatorContext()
  const canPick = canPickOperatorContext(session ?? null)
  // Mirror the loader — must stay in lockstep. A legacy admin's retained param drops.
  const picked = canPick ? pickedOperatorId : undefined
  const operatorId = session?.user.operatorId ?? picked
  const canManage = canWriteAsOperatorOwner(session ?? null, pickedOperatorId)

  // Badge label: team reads carry only the user's name, so source the operator name
  // from the operators list (already cached by BusinessLayout's picker on this route).
  // operatorNameById from useOperatorScope is empty when a pick is active — do not use it.
  const { data: operators } = useQuery({
    ...operatorsQueryOptions(),
    enabled: canPick && Boolean(pickedOperatorId),
  })
  const pickedName = operators?.find((o) => o.id === pickedOperatorId)?.name

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          {canPick && Boolean(pickedOperatorId) && <OperatorBadge name={pickedName} />}
        </header>

        {session && operatorId ? (
          <OperatorTeamData
            key={operatorId}
            operatorId={operatorId}
            canManage={canManage}
            csrfToken={session.csrfToken}
          />
        ) : (
          <p className="text-muted-foreground">
            {canPick ? t('pickOperatorPrompt') : t('noOperatorContext')}
          </p>
        )}
      </div>
    </main>
  )
}

function OperatorTeamData({
  operatorId,
  canManage,
  csrfToken,
}: {
  operatorId: string
  canManage: boolean
  csrfToken: string
}) {
  const t = useTranslations('business.team')
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions(operatorId))
  const { data: invites } = useSuspenseQuery(teamInvitesQueryOptions(operatorId))
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedInvite, setSelectedInvite] = useState<OperatorInviteData | null>(null)
  const [selectedMember, setSelectedMember] = useState<OperatorMemberData | null>(null)

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">{t('staffNotice')}</p>
        ) : (
          <span />
        )}
        {canManage && (
          <Button onClick={() => setInviteOpen(true)} className="shrink-0">
            <UserPlus className="size-4" />
            {t('invite')}
          </Button>
        )}
      </div>

      <TeamView
        members={members}
        invites={invites}
        canManage={canManage}
        onRevokeInvite={setSelectedInvite}
        onDeactivateMember={setSelectedMember}
      />

      {canManage && (
        <>
          <InviteStaffDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
          <RevokeInviteDialog
            invite={selectedInvite}
            onOpenChange={(open) => !open && setSelectedInvite(null)}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
          <DeactivateMemberDialog
            member={selectedMember}
            onOpenChange={(open) => !open && setSelectedMember(null)}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
        </>
      )}
    </>
  )
}

function OperatorTeamError(_props: ErrorComponentProps) {
  const t = useTranslations('business.team')

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-7xl py-20 text-center"
      />
    </main>
  )
}
