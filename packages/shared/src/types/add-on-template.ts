/**
 * Add-on template PICKER wire contract (catalog i18n, epic #385).
 *
 * The row shape `GET /add-on-templates` returns: an operator picks a template
 * from this list and the renter later reads its pre-translated name. The
 * platform-owned `name` is a LocalizedText bundle in the DB; the service
 * resolves it to the caller locale, so the wire carries a single `resolvedName`
 * string — never the multi-locale bundle (a picker needs one label, and the
 * bundle is not the operator's to see raw).
 */
export interface AddOnTemplatePickerData {
  id: string
  /** slugify(canonical English name) — the stable join handle to an add-on. */
  key: string
  /** `name` resolved to the caller locale, English fallback. */
  resolvedName: string
}
