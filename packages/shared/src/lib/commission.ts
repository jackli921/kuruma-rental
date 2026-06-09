/**
 * Platform commission math for the marketplace (proposal §9 item 16, 2026-06-05
 * scope addendum §2). The renter pays the sticker price; the platform retains a
 * flat percentage and remits the rest to the partner operator at month-end.
 *
 * JPY is a zero-decimal currency, so every figure is whole yen. The fee is
 * rounded and the net is `gross - fee` (never rounded independently) so the two
 * always sum back to the gross — no yen is created or lost to rounding.
 */

/** Platform fee as basis points (1 bp = 0.01%). 400 bp = 4%. Single source of
 *  truth — the #462 revenue tab reuses this exact figure. */
export const PLATFORM_FEE_BPS = 400

const BPS_DIVISOR = 10_000

export interface PlatformCommission {
  /** Whole-yen platform fee retained from the gross (4% of gross, rounded). */
  platformFeeJpy: number
  /** Whole-yen amount remitted to the partner operator: gross − fee. */
  netToPartnerJpy: number
}

/**
 * Split a gross JPY amount (what the renter paid via Stripe) into the platform
 * fee and the partner's net payout. Invariant: `platformFeeJpy + netToPartnerJpy
 * === grossJpy` for every non-negative integer input.
 */
export function computePlatformCommission(grossJpy: number): PlatformCommission {
  const platformFeeJpy = Math.round((grossJpy * PLATFORM_FEE_BPS) / BPS_DIVISOR)
  return { platformFeeJpy, netToPartnerJpy: grossJpy - platformFeeJpy }
}
