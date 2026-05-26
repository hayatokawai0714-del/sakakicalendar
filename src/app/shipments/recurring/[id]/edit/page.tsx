/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { deleteRecurringShipment, upsertRecurringShipment } from "@/lib/actions";

export default async function EditRecurringShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = db.prepare("SELECT * FROM recurring_shipments WHERE id=?").get(id) as any;
  const destinations = db.prepare("SELECT id,name FROM destinations WHERE is_active=1 ORDER BY name").all() as any[];
  const specs = db.prepare("SELECT name FROM unit_settings WHERE category='spec' AND is_visible=1 ORDER BY sort_order").all() as any[];
  const units = db.prepare("SELECT name FROM unit_settings WHERE category='unit' AND is_visible=1 ORDER BY sort_order").all() as any[];

  return <div className="space-y-3"><h1 className="text-2xl font-semibold">定期出荷編集</h1>
    <form action={upsertRecurringShipment} className="space-y-2">
      <input type="hidden" name="id" value={r.id} />
      <select name="destination_id" defaultValue={r.destination_id}>{destinations.map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <select name="recurrence_type" defaultValue={r.recurrence_type}><option value="WEEKLY">毎週</option><option value="BIWEEKLY">隔週</option><option value="MONTHLY">毎月（日付指定）</option></select>
      <select name="weekday" defaultValue={String(r.weekday ?? 2)}><option value="0">日</option><option value="1">月</option><option value="2">火</option><option value="3">水</option><option value="4">木</option><option value="5">金</option><option value="6">土</option></select>
      <input type="text" name="day_of_months" defaultValue={r.day_of_months || String(r.day_of_month ?? 1)} placeholder="例: 5,20,28" />
      <input type="date" name="start_date" defaultValue={r.start_date} required />
      <input type="date" name="end_date" defaultValue={r.end_date || ""} />
      <select name="spec" defaultValue={r.spec}>{specs.map((x)=><option key={x.name}>{x.name}</option>)}</select>
      <input type="number" step="0.01" name="quantity" defaultValue={r.quantity} required />
      <select name="unit" defaultValue={r.unit}>{units.map((x)=><option key={x.name}>{x.name}</option>)}</select>
      <textarea name="memo" defaultValue={r.memo || ""} />
      <button>保存</button>
    </form>
    <form action={deleteRecurringShipment}><input type="hidden" name="id" value={r.id} /><button className="border-zinc-300 bg-white text-black">削除</button></form>
  </div>;
}
