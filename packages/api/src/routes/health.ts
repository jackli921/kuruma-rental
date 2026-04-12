import { Hono } from 'hono'

export default new Hono().get('/health', (c) => {
  return c.json({ status: 'ok' })
})
