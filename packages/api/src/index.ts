import { Hono } from 'hono'
import availability from './routes/availability'
import bookings from './routes/bookings'
import health from './routes/health'
import vehicles from './routes/vehicles'

const app = new Hono()

app.route('/', health)
app.route('/', vehicles)
app.route('/', bookings)
app.route('/', availability)

export type AppType = typeof app

export default app
