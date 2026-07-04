import type { Locale } from '@kuruma/shared/i18n/locales'
import { resolveLocalized } from '@kuruma/shared/i18n/localized-text'
import type { AddOnTemplatePickerData } from '@kuruma/shared/types/add-on-template'
import type { AddOnRepository, AddOnTemplateRepository } from '../repositories/types'

/**
 * Reads the platform-owned add-on template catalog for the operator picker.
 * Pure read: no ctx (the catalog is global, not tenant-scoped) and no Result
 * wrapper. Each row's LocalizedText name is resolved to the caller locale here,
 * at the boundary, so the wire carries one label and the multi-locale bundle
 * never escapes the service.
 *
 * P1-3: when a target operator is named, the picker EXCLUDES templates that
 * operator already offers on an ACTIVE add-on, so it cannot pick a duplicate and
 * hit the create 409. The exclusion is the ONE place a template read is scoped by
 * an operator's own rows (templates themselves are platform-global) — the
 * AddOnRepository read is single-operator + ACTIVE-only, never a cross-tenant
 * enumeration.
 */
export class AddOnTemplateService {
  // #1437: the SHARED_CATALOG kill-switch. Defaults to ON, mirroring the registry
  // serverDefault (and the whole feature's fail-OPEN stance) so existing callers and
  // tests need no change; the composition root injects the real flag-backed thunk.
  constructor(
    private readonly repo: AddOnTemplateRepository,
    private readonly addOnRepo: AddOnRepository,
    private readonly isSharedCatalogEnabled: () => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  async listForPicker(
    locale: Locale,
    excludeOfferedByOperatorId?: string,
  ): Promise<AddOnTemplatePickerData[]> {
    // Kill-switch: when the shared catalog is off, the operator picker shows nothing
    // (they must self-author). Existing picked items still resolve elsewhere - only
    // the picker read is gated here.
    if (!(await this.isSharedCatalogEnabled())) return []

    const templates = await this.repo.findActive()
    const offered = excludeOfferedByOperatorId
      ? await this.offeredTemplateIds(excludeOfferedByOperatorId)
      : undefined

    // Explicit `locale` on localeCompare: the default collator reads the host's
    // ICU, which differs between Bun (tests) and workerd (prod) — the #1216
    // Bun-vs-workerd Intl divergence. Pinning the locale keeps ja/zh picker order
    // deterministic across runtimes instead of silently reordering in prod.
    return templates
      .filter((t) => !offered?.has(t.id))
      .map((t) => ({ id: t.id, key: t.key, resolvedName: resolveLocalized(t.name, locale) }))
      .sort((a, b) => a.resolvedName.localeCompare(b.resolvedName, locale))
  }

  private async offeredTemplateIds(operatorId: string): Promise<Set<string>> {
    const active = await this.addOnRepo.findActiveByOperator(operatorId)
    // Legacy null-templateId rows offer no template to exclude; drop them.
    return new Set(active.map((a) => a.templateId).filter((id): id is string => id !== null))
  }
}
