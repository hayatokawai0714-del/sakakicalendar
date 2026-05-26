/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { upsertDestination } from "@/lib/actions";

export default async function EditDestination({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const d = db.prepare("SELECT * FROM destinations WHERE id=?").get(id) as any;
  return <form action={upsertDestination} className="space-y-2"><h1 className="text-2xl font-semibold">出荷先編集</h1><input type="hidden" name="id" value={d.id} /><input name="name" defaultValue={d.name} required /><input name="address" defaultValue={d.address||""} /><input name="phone" defaultValue={d.phone||""} /><input name="contact_name" defaultValue={d.contact_name||""} /><input name="email" defaultValue={d.email||""} /><textarea name="notes" defaultValue={d.notes||""} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={Boolean(d.is_active)} className="w-4" />有効</label><button>保存</button></form>;
}

