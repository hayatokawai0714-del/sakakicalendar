/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { EventForm } from "@/app/events/new/page";
import { deleteEvent } from "@/lib/actions";

export default async function EditEvent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const e = db.prepare("SELECT * FROM events WHERE id=?").get(id) as any;
  return <div className="space-y-3"><h1 className="text-2xl font-semibold">一般予定編集</h1><EventForm e={e} /><form action={deleteEvent}><input type="hidden" name="id" value={id} /><button className="border-zinc-300 bg-white text-black">削除</button></form></div>;
}

