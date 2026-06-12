import { describe, expect, test } from 'bun:test'
import { pgConnectOptions } from './pg-connect-options'

// The whole reason this helper exists: a GitHub `postgres:16` service container
// speaks plaintext on localhost, so the harness's hard-coded `ssl: 'require'`
// would refuse to connect. Remote (Neon) hosts must still get TLS.
describe('pgConnectOptions', () => {
  test('disables TLS for a localhost container (plaintext postgres:16)', () => {
    const opts = pgConnectOptions('postgresql://kuruma:kuruma@localhost:5432/kuruma_test')
    expect(opts.ssl).toBe(false)
    expect(opts).toMatchObject({
      host: 'localhost',
      port: 5432,
      database: 'kuruma_test',
      username: 'kuruma',
      password: 'kuruma',
    })
  })

  test('disables TLS for 127.0.0.1 too', () => {
    expect(pgConnectOptions('postgresql://u:p@127.0.0.1:5432/db').ssl).toBe(false)
  })

  test('requires TLS for a remote Neon host', () => {
    const opts = pgConnectOptions('postgresql://owner:secret@ep-cool-pooler.eu.neon.tech/maindb')
    expect(opts.ssl).toBe('require')
    expect(opts.host).toBe('ep-cool-pooler.eu.neon.tech')
  })

  test('defaults the port to 5432 when the URL omits it', () => {
    expect(pgConnectOptions('postgresql://u:p@ep-x.neon.tech/db').port).toBe(5432)
  })

  test('url-decodes credentials and drops libpq-only query params', () => {
    const opts = pgConnectOptions(
      'postgresql://us%40er:p%3Ass@ep-x.neon.tech/db?channel_binding=require',
    )
    expect(opts.username).toBe('us@er')
    expect(opts.password).toBe('p:ss')
    expect(opts).not.toHaveProperty('channel_binding')
  })
})
