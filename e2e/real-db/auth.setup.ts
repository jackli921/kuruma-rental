import { test as setup } from '@playwright/test'
import { STORAGE_STATE } from './constants'
import { SESSION_COOKIE_NAME, mintOperatorSessionToken } from './mint-session'

const ONE_HOUR_S = 60 * 60

setup('mint operator session cookie', async ({ context }) => {
  const value = await mintOperatorSessionToken()
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
    },
  ])
  await context.storageState({ path: STORAGE_STATE })
})
