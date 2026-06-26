import { z } from 'zod'
import { PAYMENT_ANOMALY_RESOLUTIONS } from '../types/payment-anomaly'

/** Body of `POST /admin/payment-anomalies/:id/resolve` (#1075 slice 3). The admin
 *  tags WHY the flagged charge is closed plus an optional note — NO money fields,
 *  v1 only clears the review queue. `.strict()` rejects any foreign key (a drifted
 *  or injected field) outright rather than silently dropping it, so the network
 *  seam can never carry, say, an `amountJpy` into a slice that moves no money. */
export const resolvePaymentAnomalySchema = z
  .object({
    resolution: z.enum(PAYMENT_ANOMALY_RESOLUTIONS),
    note: z.string().max(1000).optional(),
  })
  .strict()

export type ResolvePaymentAnomalyBody = z.infer<typeof resolvePaymentAnomalySchema>
