import { buildMarketHolidays } from './calendar.js'

const ny = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const parts = (at: number) => Object.fromEntries(ny.formatToParts(at).map(part => [part.type, part.value]))
const holidays = new Map<number, Set<string>>()

/** NYSE/Nasdaq regular opening, 09:30 New York time, including half-day sessions.
 * Calendar: https://www.nyse.com/markets/hours-calendars
 */
export function nextMarketOpen(after: number): number {
  const local = parts(after)
  const day = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)))
  for (let index = 0; index < 40; index++, day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
    const year = day.getUTCFullYear()
    if (!holidays.has(year)) holidays.set(year, new Set(buildMarketHolidays(year).filter(item => item.detail === 'Closed all day').map(item => item.date)))
    if (holidays.get(year)!.has(day.toISOString().slice(0, 10))) continue
    // 14:30 UTC is 09:30 EST or 10:30 EDT. Let Intl supply the current offset.
    const reference = day.getTime() + (14 * 60 + 30) * 60_000
    const clock = parts(reference)
    const opening = reference + (570 - Number(clock.hour) * 60 - Number(clock.minute)) * 60_000
    if (opening > after) return opening
  }
  throw new Error('The next U.S. market opening could not be calculated.')
}
