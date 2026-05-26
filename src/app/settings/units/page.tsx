/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { deleteUnitSetting, upsertUnitSetting } from "@/lib/actions";

export default function UnitSettingsPage() {
  const rows = db.prepare("SELECT * FROM unit_settings ORDER BY category, sort_order, id").all() as any[];
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">規格・単位設定</h1>
  <form action={upsertUnitSetting} className="grid grid-cols-2 gap-2 rounded-2xl border p-3"><select name="category"><option value="spec">規格</option><option value="unit">単位</option></select><input name="name" placeholder="名前" required /><input name="sort_order" type="number" defaultValue={0} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_visible" defaultChecked className="w-4" />表示</label><button className="col-span-2">追加</button></form>
  <div className="rounded-2xl border p-3">{rows.map((r)=><div key={r.id} className="grid grid-cols-12 items-center gap-2 border-b py-2 last:border-0"><form action={upsertUnitSetting} className="col-span-10 grid grid-cols-10 gap-2"><input type="hidden" name="id" value={r.id} /><select name="category" defaultValue={r.category} className="col-span-2"><option value="spec">規格</option><option value="unit">単位</option></select><input name="name" defaultValue={r.name} className="col-span-3"/><input name="sort_order" type="number" defaultValue={r.sort_order} className="col-span-2"/><label className="col-span-2 text-sm"><input type="checkbox" name="is_visible" defaultChecked={Boolean(r.is_visible)} className="mr-1 w-4"/>表示</label><button className="col-span-1">保存</button></form><form action={deleteUnitSetting} className="col-span-2"><input type="hidden" name="id" value={r.id}/><button className="border-zinc-300 bg-white text-black">削除</button></form></div>)}</div></div>;
}

