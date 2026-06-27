import type { TransactionRepos } from '../repositories/types'

export type OperatorDeactivatedRejection = {
  ok: false
  status: 409
  error: string
  code: 'OPERATOR_DEACTIVATED'
}

/**
 * #1206: a soft-deactivated operator (`operators.deactivatedAt` set) stops taking
 * NEW bookings — existing bookings/history are untouched. Loaded in-tx (so the
 * reactivation path, `deactivatedAt -> null`, re-allows on the same snapshot) by
 * BOTH create paths: SPECIFIC keys the operator off the vehicle, CLASS_COMBO off
 * the pickup location. A missing operator is treated as not-bookable too (defence
 * in depth; `operatorId` always comes from a vehicle/location row that FKs operators).
 */
export async function rejectIfOperatorDeactivated(
  repos: TransactionRepos,
  operatorId: string,
): Promise<OperatorDeactivatedRejection | null> {
  const operator = await repos.operatorRepo.findById(operatorId)
  if (!operator || operator.deactivatedAt != null) {
    return {
      ok: false,
      status: 409,
      error: 'Operator is not accepting new bookings',
      code: 'OPERATOR_DEACTIVATED',
    }
  }
  return null
}
