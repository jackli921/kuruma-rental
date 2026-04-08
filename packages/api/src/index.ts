import { Hono } from 'hono'
import health from './routes/health'
import vehicles from './routes/vehicles'
import bookings from './routes/bookings'

const app = new Hono()

app.route('/', health)
app.route('/', vehicles)
app.route('/', bookings)

export default app
