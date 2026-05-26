/* eslint-disable @typescript-eslint/no-explicit-any */
import { upsertMemo } from "@/lib/actions";

function MemoForm({ m }: { m?: any }) {
  return <form action={upsertMemo} className="space-y-2"><input type="hidden" name="id" value={m?.id || ""} /><input type="date" name="date" defaultValue={m?.date} required /><textarea name="content" defaultValue={m?.content || ""} placeholder="メモ内容" required /><select name="priority" defaultValue={m?.priority || 2}><option value="1">高</option><option value="2">中</option><option value="3">低</option></select><button>保存</button></form>;
}

export default function NewMemo() { return <div><h1 className="text-2xl font-semibold mb-3">メモ登録</h1><MemoForm /></div>; }
export { MemoForm };

