/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { ShipmentForm } from "@/app/shipments/new/page";
import { deleteShipment } from "@/lib/actions";

export default async function EditShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const s = db.prepare("SELECT * FROM shipments WHERE id=?").get(id) as any;
  return <div className="space-y-3"><h1 className="text-2xl font-semibold">出荷予定編集</h1><ShipmentForm s={s} /><form action={deleteShipment}><input type="hidden" name="id" value={id} /><button className="border-zinc-300 bg-white text-black">削除</button></form></div>;
}

