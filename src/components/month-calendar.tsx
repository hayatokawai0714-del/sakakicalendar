import Link from "next/link";
import { eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarItem } from "@/lib/queries";

export function MonthCalendar({ month, items, selectedDate }: { month: Date; items: CalendarItem[]; selectedDate?: string }) {
  const monthKey = format(month, "yyyy-MM");
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-lg font-semibold">{format(month, "yyyy年M月")}</div>
      <div className="grid grid-cols-7 gap-1 text-xs text-zinc-500 mb-1">{"日月火水木金土".split("").map((d) => <div key={d}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dItems = items.filter((i) => i.date === key);
          return (
            <Link href={`/calendar?month=${monthKey}&date=${key}`} key={key} className={`min-h-24 rounded-xl border p-1 ${isSameMonth(day, month) ? "bg-white text-zinc-900" : "bg-zinc-50 text-zinc-400"} ${selectedDate === key ? "border-black" : "border-zinc-200"}`}>
              <div className="text-xs mb-1">{format(day, "d")}</div>
              {dItems.slice(0, 3).map((it) => <div key={`${it.label}-${it.id}`} className="truncate text-[10px]"><span className="mr-1 rounded bg-zinc-100 px-1">{it.label}</span>{it.text}</div>)}
              {dItems.length > 3 && <div className="text-[10px] text-zinc-500">他{dItems.length - 3}件</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
