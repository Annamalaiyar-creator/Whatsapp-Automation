import type { Day, RoutingConfig } from './schema.js';

export interface LocalTime {
  day: Day;
  /** HH:MM, 24-hour */
  time: string;
  /** YYYY-MM-DD */
  date: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The weekday, time and date of an instant in the tenant's time zone. */
export function localTime(at: Date, timeZone: string): LocalTime {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    day: String(parts.weekday).slice(0, 3).toLowerCase() as Day,
    time: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function isHoliday(cfg: RoutingConfig, local: LocalTime): boolean {
  return cfg.holidays.includes(local.date);
}

/** Within working hours: a working-hours range covers this time and the day isn't a holiday. */
export function isWithinBusinessHours(cfg: RoutingConfig, local: LocalTime): boolean {
  if (isHoliday(cfg, local)) return false;
  return cfg.businessHours[local.day].some((r) => local.time >= r.from && local.time < r.to);
}
