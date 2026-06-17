import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { useFormatter, useTranslations } from 'use-intl'

interface TeamViewProps {
  members: OperatorMemberData[]
  invites: OperatorInviteData[]
  canManage: boolean
  onRevokeInvite: (invite: OperatorInviteData) => void
  onDeactivateMember: (member: OperatorMemberData) => void
}

// #904: projection of the operator's team — active members and pending staff
// invites. The owner-only write affordances (revoke / deactivate) render per-row
// when canManage; the confirm dialogs and tenant-scoping live on the route. The
// row buttons label themselves with the row subject (email / name) so each has a
// distinct accessible name and the parent learns which row was acted on.
export function TeamView({
  members,
  invites,
  canManage,
  onRevokeInvite,
  onDeactivateMember,
}: TeamViewProps) {
  const t = useTranslations('business.team')
  const f = useFormatter()

  return (
    <div className="space-y-10">
      <section aria-labelledby="team-members-heading">
        <h2 id="team-members-heading" className="mb-3 text-xl font-semibold">
          {t('members.title')}
        </h2>
        {members.length === 0 ? (
          <p className="text-muted-foreground">{t('members.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.name ?? t('unknownName')}</p>
                  <p className="truncate text-sm text-muted-foreground">{m.email ?? '—'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="secondary">{roleLabel(t, m.role)}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('members.joined', {
                      date: f.dateTime(new Date(m.joinedAt), { dateStyle: 'medium' }),
                    })}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('deactivateTitle', { name: m.name ?? t('unknownName') })}
                      onClick={() => onDeactivateMember(m)}
                    >
                      {t('deactivate')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-invites-heading">
        <h2 id="team-invites-heading" className="mb-3 text-xl font-semibold">
          {t('invites.title')}
        </h2>
        {invites.length === 0 ? (
          <p className="text-muted-foreground">{t('invites.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {t('invites.expires', {
                      date: f.dateTime(new Date(i.expiresAt), { dateStyle: 'medium' }),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline">{t('invites.pending')}</Badge>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('revokeTitle', { email: i.email })}
                      onClick={() => onRevokeInvite(i)}
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function roleLabel(
  t: ReturnType<typeof useTranslations>,
  role: OperatorMemberData['role'],
): string {
  return role === 'OPERATOR_OWNER' ? t('roleOwner') : t('roleStaff')
}
