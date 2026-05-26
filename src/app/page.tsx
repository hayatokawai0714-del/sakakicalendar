import Link from "next/link";
import { MonthCalendar } from "@/components/month-calendar";
import { getCalendarItems, getTodayItems } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  const today = getTodayItems();
  const items = getCalendarItems(new Date());
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">今日の予定</h1>
    <div className="rounded-2xl border p-3">{today.length===0?"予定なし":today.map((i)=><Link key={`${i.label}-${i.id}`} href={i.href} className="block truncate py-1"><span className="mr-2 rounded bg-zinc-100 px-1 text-xs">{i.label}</span>{i.text}</Link>)}</div>
    <div className="flex gap-2 text-sm"><Link className="rounded-xl border px-3 py-2" href="/shipments/new">出荷追加</Link><Link className="rounded-xl border px-3 py-2" href="/events/new">予定追加</Link><Link className="rounded-xl border px-3 py-2" href="/memos/new">メモ追加</Link></div>
    <MonthCalendar month={new Date()} items={items} />
  </div>;
}
