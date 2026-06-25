// Shared layout primitives for the #664 lifecycle emails. The simple templates
// (substitution / cancellation / status-update) use the whole-body `renderRowsEmail`;
// the richer ones (renter-confirmation / operator-alert) compose the smaller
// fragments below. Either way the html/text markup lives here once, not per template.
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

/** Bare two-column table of [label, value] rows — no heading. The shared row
 *  markup, so the rich templates never re-spell `<tr><td><strong>…`. */
export function renderRowsTable(rows: Array<[string, string]>): RenderedBody {
  const htmlRows = rows
    .map(([l, v]) => `<tr><td><strong>${escapeHtml(l)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('')
  return {
    html: `<table>${htmlRows}</table>`,
    text: rows.map(([l, v]) => `${l}: ${v}`).join('\n'),
  }
}

/** A heading paragraph + a two-column table of [label, value] rows. */
export function renderRowsEmail(heading: string, rows: Array<[string, string]>): RenderedBody {
  const table = renderRowsTable(rows)
  return {
    html: `<p>${escapeHtml(heading)}</p>${table.html}`,
    text: `${heading}\n\n${table.text}`,
  }
}

/** An optional `<h3>` + bullet-list section (e.g. fees, add-ons). Renders to
 *  empty html/text when there are no lines, so callers append it unconditionally. */
export function renderListSection(title: string, lines: string[]): RenderedBody {
  if (lines.length === 0) return { html: '', text: '' }
  const html = `<h3>${escapeHtml(title)}</h3><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
  return { html, text: `\n\n${title}\n${lines.join('\n')}` }
}

/** An `<h3>` + optional explanatory paragraph + a linked call-to-action button
 *  (e.g. pre-auth handoff, manage-booking deep link). The URL is escaped for the
 *  `href` attribute; callers gate on URL presence before calling. */
export function renderCtaSection(
  title: string,
  url: string,
  cta: string,
  explain?: string,
): RenderedBody {
  const explainHtml = explain ? `<p>${escapeHtml(explain)}</p>` : ''
  const html = `<h3>${escapeHtml(title)}</h3>${explainHtml}<p><a href="${escapeHtml(url)}">${escapeHtml(cta)}</a></p>`
  const explainText = explain ? `\n${explain}` : ''
  return { html, text: `\n\n${title}${explainText}\n${cta}: ${url}` }
}
