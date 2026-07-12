import { type RenderedEmail, renderCtaSection, renderRowsEmail } from './layout'
import { emailStrings } from './messages'

export interface OperatorApplicationApprovedData {
  businessName: string
  welcomeUrl: string
}

export function renderOperatorApplicationApproved(
  data: OperatorApplicationApprovedData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const body = renderRowsEmail(m.operatorApplicationApprovedHeading, [
    [m.operatorApplicationBusinessLabel, data.businessName],
  ])
  // The welcome link is the whole point of this email, so it must be clickable —
  // a plain row value renders as unlinked text. renderCtaSection wraps it in an
  // <a> (and keeps the raw URL in the text/plain part), matching operator-alert.ts.
  const cta = renderCtaSection(
    m.operatorApplicationWelcomeLabel,
    data.welcomeUrl,
    m.operatorApplicationWelcomeLabel,
  )
  return {
    subject: `${m.operatorApplicationApprovedSubject} ${data.businessName}`,
    html: body.html + cta.html,
    text: body.text + cta.text,
  }
}
