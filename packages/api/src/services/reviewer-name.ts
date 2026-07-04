/**
 * Derive a public, display-safe FIRST name from the single OAuth `users.name` (#1450).
 *
 * Privacy boundary: the public review list is anonymous (the epic non-goal forbids public
 * renter profiles), so only the FIRST whitespace-delimited token may ever be surfaced — the
 * remainder of the name is PII that must not reach the wire. `null` when there is no usable
 * token (absent, empty, or whitespace-only name) so the render tier falls back to the
 * anonymous "Verified renter" label.
 *
 * Limitation: the OAuth name has no structured given/family split, so for "Family Given"
 * ordering (e.g. Japanese) the first token is the family name. Accepted — it still exposes
 * strictly less than the full name, which is the property that matters here.
 */
export function toReviewerFirstName(fullName: string | null): string | null {
  if (fullName === null) return null
  const [firstToken] = fullName.trim().split(/\s+/)
  return firstToken ? firstToken : null
}
