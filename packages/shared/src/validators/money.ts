import { z } from 'zod'

/**
 * The whole-yen, non-negative money rule shared by every JPY amount field
 * (vehicle rates, fee amounts, add-on prices, insurance deductibles). Zero is a
 * valid value — a free promo or a waived fee — while fractional yen and
 * negatives are not. `label` names the field so the error reads naturally where
 * a form renders it ("Rate must be a whole yen amount"), replacing the four
 * hand-written copies that had drifted to four different error strings (#1381).
 *
 * JPY is zero-decimal, so amounts are whole integers end to end (no ×100). The
 * inferred type stays `number` — this is deliberately NOT branded, so every
 * existing api/web consumer is unaffected. The full `.brand<'Jpy'>()` (which
 * would ripple into every consumer's types) is out of scope for this dedupe.
 */
export function jpyAmount(label: string): z.ZodNumber {
  return z.number().int(`${label} must be a whole yen amount`).min(0, `${label} cannot be negative`)
}
