import { type RenderedEmail, renderRowsEmail } from './layout'
import { emailStrings } from './messages'

export interface OperatorApplicationRejectedData {
  businessName: string
  reason: string
}

export function renderOperatorApplicationRejected(
  data: OperatorApplicationRejectedData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.operatorApplicationBusinessLabel, data.businessName],
    [m.operatorApplicationReasonLabel, data.reason],
  ]
  return {
    subject: `${m.operatorApplicationRejectedSubject} ${data.businessName}`,
    ...renderRowsEmail(m.operatorApplicationRejectedHeading, rows),
  }
}
