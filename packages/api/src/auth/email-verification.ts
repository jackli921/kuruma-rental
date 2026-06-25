/**
 * When a Google OIDC sign-in first creates a `users` row, record WHETHER Google
 * asserted the email as verified — instead of hard-coding `emailVerified: null`
 * for everyone (the old behaviour, which threw away a security-relevant signal).
 *
 * Returns the verification instant (`now`) only when Google's `email_verified`
 * claim is strictly `true`; an absent or `false` claim records `null`. Matching
 * the strict `=== true` check the provider-grant path already uses
 * (services/operator-grant.ts) keeps "is this email trustworthy?" answered the
 * same way everywhere. Pure (the clock is passed in) so the decision is testable
 * without a DB or a real wall clock — the I/O write stays in the account store.
 */
export function emailVerifiedAt(verified: boolean | undefined, now: Date): Date | null {
  return verified === true ? now : null
}
