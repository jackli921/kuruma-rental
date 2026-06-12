import { describe, expect, test } from 'vitest'
import { seed } from './seed'
import { seedBookings } from './seed-bookings'

// The DIP seam (#445): the seed modules are now pure libraries — they used to
// call getDb() + process.exit() at module scope, which made them unusable from a
// CI runner that injects a postgres-js client to seed a local container. The
// Neon CLI entries moved to scripts/seed*.ts; seed/seedBookings take the db as an
// argument, so importing them must be side-effect free.
describe('seed injection seam', () => {
  test('exposes seed(db) as a one-argument injectable function', () => {
    expect(typeof seed).toBe('function')
    expect(seed.length).toBe(1)
  })

  test('exposes seedBookings(db) as a one-argument injectable function', () => {
    expect(typeof seedBookings).toBe('function')
    expect(seedBookings.length).toBe(1)
  })
})
