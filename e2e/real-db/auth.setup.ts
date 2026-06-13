import type { BrowserContext } from '@playwright/test'
import { test as setup } from '@playwright/test'
import { ADMIN_STORAGE_STATE, RENTER_STORAGE_STATE, STORAGE_STATE } from './constants'
import {
  SESSION_COOKIE_NAME,
  mintAdminSessionToken,
  mintOperatorSessionToken,
  mintRenterSessionToken,
} from './mint-session'

const ONE_HOUR_S = 60 * 60

async function saveSession(
  context: BrowserContext,
  value: string,
  storageStatePath: string,
): Promise<void> {
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
  await context.storageState({ path: storageStatePath })
}

setup('mint operator session cookie', async ({ context }) => {
  await saveSession(context, await mintOperatorSessionToken(), STORAGE_STATE)
})

setup('mint renter session cookie', async ({ context }) => {
  await saveSession(context, await mintRenterSessionToken(), RENTER_STORAGE_STATE)
})

setup('mint platform-admin session cookie', async ({ context }) => {
  await saveSession(context, await mintAdminSessionToken(), ADMIN_STORAGE_STATE)
})
