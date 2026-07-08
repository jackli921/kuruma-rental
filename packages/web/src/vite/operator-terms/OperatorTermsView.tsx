import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { OperatorScope } from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { SaveTermsDialog } from './SaveTermsDialog'
import { TermsStatusBadge } from './TermsStatusBadge'
import type { OperatorTermsVersionData } from './api'
import {
  OPERATOR_TERMS_QUERY_KEY,
  archiveOperatorTermsVersion,
  publishOperatorTermsVersion,
} from './api'

interface OperatorTermsViewProps {
  readonly versions: readonly OperatorTermsVersionData[]
  readonly scope: OperatorScope
}

// Inline archive confirmation dialog — mirrors InsuranceArchiveDialog pattern
// but inlined here since there's only one usage and no separate InsuranceRow.
interface ArchiveDialogProps {
  version: OperatorTermsVersionData | null
  pickedOperatorId: string | undefined
  onOpenChange: (open: boolean) => void
}

function ArchiveDialog({ version, pickedOperatorId, onOpenChange }: ArchiveDialogProps) {
  const t = useTranslations('business.terms')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: (v: string) => archiveOperatorTermsVersion(v, csrfToken, pickedOperatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_TERMS_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard (mirrors InsuranceArchiveDialog).
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  return (
    <Dialog open={version !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { version: version?.version ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || version == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !version) return
              inFlightRef.current = true
              mutate(version.version)
            }}
          >
            {isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Controlled list + empty state. The route owns the loader / useSuspenseQuery
// and the pending/error boundaries (FC/IS — the shell does I/O, this renders).
// The SaveTermsDialog and ArchiveDialog own their own write mutations and
// invalidate OPERATOR_TERMS_QUERY_KEY on success, so the prefetched list
// refetches.
//
// In all-mode (a cross-operator reader with no picked operator) the page is
// read-only: `canWrite` is false so no write affordances render. A scoped
// write (operator session, or admin who picked a tenant) shows the
// New/Edit/Publish/Archive controls.
//
// The API returns versions newest-first; we render as given.
export function OperatorTermsView({ versions, scope }: OperatorTermsViewProps) {
  const { pickedOperatorId, canWrite } = scope
  const t = useTranslations('business.terms')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const [showSave, setShowSave] = useState(false)
  const [editingDraft, setEditingDraft] = useState<OperatorTermsVersionData | null>(null)
  const [archiving, setArchiving] = useState<OperatorTermsVersionData | null>(null)

  const draft = versions.find((v) => v.status === 'DRAFT') ?? null

  const { mutate: publish, isPending: isPublishing } = useMutation({
    mutationFn: (version: string) =>
      publishOperatorTermsVersion(version, csrfToken, pickedOperatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_TERMS_QUERY_KEY })
    },
  })

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-center justify-end">
          {draft ? (
            <Button
              onClick={() => {
                setEditingDraft(draft)
                setShowSave(true)
              }}
            >
              {t('editDraft')}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setEditingDraft(null)
                setShowSave(true)
              }}
            >
              <Plus className="size-4 mr-1.5" />
              {t('addOption')}
            </Button>
          )}
        </div>
      )}

      {versions.length === 0 ? (
        <div className="text-center py-20">
          <FileText className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((v) => (
            <div
              key={v.version}
              className="flex items-start justify-between rounded-lg border bg-card p-4 gap-4"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <TermsStatusBadge status={v.status} />
                  <span className="font-medium truncate">{v.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('effectiveFrom', { date: formatDate(v.effectiveFrom) })}
                </p>
              </div>

              {canWrite && (
                <div className="flex items-center gap-2 shrink-0">
                  {v.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => publish(v.version)} disabled={isPublishing}>
                      {isPublishing ? t('publishing') : t('publish')}
                    </Button>
                  )}
                  {v.status === 'PUBLISHED' && (
                    <Button size="sm" variant="outline" onClick={() => setArchiving(v)}>
                      {t('archiveAction')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <>
          <SaveTermsDialog
            open={showSave}
            onOpenChange={(open) => {
              setShowSave(open)
              if (!open) setEditingDraft(null)
            }}
            scope={scope}
            draft={editingDraft ?? undefined}
          />
          <ArchiveDialog
            version={archiving}
            pickedOperatorId={pickedOperatorId}
            onOpenChange={(open) => {
              if (!open) setArchiving(null)
            }}
          />
        </>
      )}
    </div>
  )
}
