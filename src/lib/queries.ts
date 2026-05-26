/* eslint-disable @typescript-eslint/no-explicit-any */
import { eachDayOfInterval, endOfMonth, format, getDate, getDay, isAfter, isBefore, parseISO, startOfMonth } from "date-fns";
import { db } from "@/lib/db";

export type CalendarItem = {
  id: number;
  date: string;
  label: "出荷" | "予定" | "メモ";
  text: string;
  href: string;
  kind: "shipment" | "recurring_shipment" | "event" | "memo";
};

function recurringMatches(day: Date, r: any) {
  const start = parseISO(r.start_date);
  const end = r.end_date ? parseISO(r.end_date) : null;
  if (isBefore(day, start)) return false;
  if (end && isAfter(day, end)) return false;

  if (r.recurrence_type === "WEEKLY") return getDay(day) === Number(r.weekday || 0);
  if (r.recurrence_type === "BIWEEKLY") {
    if (getDay(day) !== Number(r.weekday || 0)) return false;
    const diff = Math.floor((day.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && Math.floor(diff / 7) % 2 === 0;
  }
  if (r.recurrence_type === "MONTHLY") {
    const fromCsv = String(r.day_of_months || "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
    const days = fromCsv.length > 0 ? fromCsv : [Number(r.day_of_month || 1)];
    return days.includes(getDate(day));
  }
  return false;
}

export function getCalendarItems(month: Date): CalendarItem[] {
  const ym = format(month, "yyyy-MM");
  const shipments = db.prepare(`SELECT s.id, s.date, d.name destination, s.spec, s.quantity, s.unit FROM shipments s JOIN destinations d ON d.id=s.destination_id WHERE s.date LIKE ?`).all(`${ym}%`) as any[];
  const recurring = db.prepare("SELECT r.*, d.name destination FROM recurring_shipments r JOIN destinations d ON d.id=r.destination_id").all() as any[];
  const events = db.prepare("SELECT id,date,time,title FROM events WHERE date LIKE ?").all(`${ym}%`) as any[];
  const memos = db.prepare("SELECT id,date,content FROM memos WHERE date LIKE ?").all(`${ym}%`) as any[];

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const recurringExpanded = days.flatMap((day) => recurring.filter((r) => recurringMatches(day, r)).map((r) => ({ id: r.id, date: format(day, "yyyy-MM-dd"), label: "出荷" as const, text: `${r.destination} ${r.spec} ${r.quantity}${r.unit}`, href: `/shipments/recurring/${r.id}/edit`, kind: "recurring_shipment" as const })));

  return [
    ...shipments.map((s) => ({ id: s.id, date: s.date, label: "出荷" as const, text: `${s.destination} ${s.spec} ${s.quantity}${s.unit}`, href: `/shipments/${s.id}/edit`, kind: "shipment" as const })),
    ...recurringExpanded,
    ...events.map((e) => ({ id: e.id, date: e.date, label: "予定" as const, text: `${e.title}${e.time ? ` ${e.time}` : ""}`, href: `/events/${e.id}/edit`, kind: "event" as const })),
    ...memos.map((m) => ({ id: m.id, date: m.date, label: "メモ" as const, text: m.content, href: `/memos/${m.id}/edit`, kind: "memo" as const })),
  ];
}

export function getTodayItems() {
  return getCalendarItems(new Date()).filter((i) => i.date === format(new Date(), "yyyy-MM-dd"));
}

export function getDayItems(date: string) {
  return getCalendarItems(new Date(date)).filter((i) => i.date === date);
}
