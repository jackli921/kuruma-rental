import { type RenderedEmail, renderCtaSection, renderRowsEmail } from './layout'
import { emailStrings } from './messages'

/**
 * #1205 slice 4: operator-facing alert that a renter opened a new unread window in
 * a booking thread (the operator-unread 0->1 transition). Operator-first locale
 * (ja default, §12.2), like the booking alert. Carries the renter's name plus a
 * deep link straight to the conversation; `manageUrl` is null when WEB_ORIGIN is
 * unset, in which case the CTA is omitted and the email still alerts (mirrors the
 * operator-alert / review-prompt deep-link gating). Booking detail is intentionally
 * omitted — the operator opens the thread to act (KISS).
 */
export interface OperatorNewMessageData {
  renterName: string | null
  manageUrl: string | null
}

export function renderOperatorNewMessage(
  data: OperatorNewMessageData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [[m.renterLabel, data.renterName ?? '—']]
  const body = renderRowsEmail(m.newMessageHeading, rows)
  const cta = data.manageUrl
    ? renderCtaSection(m.newMessageCtaTitle, data.manageUrl, m.newMessageCta)
    : { html: '', text: '' }
  return {
    subject: m.newMessageSubject,
    html: `${body.html}${cta.html}`,
    text: `${body.text}${cta.text}`,
  }
}
