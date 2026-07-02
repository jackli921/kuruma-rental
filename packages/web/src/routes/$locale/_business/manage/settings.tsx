import { PageSkeleton } from '@/vite/PageSkeleton'
import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { canPickOperatorContext, canWriteAsOperatorOwner } from '@/vite/guards'
import { useOperatorContext } from '@/vite/operator-context'
import { SettingsForm } from '@/vite/operator-settings/SettingsForm'
import {
  operatorProfileQueryKey,
  operatorProfileQueryOptions,
  updateOperatorProfile,
} from '@/vite/operator-settings/api'
import { sessionQueryOptions } from '@/vite/session'
import type { UpdateOperatorInput } from '@kuruma/shared/validators/operator'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator profile & business settings (#903). URL `/<locale>/manage/settings`,
// behind the `_business` guard. The loader prefetches the session and the
// caller's OWN operator profile (resolved by the session's operatorId, never a
// foreign tenant) so there is no FOUC; the component reads the same options via
// useSuspenseQuery. A bypass role (no operatorId) sees a not-applicable notice —
// it has no single operator to edit and manages operators via the admin portal.
export const Route = createFileRoute('/$locale/_business/manage/settings')({
  // Post-MVP feature (#903), hidden in the beta demo. The nav link is already
  // filtered out; this blocks a direct URL too, falling back to the bookings page.
  // Reads the runtime-toggleable flag (#1322): a dashboard override opens/closes the
  // route live. resolveFeatureFlag = override ?? build-time env ?? false.
  beforeLoad: async ({ context, params }) => {
    const overrides = await context.queryClient.ensureQueryData(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'OPERATOR_SETTINGS')) {
      throw redirect({ to: '/$locale/manage/bookings', params: { locale: params.locale } })
    }
  },
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: async ({ context, deps }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // Effective id: own operator session id wins; a bypass admin falls back to the
    // picked param. Matches OperatorSettingsRoute exactly (one resolution, two readers).
    const operatorId = session?.user.operatorId ?? deps.operator
    if (operatorId) {
      await context.queryClient.ensureQueryData(operatorProfileQueryOptions(operatorId))
    }
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorSettingsError,
  component: OperatorSettingsRoute,
})

export function OperatorSettingsRoute() {
  const t = useTranslations('business.settings')
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { pickedOperatorId } = useOperatorContext()
  // Effective operator id: a real operator session's own id always wins; a bypass
  // admin falls back to the picked id. Mirrors the loader (must stay in lockstep).
  const operatorId = session?.user.operatorId ?? pickedOperatorId
  const canPick = canPickOperatorContext(session ?? null)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        {session && operatorId ? (
          <OperatorSettings
            // Reset local saved/error state when the picker swaps tenants (architect M2).
            key={operatorId}
            operatorId={operatorId}
            csrfToken={session.csrfToken}
            canEditHandoff={canWriteAsOperatorOwner(session ?? null, pickedOperatorId)}
            showOperatorBadge={canPick && Boolean(pickedOperatorId)}
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

function OperatorSettings({
  operatorId,
  csrfToken,
  canEditHandoff,
  showOperatorBadge,
}: {
  operatorId: string
  csrfToken: string
  canEditHandoff: boolean
  showOperatorBadge: boolean
}) {
  const t = useTranslations('business.settings')
  const queryClient = useQueryClient()
  const { data: profile } = useSuspenseQuery(operatorProfileQueryOptions(operatorId))
  const [saved, setSaved] = useState(false)

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (input: UpdateOperatorInput) => updateOperatorProfile(operatorId, input, csrfToken),
    onSuccess: (updated) => {
      // PATCH returns the same projection the read uses, so seed the cache
      // directly (no refetch) and remount the form on the new values.
      queryClient.setQueryData(operatorProfileQueryKey(operatorId), updated)
      setSaved(true)
    },
  })

  return (
    <>
      {showOperatorBadge && (
        <p className="mb-4 inline-block rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {t('editingAs', { name: profile.name })}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive mb-4">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {saved && <output className="block text-sm text-emerald-600 mb-4">{t('saved')}</output>}
      <SettingsForm
        key={`${profile.name}:${profile.preAuthHandoffUrl ?? ''}`}
        defaultValues={{ name: profile.name, preAuthHandoffUrl: profile.preAuthHandoffUrl }}
        canEditHandoff={canEditHandoff}
        isSubmitting={isPending}
        onSubmit={async (input) => {
          setSaved(false)
          await mutateAsync(input)
        }}
      />
    </>
  )
}

function OperatorSettingsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.settings')
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
