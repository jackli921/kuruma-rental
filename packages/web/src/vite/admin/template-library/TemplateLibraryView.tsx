import { Button } from '@/components/ui/button'
import { SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { TemplateCreateDialog } from './TemplateCreateDialog'
import { TemplateEditDialog } from './TemplateEditDialog'
import type { TemplateCatalog } from './api'

const CATALOGS = ['addOns', 'insurance'] as const
type CatalogKey = (typeof CATALOGS)[number]
// Tab key -> the URL path segment the write endpoint uses.
const CATALOG_PATH: Record<CatalogKey, TemplateCatalog> = {
  addOns: 'add-ons',
  insurance: 'insurance',
}

interface TemplateLibraryViewProps {
  readonly addOns: readonly TemplateAdminRow[]
  readonly insurance: readonly TemplateAdminRow[]
}

/**
 * Platform-admin template library (#1319). Two catalogs (add-ons / insurance)
 * behind a tab, each a table of RAW rows — every status, including the ARCHIVED
 * en-only rows the backfill mints. The per-locale translation chips flag an
 * untranslated row at a glance; slice 2's per-row Edit opens {@link TemplateEditDialog}
 * to fix + promote it. Rows arrive as props (the route owns the query); the only
 * local state is the active tab and the row being edited.
 */
export function TemplateLibraryView({ addOns, insurance }: TemplateLibraryViewProps) {
  const t = useTranslations('admin.templateLibrary')
  const [tab, setTab] = useState<CatalogKey>('addOns')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{
    catalog: TemplateCatalog
    row: TemplateAdminRow
  } | null>(null)
  const rowsByTab: Record<CatalogKey, readonly TemplateAdminRow[]> = { addOns, insurance }
  const rows = rowsByTab[tab]
  const head = 'px-3 py-2 text-left font-medium text-muted-foreground'

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="font-semibold text-2xl">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
          {CATALOGS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setTab(c)}
              aria-pressed={tab === c}
              className="rounded-md px-3 py-1.5 font-medium text-sm transition-colors aria-pressed:bg-muted aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted/50"
            >
              {t(`tab.${c}`, { count: rowsByTab[c].length })}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          {t('action.create')}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-border border-b bg-muted/50">
            <tr>
              <th scope="col" className={head}>
                {t('colName')}
              </th>
              <th scope="col" className={head}>
                {t('colKey')}
              </th>
              <th scope="col" className={head}>
                {t('colStatus')}
              </th>
              <th scope="col" className={head}>
                {t('colTranslations')}
              </th>
              <th scope="col" className={head}>
                {t('colActions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-border border-b last:border-0">
                  <td className="px-3 py-3 font-medium">{row.name.en}</td>
                  <td className="px-3 py-3 font-mono text-muted-foreground text-xs">{row.key}</td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      status={row.status}
                      activeLabel={t('active')}
                      archivedLabel={t('archived')}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <TranslationChips row={row} />
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setEditing({ catalog: CATALOG_PATH[tab], row })}
                      aria-label={t('action.editNamed', { name: row.name.en })}
                      className="rounded-md border border-border px-2.5 py-1 font-medium text-xs hover:bg-muted/50"
                    >
                      {t('action.edit')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <TemplateCreateDialog catalog={CATALOG_PATH[tab]} open onOpenChange={setCreating} />
      )}

      {editing && (
        <TemplateEditDialog
          catalog={editing.catalog}
          row={editing.row}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function StatusBadge({
  status,
  activeLabel,
  archivedLabel,
}: {
  status: TemplateAdminRow['status']
  activeLabel: string
  archivedLabel: string
}) {
  const isActive = status === 'ACTIVE'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
        isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
      }`}
    >
      {isActive ? activeLabel : archivedLabel}
    </span>
  )
}

/**
 * One chip per supported locale: filled when the `name` bundle carries that
 * locale, outlined when absent. An en-only backfill-minted row shows `en` filled
 * and `ja` / `zh` outlined — the visual cue that it still needs translation.
 */
function TranslationChips({ row }: { row: TemplateAdminRow }) {
  return (
    <div className="flex gap-1">
      {SUPPORTED_LOCALES.map((locale) => {
        const present = Boolean(row.name[locale])
        return (
          <span
            key={locale}
            className={`inline-flex rounded px-1.5 py-0.5 text-xs uppercase ${
              present
                ? 'bg-primary/10 text-primary'
                : 'border border-dashed border-border text-muted-foreground/60'
            }`}
          >
            {locale}
          </span>
        )
      })}
    </div>
  )
}
