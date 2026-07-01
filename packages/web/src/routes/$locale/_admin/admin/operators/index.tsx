import { PageSkeleton } from '@/vite/PageSkeleton'
import {
  OPERATORS_QUERY_KEY,
  type OperatorAdminRow,
  OperatorCreateDialog,
  OperatorEditDialog,
  OperatorsView,
  ProviderInviteDialog,
  createOperator,
  deactivateOperator,
  editOperator,
  mintProviderInvite,
  operatorsQueryOptions,
  reactivateOperator,
} from '@/vite/admin/operators'
import { useSession } from '@/vite/session'
import type { OperatorRole } from '@kuruma/shared/enums'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Platform-admin operator directory (#1088, epic #1075 slice 2). The `_admin`
// parent layout already gates on platform-admin membership, so this route owns
// the data + writes: prefetch the directory, then create / invite-staff / rename
// / deactivate-reactivate through the dedicated `/admin/operators` surface. The
// presentational view + dialogs are pure; this is the single smart container.
export const Route = createFileRoute('/$locale/_admin/admin/operators/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorsError,
  component: OperatorsRoute,
})

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

function OperatorsRoute() {
  const { locale } = Route.useParams()
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const { data } = useQuery(operatorsQueryOptions())

  const [createOpen, setCreateOpen] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<OperatorAdminRow | null>(null)
  const [editTarget, setEditTarget] = useState<OperatorAdminRow | null>(null)

  const invalidateDirectory = () => queryClient.invalidateQueries({ queryKey: OPERATORS_QUERY_KEY })

  const createMutation = useMutation({
    mutationFn: (input: { name: string; preAuthHandoffUrl?: string }) =>
      createOperator({ ...input, csrfToken }),
    onSuccess: () => {
      invalidateDirectory()
      setCreateOpen(false)
    },
  })

  const editMutation = useMutation({
    mutationFn: (input: { id: string; name: string }) => editOperator({ ...input, csrfToken }),
    onSuccess: () => {
      invalidateDirectory()
      setEditTarget(null)
    },
  })

  // Mint stays open on success to reveal the one-time link; the invite is not a
  // directory row, so no list invalidation is needed.
  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; role: OperatorRole; operatorId: string }) =>
      mintProviderInvite({ ...input, csrfToken }),
  })

  // One toggle for both directions — the row's current status picks the verb.
  const toggleMutation = useMutation({
    mutationFn: (operator: OperatorAdminRow) =>
      operator.deactivatedAt === null
        ? deactivateOperator({ id: operator.id, csrfToken })
        : reactivateOperator({ id: operator.id, csrfToken }),
    onSuccess: invalidateDirectory,
  })

  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null

  const openInvite = (operator: OperatorAdminRow) => {
    inviteMutation.reset()
    setInviteTarget(operator)
  }

  const openEdit = (operator: OperatorAdminRow) => {
    editMutation.reset()
    setEditTarget(operator)
  }

  return (
    <>
      <OperatorsView
        operators={data ?? []}
        locale={locale}
        togglingId={togglingId}
        onCreate={() => {
          createMutation.reset()
          setCreateOpen(true)
        }}
        onEdit={openEdit}
        onInvite={openInvite}
        onToggleActive={(operator) => toggleMutation.mutate(operator)}
      />

      <OperatorCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) createMutation.reset()
          setCreateOpen(open)
        }}
        isPending={createMutation.isPending}
        error={errorMessage(createMutation.error)}
        onSubmit={(input) => createMutation.mutate(input)}
      />

      <OperatorEditDialog
        key={editTarget?.id}
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            editMutation.reset()
            setEditTarget(null)
          }
        }}
        operator={editTarget}
        isPending={editMutation.isPending}
        error={errorMessage(editMutation.error)}
        onSubmit={({ name }) => {
          if (editTarget) editMutation.mutate({ id: editTarget.id, name })
        }}
      />

      <ProviderInviteDialog
        open={inviteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            inviteMutation.reset()
            setInviteTarget(null)
          }
        }}
        operatorName={inviteTarget?.name ?? null}
        created={inviteMutation.data ?? null}
        isPending={inviteMutation.isPending}
        error={errorMessage(inviteMutation.error)}
        onSubmit={({ email, role }) => {
          if (inviteTarget) inviteMutation.mutate({ email, role, operatorId: inviteTarget.id })
        }}
      />
    </>
  )
}

function OperatorsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.operators')
  const router = useRouter()
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
