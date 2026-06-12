"use client";

/**
 * Myページのプロフィールアイコン（RPGキャラクター）
 * タップで108体のキャラクターピッカーを開き、staffs.rpg_character に保存する。
 * 休憩室・打刻端末・サイドバーのアイコンと共通のキャラが表示される。
 */
import { useState, useTransition } from "react";
import { RPG_CHARS, rpgCharFor, rpgCharImg } from "@/lib/rpg-chars";
import { setMyRpgCharacterAction } from "@/app/(portal)/dashboard/actions";

function PencilIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>;
}

export default function MyCharacterAvatar({
  staffId,
  initialCharId,
}: {
  staffId: string;
  initialCharId: number | null;
}) {
  const [charId, setCharId] = useState<number | null>(initialCharId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const myChar = rpgCharFor(staffId, charId);

  const handlePick = (id: number) => {
    startTransition(async () => {
      const r = await setMyRpgCharacterAction(id);
      if (r.success) {
        setCharId(id);
        setPickerOpen(false);
        setFeedback({ ok: true, msg: "キャラクターを変更しました" });
      } else {
        setFeedback({ ok: false, msg: r.message ?? "変更に失敗しました" });
      }
    });
  };

  return (
    <>
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="relative block active:scale-95 transition-transform"
        >
          <div className="w-36 h-36 rounded-full bg-gradient-to-b from-sky-50 to-emerald-100 dark:from-zinc-800 dark:to-zinc-700 border border-zinc-100 dark:border-zinc-700 flex items-end justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={rpgCharImg(myChar.id)}
              alt={myChar.label}
              draggable={false}
              className="h-28 max-w-[82%] object-contain object-bottom select-none"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
          <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-zinc-600 border-2 border-white dark:border-zinc-900 flex items-center justify-center hover:bg-zinc-700 transition-colors">
            <PencilIcon />
          </div>
        </button>
        <p className="text-[11px] text-zinc-400 mt-2">
          {myChar.label}{charId ? "" : "（おまかせ）"}・タップして変更
        </p>
        {feedback && (
          <p className={`text-[11px] font-medium mt-1 ${feedback.ok ? "text-emerald-600" : "text-red-500"}`}>
            {feedback.msg}
          </p>
        )}
      </div>

      {/* ── キャラクター選択モーダル ── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
              <div>
                <p className="text-[15px] font-bold text-zinc-800 dark:text-zinc-100">キャラクターを選ぶ</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">あなたのアイコン・休憩室のキャラとして表示されます（全{RPG_CHARS.length}体）</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg px-2">✕</button>
            </div>
            <div className="overflow-y-auto overscroll-contain p-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {RPG_CHARS.map(c => {
                  const isCurrent = c.id === myChar.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => handlePick(c.id)}
                      disabled={isPending}
                      className={[
                        "flex flex-col items-center pt-2 pb-1.5 px-1 rounded-xl border transition-all active:scale-95 disabled:opacity-50",
                        isCurrent
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-300 dark:ring-blue-800"
                          : "border-zinc-150 dark:border-zinc-700 hover:border-blue-300 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                      ].join(" ")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={rpgCharImg(c.id)} alt="" draggable={false} loading="lazy" className="h-14 max-w-full object-contain select-none" />
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-300 mt-1 w-full truncate text-center">{c.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
