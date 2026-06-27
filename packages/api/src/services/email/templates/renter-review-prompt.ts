import { formatDateTime } from './format'
import { type RenderedEmail, renderCtaSection, renderRowsEmail } from './layout'
import { emailStrings } from './messages'

/**
 * #1083 post-trip review prompt. Fired on the COMPLETED trigger alongside the
 * trip-completed notice (distinct kind so the idempotency key never collides).
 * Snapshot-only — booking code + rental period + a deep link back to the renter's
 * My Bookings review form; it reads no booking relations (RELATIONS_BY_KIND set is
 * empty). `reviewUrl` is null when WEB_ORIGIN is unset; the email still sends, just
 * without the CTA, mirroring the operator-alert deep-link gating.
 */
export interface RenterReviewPromptData {
  bookingCode: string
  startAt: Date
  endAt: Date
  reviewUrl: string | null
}

export function renderRenterReviewPrompt(
  data: RenterReviewPromptData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.periodLabel, `${formatDateTime(data.startAt)} – ${formatDateTime(data.endAt)}`],
  ]
  const body = renderRowsEmail(m.reviewPromptHeading, rows)
  const cta = data.reviewUrl
    ? renderCtaSection(
        m.reviewPromptTitle,
        data.reviewUrl,
        m.reviewPromptCta,
        m.reviewPromptExplain,
      )
    : { html: '', text: '' }
  return {
    subject: `${m.reviewPromptSubject} ${data.bookingCode}`,
    html: `${body.html}${cta.html}`,
    text: `${body.text}${cta.text}`,
  }
}
