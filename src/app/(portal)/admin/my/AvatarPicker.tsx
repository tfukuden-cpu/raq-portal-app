"use client";

import { useState, useTransition } from "react";
import { updateAvatarColorAction } from "./actions";

export const AVATAR_COLORS: {
  key: string;
  bg: string;
  ring: string;
  text: string;
  label: string;
}[] = [
  { key: "blue",    bg: "bg-blue-500",    ring: "ring-blue-500",    text: "text-white", label: "ブルー" },
  { key: "purple",  bg: "bg-purple-500",  ring: "ring-purple-500",  text: "text-white", label: "パープル" },
  { key: "rose",    bg: "bg-rose-500",    ring: "ring-rose-500",    text: "text-white", label: "ローズ" },
  { key: "emerald", bg: "bg-emerald-500", ring: "ring-emerald-500", text: "text-white", label: "グリーン" },
  { key: "amber",   bg: "bg-amber-400",   ring: "ring-amber-400",   text: "text-white", label: "イエロー" },
  { key: "teal",    bg: "bg-teal-500",    ring: "ring-teal-500",    text: "text-white", label: "ティール" },
  { key: "orange",  bg: "bg-orange-500",  ring: "ring-orange-500",  text: "text-white", label: "オレンジ" },
  { key: "pink",    bg: "bg-pink-500",    ring: "ring-pink-500",    text: "text-white", label: "ピンク" },
  { key: "indigo",  bg: "bg-indigo-500",  ring: "ring-indigo-500",  text: "text-white", label: "インディゴ" },
  { key: "cyan",    bg: "bg-cyan-500",    ring: "ring-cyan-500",    text: "text-white", label: "シアン" },
  { key: "lime",    bg: "bg-lime-500",    ring: "ring-lime-500",    text: "text-white", label: "ライム" },
  { key: "zinc",    bg: "bg-zinc-500",    ring: "ring-zinc-500",    text: "text-white", label: "グレー" },
];

/** avatar_color の文字列から bg/text クラスを返す（未設定時はデフォルト） */
export function getAvatarStyle(color: string | null, defaultBg: string, defaultText: string) {
  const found = AVATAR_COLORS.find(c => c.key === color);
  return found
    ? { bg: found.bg, text: found.text }
    : { bg: defaultBg, text: defaultText };
}

export default function AvatarPicker({
  currentColor,
  avatarChar,
}: {
  currentColor: string | null;
  avatarChar: string;
}) {
  const [open, setOpen]         = useState(false);
  const [selected, setSelected] = useState(currentColor ?? "");
  const [isPending, start]      = useTransition();

  const current = AVATAR_COLORS.find(c => c.key === selected);
  const previewBg   = current?.bg   ?? "bg-zinc-300 dark:bg-zinc-700";
  const previewText = current?.text ?? "text-zinc-700";

  const handleSave = (key: string) => {
    setSelected(key);
    const fd = new FormData();
    fd.set("color", key);
    start(async () => {
      await updateAvatarColorAction(fd);
      setOpen(false);
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* アバター（タップで開く） */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="relative group"
      >
        <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold transition-all ${previewBg} ${previewText}`}>
          {avatarChar}
        </div>
        {/* カメラアイコン */}
        <div className="absolute inset-0 rounded-full bg-black/20 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15.232 5.232l3.536 3.536M9 13a4 4 0 108 0 4 4 0 00-8 0zm10.95-6.95a2.5 2.5 0 010 3.536l-9.9 9.9-4.243.707.707-4.243 9.9-9.9a2.5 2.5 0 013.536 0z" />
          </svg>
        </div>
      </button>
      <p className="text-[11px] text-zinc-400">タップして変更</p>

      {/* カラーパレット（開閉） */}
      {open && (
        <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-4 shadow-lg space-y-3">
          <p className="text-xs font-semibold text-zinc-500 text-center">カラーを選択</p>
          <div className="grid grid-cols-6 gap-2.5 justify-items-center">
            {AVATAR_COLORS.map(c => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                onClick={() => handleSave(c.key)}
                disabled={isPending}
                className={`w-10 h-10 rounded-full ${c.bg} transition-all disabled:opacity-50 ${
                  selected === c.key
                    ? `ring-2 ring-offset-2 ${c.ring} scale-110`
                    : "hover:scale-105 active:scale-95"
                }`}
              />
            ))}
          </div>
          {isPending && (
            <p className="text-[10px] text-zinc-400 text-center">保存中…</p>
          )}
        </div>
      )}
    </div>
  );
}
