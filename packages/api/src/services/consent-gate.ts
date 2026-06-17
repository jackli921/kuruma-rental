import type { ConsentType } from '@kuruma/shared/enums'

/** The slice of ConsentService the gate needs (ISP — depend on the narrow shape). */
export interface ReconsentQuery {
  getRequiredReconsents(userId: string, role: string, now: Date): Promise<ConsentType[]>
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; code: 'CONSENT_REQUIRED'; status: 403; missing: ConsentType[] }

export class ConsentGateService {
  constructor(private readonly consent: ReconsentQuery) {}

  async assertSubjectCurrent(userId: string, role: string, now: Date): Promise<GateDecision> {
    const missing = await this.consent.getRequiredReconsents(userId, role, now)
    if (missing.length === 0) return { allowed: true }
    return { allowed: false, code: 'CONSENT_REQUIRED', status: 403, missing }
  }
}
