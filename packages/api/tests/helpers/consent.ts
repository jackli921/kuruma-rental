import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import { ConsentService } from '../../src/services/consent'
import { ConsentGateService } from '../../src/services/consent-gate'

/**
 * Inert consent gate for booking-route tests that aren't about consent (#877).
 * An empty repo means nothing is published, so `getRequiredReconsents` is always
 * empty and the gate allows every caller. The gate's blocking behavior lives in
 * `booking-consent-gate.test.ts`; everything else gets a pass-through so the
 * create path is exercised unchanged.
 */
export function makeInertConsentGate(): ConsentGateService {
  return new ConsentGateService(new ConsentService(new InMemoryConsentRepository()))
}
