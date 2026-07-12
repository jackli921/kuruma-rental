import { type RenderedEmail, renderRowsEmail } from './layout'
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
  const rows: Array<[string, string]> = [
    [m.operatorApplicationBusinessLabel, data.businessName],
    [m.operatorApplicationWelcomeLabel, data.welcomeUrl],
  ]
  return {
    subject: `${m.operatorApplicationApprovedSubject} ${data.businessName}`,
    ...renderRowsEmail(m.operatorApplicationApprovedHeading, rows),
  }
}
