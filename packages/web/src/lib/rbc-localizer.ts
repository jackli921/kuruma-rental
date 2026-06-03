import { type Locale, format, getDay, parse, startOfWeek } from 'date-fns'
import { enUS, ja, zhCN } from 'date-fns/locale'
import { dateFnsLocalizer } from 'react-big-calendar'

const LOCALE_MAP: Record<string, Locale> = {
  en: enUS,
  ja: ja,
  zh: zhCN,
}

export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: LOCALE_MAP,
})
