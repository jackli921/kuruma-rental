import { seedId } from '@kuruma/shared/db/seed-id'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// #1318 MEDIUM-3: the service unit tests inject a fake translator, so they cannot
// catch a composition-root regression (a no-op translator wired by mistake, or the
// create path never invoking it). This boots the REAL app — no API key, so the dev
// stub fills `[<locale>] <text>` — and asserts a self-authored create is MT-filled.
describe('add-on description MT is wired into the composed app (#1318)', () => {
  it('fills ja/zh for a self-authored description via the real translator', async () => {
    setupAuthEnv()
    const app = await createApp({})
    const res = await app.request('/add-ons', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nameI18n: { en: 'Fast wifi' },
        descriptionOverride: { en: 'Pocket wifi router' },
        priceJpy: 500,
        operatorId: seedId('op_mt_wiring'),
      }),
    })
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: { descriptionOverride: Record<string, string> } }
    expect(data.descriptionOverride).toEqual({
      en: 'Pocket wifi router',
      ja: '[ja] Pocket wifi router',
      zh: '[zh] Pocket wifi router',
    })
  })
})
