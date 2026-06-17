import { Badge } from '@/components/ui/badge'
import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { useFormatter, useTranslations } from 'use-intl'

interface TeamViewProps {
  members: OperatorMemberData[]
  invites: OperatorInviteData[]
}

// #904: read-only projection of the operator's team — active members and the
// pending staff invites. Owner-only write affordances live on the route; this
// component stays a pure render of the rows.
export function TeamView({ members, invites }: TeamViewProps) {
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
                <Badge variant="outline" className="shrink-0">
                  {t('invites.pending')}
                </Badge>
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
