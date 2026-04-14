import { addDays, differenceInCalendarDays } from 'date-fns'

/** Max calendar days between start and end (same rule as `differenceInCalendarDays`). */
export const ADMIN_DATE_RANGE_MAX_DAYS = 400

export function clampDateRange(from: Date, to: Date): { from: Date; to: Date } {
  let a = from
  let b = to
  if (differenceInCalendarDays(b, a) < 0) {
    ;[a, b] = [b, a]
  }
  if (differenceInCalendarDays(b, a) > ADMIN_DATE_RANGE_MAX_DAYS) {
    b = addDays(a, ADMIN_DATE_RANGE_MAX_DAYS)
  }
  return { from: a, to: b }
}
