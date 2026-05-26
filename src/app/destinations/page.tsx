/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { db } from "@/lib/db";
import { deleteDestination, upsertDestination } from "@/lib/actions";

export default function DestinationsPage() {
  const rows = db.prepare("SELECT * FROM destinations ORDER BY id DESC").all() as any[];
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">出荷先管理</h1>
  <form action={upsertDestination} className="space-y-2 rounded-2xl border p-3"><input name="name" placeholder="出荷先名" required /><input name="address" placeholder="住所" /><input name="phone" placeholder="電話番号" /><input name="contact_name" placeholder="担当者名" /><input name="email" placeholder="メール" /><textarea name="notes" placeholder="備考" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked className="w-4" />有効</label><button>追加</button></form>
  <div className="rounded-2xl border p-3">{rows.map((r)=><div key={r.id} className="flex items-center justify-between border-b py-2 last:border-0"><div><div>{r.name}</div><div className="text-xs text-zinc-500">{r.is_active?"有効":"無効"}</div></div><div className="flex gap-2"><Link className="text-sm underline" href={`/destinations/${r.id}/edit`}>編集</Link><form action={deleteDestination}><input type="hidden" name="id" value={r.id}/><button className="border-zinc-300 bg-white text-black">削除</button></form></div></div>)}</div></div>;
}

