import Link from "next/link";
import { addMonths, format, parse } from "date-fns";
import { MonthCalendar } from "@/components/month-calendar";
import { getCalendarItems, getDayItems } from "@/lib/queries";
import { deleteEvent, deleteMemo, deleteRecurringShipment, deleteShipment } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; month?: string }> }) {
  const params = await searchParams;
  const selectedDate = params.date;
  const baseMonth = params.month ? parse(`${params.month}-01`, "yyyy-MM-dd", new Date()) : (selectedDate ? new Date(selectedDate) : new Date());
  const prevMonth = format(addMonths(baseMonth, -1), "yyyy-MM");
  const nextMonth = format(addMonths(baseMonth, 1), "yyyy-MM");

  const items = getCalendarItems(baseMonth);
  const dayItems = selectedDate ? getDayItems(selectedDate) : [];

  return <div className="space-y-4"><h1 className="text-2xl font-semibold">月間カレンダー</h1>
    <div className="flex items-center justify-between gap-2">
      <Link className="rounded-xl border px-3 py-2 text-sm" href={`/calendar?month=${prevMonth}`}>前月</Link>
      <div className="text-sm font-medium">{format(baseMonth, "yyyy年M月")}</div>
      <Link className="rounded-xl border px-3 py-2 text-sm" href={`/calendar?month=${nextMonth}`}>翌月</Link>
    </div>
    <MonthCalendar month={baseMonth} items={items} selectedDate={selectedDate} />
    {selectedDate && <div className="rounded-2xl border p-3"><div className="mb-2 text-sm text-zinc-500">{selectedDate}</div>{dayItems.map((i)=><div key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-2 py-1"><Link className="block truncate" href={i.href}><span className="mr-2 rounded bg-zinc-100 px-1 text-xs">{i.label}</span>{i.text}</Link><div className="flex gap-1"><Link href={i.href} className="rounded border px-2 py-1 text-xs">編集</Link>{i.kind === "shipment" && <form action={deleteShipment}><input type="hidden" name="id" value={i.id} /><button className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black">削除</button></form>}{i.kind === "recurring_shipment" && <form action={deleteRecurringShipment}><input type="hidden" name="id" value={i.id} /><button className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black">削除</button></form>}{i.kind === "event" && <form action={deleteEvent}><input type="hidden" name="id" value={i.id} /><button className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black">削除</button></form>}{i.kind === "memo" && <form action={deleteMemo}><input type="hidden" name="id" value={i.id} /><button className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-black">削除</button></form>}</div></div>)}</div>}
  </div>;
}
