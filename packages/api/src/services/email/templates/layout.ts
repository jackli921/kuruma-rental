// Shared layout for the simple lifecycle emails (#664): a heading followed by a
// labeled-rows table. Keeps the substitution / cancellation / status-update
// renderers to just their row data — the html/text boilerplate lives here once.
import { escapeHtml } from './format'

export interface RenderedBody {
  html: string
  text: string
}

/** A fully rendered email: a subject line plus the body. */
export interface RenderedEmail extends RenderedBody {
  subject: string
}

/** "Name (PLATE)" when a plate is present, else just the name. */
export function vehicleLabel(v: { name: string; licensePlate: string | null }): string {
  return v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name
}

/** A heading paragraph + a two-column table of [label, value] rows. */
export function renderRowsEmail(heading: string, rows: Array<[string, string]>): RenderedBody {
  const htmlRows = rows
    .map(([l, v]) => `<tr><td><strong>${escapeHtml(l)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('')
  const html = `<p>${escapeHtml(heading)}</p><table>${htmlRows}</table>`
  const text = `${heading}\n\n${rows.map(([l, v]) => `${l}: ${v}`).join('\n')}`
  return { html, text }
}
