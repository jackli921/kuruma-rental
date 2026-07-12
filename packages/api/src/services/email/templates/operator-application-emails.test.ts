import { describe, expect, test } from 'vitest'
import { renderOperatorApplicationApproved } from './operator-application-approved'
import { renderOperatorApplicationRejected } from './operator-application-rejected'

describe('operator application emails', () => {
  test('approved: subject names the business, body links the welcome route', () => {
    const email = renderOperatorApplicationApproved(
      { businessName: 'Acme', welcomeUrl: 'https://web/en/operator/welcome' },
      'en',
    )
    expect(email.subject).toContain('Acme')
    expect(email.html).toContain('https://web/en/operator/welcome')
    expect(email.text).toContain('https://web/en/operator/welcome')
  })

  test('rejected: body renders the captured reason', () => {
    const email = renderOperatorApplicationRejected(
      { businessName: 'Acme', reason: 'Incomplete license number' },
      'en',
    )
    expect(email.subject).toContain('Acme')
    expect(email.html).toContain('Incomplete license number')
  })
})
