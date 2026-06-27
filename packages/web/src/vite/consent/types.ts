import type { ConsentType } from '@kuruma/shared/enums'

/** The presentation slice of a consent document the gate renders — the localized
 *  copy resolved server-side. Mirrors the API's `ConsentDocument`, narrowed to
 *  the fields the clickwrap shows; the wire's extra columns are stripped at the
 *  validation seam (see `api.ts`). */
export interface ConsentDocumentView {
  id: string
  title: string
  body: string
  acceptanceLabel: string
}

/** One outstanding consent: the type owed and the document to present for it. */
export interface PendingConsent {
  type: ConsentType
  document: ConsentDocumentView
}
