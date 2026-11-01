const TZ = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

export const dayKeyOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

export const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export const dateOf = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = dayKeyOf(d);
  if (key === dayKeyOf(now)) return "Hôm nay";
  if (key === dayKeyOf(new Date(now.getTime() + DAY_MS))) return "Ngày mai";
  const weekday = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, weekday: "long" }).format(d);
  const short = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
  return `${weekday.charAt(0).toLocaleUpperCase("vi")}${weekday.slice(1)}, ${short}`;
}

export function groupByDay<T extends { scheduledAt: string | null }>(items: T[]): Array<{ key: string; label: string; items: T[] }> {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  for (const item of items) {
    const at = item.scheduledAt ?? new Date().toISOString();
    const key = dayKeyOf(new Date(at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(at), items: [item] });
  }
  return groups;
}

const VN_OFFSET_MS = 7 * 3_600_000;

export function toLocalInput(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
}

export function defaultScheduleValue(now = new Date()): string {
  const d = new Date(now.getTime() + 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return toLocalInput(d);
}

export function inputToIso(value: string): string {
  return `${value}:00+07:00`;
}

export function inputToDate(value: string): Date {
  return new Date(inputToIso(value));
}
