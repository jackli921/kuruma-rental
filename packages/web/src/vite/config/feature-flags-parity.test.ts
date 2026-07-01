import { FEATURE_FLAGS, FEATURE_FLAG_KEYS } from '@kuruma/shared/feature-flags/registry'
import { describe, expect, it } from 'vitest'
import viteEnvSource from '../vite-env.d.ts?raw'

// Guards drift between the shared runtime registry and the build-time env
// declarations: a new VITE_FEATURE_* flag that skips the registry (or a registry
// entry pointing at an undeclared env) fails CI here.
describe('feature-flag registry <-> vite-env.d.ts parity', () => {
  const declared = [...viteEnvSource.matchAll(/VITE_FEATURE_[A-Z_]+/g)]
    .map((m) => m[0])
    .filter((s): s is string => Boolean(s))
  const declaredSet = new Set(declared)
  const registryEnvs = FEATURE_FLAG_KEYS.map((k) => FEATURE_FLAGS[k].env)

  it('every VITE_FEATURE_ env declared in vite-env.d.ts has a registry entry', () => {
    for (const env of declaredSet) {
      expect(registryEnvs).toContain(env)
    }
  })

  it('every registered env is declared in vite-env.d.ts', () => {
    for (const env of registryEnvs) {
      expect(declaredSet.has(env)).toBe(true)
    }
  })
})
