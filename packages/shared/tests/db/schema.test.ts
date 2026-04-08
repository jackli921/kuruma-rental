import { describe, expect, it } from 'vitest'
import { accounts, roleEnum, sessions, users, verificationTokens } from '../../src/db/schema'

describe('schema exports', () => {
  it('exports all table definitions', () => {
    expect(users).toBeDefined()
    expect(accounts).toBeDefined()
    expect(sessions).toBeDefined()
    expect(verificationTokens).toBeDefined()
  })

  it('users table has required columns', () => {
    const columnNames = Object.keys(users)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('role')
    expect(columnNames).toContain('language')
  })

  it('roleEnum contains expected values', () => {
    expect(roleEnum.enumValues).toEqual(['RENTER', 'STAFF', 'ADMIN'])
  })
})
