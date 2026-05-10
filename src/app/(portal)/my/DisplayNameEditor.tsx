"use client";

import { useState, useTransition } from "react";
import { updateDisplayNameAction } from "./actions";

type Props = {
  currentName: string;
};

export default function DisplayNameEditor({ currentName }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [isPending, startTrans] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    startTrans(async () => {
      const res = await updateDisplayNameAction(trimmed);
      setMsg({ ok: res.success, text: res.message ?? "" });
      if (res.success) setEditing(false);
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setEditing(true); setMsg(null); }}
        className="text-[10px] text-blue-500 hover:text-blue-600 transition-colors mt-0.5"
      >
        表示名を変更
      </button>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5 w-full">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        maxLength={30}
        autoFocus
        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="表示名（30文字以内）"
      />
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending || !value.trim()}
          onClick={submit}
          className="text-xs font-bold px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          {isPending ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setValue(currentName); setMsg(null); }}
          className="text-xs px-2 py-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
