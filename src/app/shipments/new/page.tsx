/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { db } from "@/lib/db";
import { upsertShipment } from "@/lib/actions";

function ShipmentForm({ s }: { s?: any }) {
  const destinations = db.prepare("SELECT id,name FROM destinations WHERE is_active=1 ORDER BY name").all() as any[];
  const specs = db.prepare("SELECT name FROM unit_settings WHERE category='spec' AND is_visible=1 ORDER BY sort_order").all() as any[];
  const units = db.prepare("SELECT name FROM unit_settings WHERE category='unit' AND is_visible=1 ORDER BY sort_order").all() as any[];

  return <form action={upsertShipment} className="space-y-2">
    <input type="hidden" name="id" value={s?.id || ""} />
    <input type="date" name="date" defaultValue={s?.date} />
    <div className="text-xs text-zinc-500">上の日付はスポット出荷用です。定期は下の「開始日」を使います。</div>
    <select name="shipment_type" defaultValue={s?.shipment_type || "SPOT"}><option value="SPOT">スポット</option><option value="REGULAR">定期</option></select>
    <select name="destination_id" defaultValue={s?.destination_id} required disabled={destinations.length === 0}>{destinations.length === 0 ? <option value="">出荷先を先に登録してください</option> : destinations.map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
    {destinations.length === 0 && <div className="text-sm text-zinc-600">出荷先マスタが未登録です。<Link className="underline" href="/destinations">出荷先管理</Link>から追加してください。</div>}
    <select name="spec" defaultValue={s?.spec}>{specs.map((x)=><option key={x.name}>{x.name}</option>)}</select>
    <input type="number" step="0.01" name="quantity" defaultValue={s?.quantity || 0} required />
    <select name="unit" defaultValue={s?.unit}>{units.map((x)=><option key={x.name}>{x.name}</option>)}</select>

    <div className="rounded-xl border p-3 space-y-2">
      <div className="text-sm font-semibold">定期設定（任意）</div>
      <select name="recurrence_type" defaultValue="NONE">
        <option value="NONE">定期設定しない（単発登録）</option>
        <option value="WEEKLY">毎週</option>
        <option value="BIWEEKLY">隔週</option>
        <option value="MONTHLY">毎月（日付指定）</option>
      </select>
      <select name="weekday" defaultValue="2">
        <option value="0">日</option><option value="1">月</option><option value="2">火</option><option value="3">水</option><option value="4">木</option><option value="5">金</option><option value="6">土</option>
      </select>
      <input type="text" name="day_of_months" defaultValue="1" placeholder="毎月の日付 (例: 5,20,28)" />
      <label className="text-xs text-zinc-500">開始日</label><input type="date" name="start_date" defaultValue={s?.date} />
      <label className="text-xs text-zinc-500">終了日（空欄可）</label><input type="date" name="end_date" />
      <div className="text-xs text-zinc-500">毎週/隔週は曜日を使用、毎月は日付を使用します。</div>
    </div>

    <textarea name="memo" defaultValue={s?.memo||""} placeholder="メモ" />
    <button disabled={destinations.length === 0}>保存</button>
  </form>;
}

export default function NewShipment() { return <div><h1 className="text-2xl font-semibold mb-3">出荷予定登録</h1><ShipmentForm /></div>; }
export { ShipmentForm };
