import { type CryptoKey, SignJWT, exportJWK, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { verifyGoogleIdToken } from '../../src/auth/google'

// #1055: identity must rest on Google's SIGNED id_token, not an unsigned /userinfo
// read. This is the verification core — every claim that closes the OIDC chain
// (signature, aud, iss, exp, and our per-flow nonce) is asserted here against
// locally-minted tokens, because crypto that isn't tested is crypto you don't trust.

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const NONCE = 'flow-nonce-abc'

let privateKey: CryptoKey
let publicKey: CryptoKey
let otherPublicKey: CryptoKey

beforeAll(async () => {
  const kp = await generateKeyPair('RS256') // Google signs id_tokens with RS256
  privateKey = kp.privateKey
  publicKey = kp.publicKey
  otherPublicKey = (await generateKeyPair('RS256')).publicKey
  void exportJWK // keep import available for future JWKS-shaped tests
})

interface IdClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  nonce?: string
}

function mintIdToken(
  claims: IdClaims,
  opts: { issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.issuer ?? 'https://accounts.google.com')
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(privateKey)
}

const validClaims: IdClaims = {
  sub: 'google-sub-001',
  email: 'renter@example.com',
  email_verified: true,
  name: 'Test Renter',
  picture: 'https://lh3.googleusercontent.com/a/pic',
  nonce: NONCE,
}

describe('verifyGoogleIdToken (#1055)', () => {
  it('returns the verified profile for a well-formed token', async () => {
    const token = await mintIdToken(validClaims)
    const profile = await verifyGoogleIdToken(token, publicKey, {
      clientId: CLIENT_ID,
      nonce: NONCE,
    })
    expect(profile).toEqual({
      sub: 'google-sub-001',
      email: 'renter@example.com',
      email_verified: true,
      name: 'Test Renter',
      picture: 'https://lh3.googleusercontent.com/a/pic',
    })
  })

  it('rejects a token whose nonce does not match this flow (replay defence)', async () => {
    const token = await mintIdToken({ ...validClaims, nonce: 'some-other-flow-nonce' })
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow(/nonce/i)
  })

  it('rejects a token carrying no nonce claim at all', async () => {
    const { nonce: _omit, ...noNonce } = validClaims
    const token = await mintIdToken(noNonce)
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow(/nonce/i)
  })

  it('rejects a token minted for a different client (aud mismatch)', async () => {
    const token = await mintIdToken(validClaims, {
      audience: 'attacker.apps.googleusercontent.com',
    })
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow()
  })

  it('rejects a token from an unexpected issuer', async () => {
    const token = await mintIdToken(validClaims, { issuer: 'https://evil.example.com' })
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const token = await mintIdToken(validClaims, { expiresIn: '-1m' })
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow()
  })

  it('accepts a token expired within the clock-tolerance window (CF↔Google drift)', async () => {
    const token = await mintIdToken(validClaims, { expiresIn: '-10s' })
    const profile = await verifyGoogleIdToken(token, publicKey, {
      clientId: CLIENT_ID,
      nonce: NONCE,
    })
    expect(profile.sub).toBe('google-sub-001')
  })

  it('rejects a token signed by a key outside the trusted JWKS (forged signature)', async () => {
    const token = await mintIdToken(validClaims)
    await expect(
      verifyGoogleIdToken(token, otherPublicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow()
  })

  it('rejects a token with no sub claim', async () => {
    const { sub: _omit, ...noSub } = validClaims
    const token = await mintIdToken(noSub)
    await expect(
      verifyGoogleIdToken(token, publicKey, { clientId: CLIENT_ID, nonce: NONCE }),
    ).rejects.toThrow(/sub/i)
  })

  it('keeps optional profile fields absent rather than undefined (exactOptionalPropertyTypes)', async () => {
    const token = await mintIdToken({ sub: 'google-sub-002', nonce: NONCE })
    const profile = await verifyGoogleIdToken(token, publicKey, {
      clientId: CLIENT_ID,
      nonce: NONCE,
    })
    expect(profile).toEqual({ sub: 'google-sub-002' })
    expect('email' in profile).toBe(false)
  })
})
