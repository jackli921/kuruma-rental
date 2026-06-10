import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  uploadDocumentSchema,
  verifyDocumentSchema,
} from '../../src/validators/document'

describe('document constants', () => {
  it('exposes the IDP + PASSPORT document types', () => {
    expect(DOCUMENT_TYPES).toEqual(['IDP', 'PASSPORT'])
  })

  it('exposes the PENDING/APPROVED/REJECTED statuses', () => {
    expect(DOCUMENT_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })

  it('allows only jpeg/png/webp images', () => {
    expect(DOCUMENT_ALLOWED_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('caps uploads at 10 MiB', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('uploadDocumentSchema', () => {
  it('accepts type IDP', () => {
    expect(uploadDocumentSchema.safeParse({ type: 'IDP' }).success).toBe(true)
  })

  it('accepts type PASSPORT', () => {
    expect(uploadDocumentSchema.safeParse({ type: 'PASSPORT' }).success).toBe(true)
  })

  it('rejects an unknown document type', () => {
    expect(uploadDocumentSchema.safeParse({ type: 'DRIVERS_LICENSE' }).success).toBe(false)
  })

  it('rejects a missing type', () => {
    expect(uploadDocumentSchema.safeParse({}).success).toBe(false)
  })
})

describe('verifyDocumentSchema', () => {
  it('accepts APPROVED with an expiry date', () => {
    const result = verifyDocumentSchema.safeParse({ status: 'APPROVED', expiryDate: '2030-01-31' })
    expect(result.success).toBe(true)
  })

  it('accepts REJECTED with a rejection reason', () => {
    const result = verifyDocumentSchema.safeParse({
      status: 'REJECTED',
      rejectionReason: 'Blurry photo',
    })
    expect(result.success).toBe(true)
  })

  it('rejects APPROVED without an expiry date (error on expiryDate)', () => {
    const result = verifyDocumentSchema.safeParse({ status: 'APPROVED' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['expiryDate'])
      expect(result.error.issues[0]?.message).toBe('Expiry date is required to approve a document')
    }
  })

  it('rejects REJECTED without a reason (error on rejectionReason)', () => {
    const result = verifyDocumentSchema.safeParse({ status: 'REJECTED' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['rejectionReason'])
      expect(result.error.issues[0]?.message).toBe(
        'A rejection reason is required to reject a document',
      )
    }
  })

  it('rejects REJECTED with a blank reason', () => {
    const result = verifyDocumentSchema.safeParse({ status: 'REJECTED', rejectionReason: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a PENDING verdict (verify must be terminal)', () => {
    expect(verifyDocumentSchema.safeParse({ status: 'PENDING' }).success).toBe(false)
  })

  it('rejects a malformed expiry date', () => {
    const result = verifyDocumentSchema.safeParse({ status: 'APPROVED', expiryDate: '31-01-2030' })
    expect(result.success).toBe(false)
  })
})
