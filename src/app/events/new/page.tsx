/* eslint-disable @typescript-eslint/no-explicit-any */
import { upsertEvent } from "@/lib/actions";

function EventForm({ e }: { e?: any }) {
  return <form action={upsertEvent} className="space-y-2"><input type="hidden" name="id" value={e?.id || ""} /><input type="date" name="date" defaultValue={e?.date} required /><input type="time" name="time" defaultValue={e?.time || ""} /><input name="title" defaultValue={e?.title || ""} placeholder="予定名" required /><textarea name="memo" defaultValue={e?.memo || ""} /><button>保存</button></form>;
}

export default function NewEvent() { return <div><h1 className="text-2xl font-semibold mb-3">一般予定登録</h1><EventForm /></div>; }
export { EventForm };

