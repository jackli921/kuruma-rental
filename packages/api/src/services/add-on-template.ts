import type { Locale } from '@kuruma/shared/i18n/locales'
import { resolveLocalized } from '@kuruma/shared/i18n/localized-text'
import type { AddOnTemplatePickerData } from '@kuruma/shared/types/add-on-template'
import type { AddOnTemplateRepository } from '../repositories/types'

/**
 * Reads the platform-owned add-on template catalog for the operator picker.
 * Pure read: no ctx (the catalog is global, not tenant-scoped) and no Result
 * wrapper. Each row's LocalizedText name is resolved to the caller locale here,
 * at the boundary, so the wire carries one label and the multi-locale bundle
 * never escapes the service.
 */
export class AddOnTemplateService {
  constructor(private readonly repo: AddOnTemplateRepository) {}

  async listForPicker(locale: Locale): Promise<AddOnTemplatePickerData[]> {
    const templates = await this.repo.findActive()
    // Explicit `locale` on localeCompare: the default collator reads the host's
    // ICU, which differs between Bun (tests) and workerd (prod) — the #1216
    // Bun-vs-workerd Intl divergence. Pinning the locale keeps ja/zh picker order
    // deterministic across runtimes instead of silently reordering in prod.
    return templates
      .map((t) => ({ id: t.id, key: t.key, resolvedName: resolveLocalized(t.name, locale) }))
      .sort((a, b) => a.resolvedName.localeCompare(b.resolvedName, locale))
  }
}
