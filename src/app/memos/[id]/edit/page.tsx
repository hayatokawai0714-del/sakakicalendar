/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { MemoForm } from "@/app/memos/new/page";
import { deleteMemo } from "@/lib/actions";

export default async function EditMemo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const m = db.prepare("SELECT * FROM memos WHERE id=?").get(id) as any;
  return <div className="space-y-3"><h1 className="text-2xl font-semibold">メモ編集</h1><MemoForm m={m} /><form action={deleteMemo}><input type="hidden" name="id" value={id} /><button className="border-zinc-300 bg-white text-black">削除</button></form></div>;
}

