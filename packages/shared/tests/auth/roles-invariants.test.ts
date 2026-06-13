import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_ROLES } from '../../src/auth/roles'
import { roleEnum } from '../../src/db/schema'

const sorted = (s: ReadonlySet<string>): string[] => [...s].sort()

// Cross-cutting invariants that protect the canonical role model beyond its fixed
// membership (which roles.test.ts already pins). These live in a separate file so
// roles.test.ts stays a pure, dependency-free characterization of roles.ts.
describe('auth/roles invariants', () => {
  // #685: roles.ts is re-exported into the Next edge middleware via the
  // @kuruma/shared/auth/roles subpath. A single `import` there (drizzle / jose /
  // node:crypto) silently re-couples the CF Pages edge bundle and only surfaces as
  // a deploy failure. Pin the zero-import invariant statically so it can't regress.
  it('roles.ts contains zero imports/requires (edge-safety invariant — #685)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/auth/roles.ts', import.meta.url)),
      'utf8',
    )
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments (prose says "import")
      .replace(/\/\/.*$/gm, '') // strip line comments
    expect(codeOnly).not.toMatch(/^\s*import[\s{*'"]/m) // static import
    expect(codeOnly).not.toMatch(/\bimport\s*\(/) // dynamic import()
    expect(codeOnly).not.toMatch(/\brequire\s*\(/) // CommonJS require()
  })

  // The DB roleEnum is the persistence mirror; the authz model adds exactly one
  // role the DB never stores: PARTNER (Trip.com partner). If a role is added to
  // either side without the other, the single-source model has drifted (#387) —
  // this fails on that drift instead of letting it reach production auth gates.
  it('ALL_ROLES = the DB roleEnum plus the authz-only PARTNER role', () => {
    expect(sorted(ALL_ROLES)).toEqual([...roleEnum.enumValues, 'PARTNER'].sort())
  })
})
