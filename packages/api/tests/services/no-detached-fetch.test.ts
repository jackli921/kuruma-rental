import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// #887 recurrence guard. On CF Workers the global `fetch` is a branded builtin
// that throws "Illegal invocation" unless called with `this === globalThis`.
// Services here capture fetch as a class field and call it as `this.fetchFn(...)`,
// so the constructor default MUST be `fetch.bind(globalThis)`, never a bare
// `= fetch`. The bare form silently broke ALL outbound email in prod (every
// notification_log row FAILED) and passed CI because node/vitest don't brand
// fetch. This guard bans the bare pattern recurring anywhere under api/src.
const SRC = join(fileURLToPath(import.meta.url), '../../../src')

// `typeof fetch = fetch` NOT immediately followed by `.bind`. Allows the fix
// (`= fetch.bind(globalThis)`) while flagging the footgun (`= fetch,`).
const BARE_FETCH_DEFAULT = /typeof fetch\s*=\s*fetch(?!\.bind)/

describe('no detached global fetch (#887)', () => {
  it('no source file captures the default `fetch` without binding it to globalThis', () => {
    const offenders = readdirSync(SRC, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'))
      .filter((file) => BARE_FETCH_DEFAULT.test(readFileSync(join(SRC, file), 'utf8')))

    expect(offenders).toEqual([])
  })
})
