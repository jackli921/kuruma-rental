import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentRepository } from '../repositories/types-consent'
import type { ConsentAcceptance } from '../stores'
import { type ConsentVerification, verifyAcceptance } from './consent-evidence-verify'
import type { SigningKey } from './consent-signing'

export interface ConsentEvidence {
  acceptance: Pick<
    ConsentAcceptance,
    | 'id'
    | 'userId'
    | 'actorRole'
    | 'documentId'
    | 'consentType'
    | 'operatorId'
    | 'operatorMembershipId'
    | 'bookingId'
    | 'acceptedAt'
    | 'method'
    | 'ipAddress'
    | 'userAgent'
  >
  document: DocumentSnapshot | null
  signature: {
    recordSignature: string | null
    signingKeyId: string | null
    signatureCanonicalVersion: string | null
  }
  verification: ConsentVerification
}

export class ConsentEvidenceService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly getKey: (keyId: string) => SigningKey | undefined,
  ) {}

  private toEvidence(a: ConsentAcceptance): ConsentEvidence {
    return {
      acceptance: {
        id: a.id,
        userId: a.userId,
        actorRole: a.actorRole,
        documentId: a.documentId,
        consentType: a.consentType,
        operatorId: a.operatorId,
        operatorMembershipId: a.operatorMembershipId,
        bookingId: a.bookingId,
        acceptedAt: a.acceptedAt,
        method: a.method,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      },
      document: a.documentSnapshot,
      signature: {
        recordSignature: a.recordSignature,
        signingKeyId: a.signingKeyId,
        signatureCanonicalVersion: a.signatureCanonicalVersion,
      },
      verification: verifyAcceptance(a, this.getKey),
    }
  }

  async getConsentEvidence(acceptanceId: string): Promise<ConsentEvidence | undefined> {
    const a = await this.repo.findAcceptanceById(acceptanceId)
    return a ? this.toEvidence(a) : undefined
  }

  async getConsentEvidenceForUser(userId: string): Promise<ConsentEvidence[]> {
    return (await this.repo.findAcceptancesByUser(userId)).map((a) => this.toEvidence(a))
  }

  async getConsentEvidenceForBooking(bookingId: string): Promise<ConsentEvidence[]> {
    return (await this.repo.findAcceptancesByBooking(bookingId)).map((a) => this.toEvidence(a))
  }
}
