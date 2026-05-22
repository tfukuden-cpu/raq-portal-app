"use client";

import { useState, useTransition } from "react";
import { unlinkLineAction, sendLineTestAction } from "./actions";

type Member = {
  staffId: string;
  name: string;
  line_user_id: string | null;
  lineLinked: boolean;
};

function shortId(id: string) {
  // LINE user IDは長いので先頭8文字 + ... で表示
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…" + id.slice(-4);
}

export default function LineConnectionSection({
  projectId,
  members,
}: {
  projectId: string;
  members: Member[];
}) {
  const [filterUnlinked, setFilterUnlinked] = useState(false);
  const [confirmUnlink, setConfirmUnlink]   = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkedCount   = members.filter(m => m.lineLinked).length;
  const unlinkedCount = members.length - linkedCount;

  const filtered = filterUnlinked
    ? members.filter(m => !m.lineLinked)
    : members;

  function showFlash(ok: boolean, msg: string) {
    setFlash({ ok, msg });
    setTimeout(() => setFlash(null), 4000);
  }

  function handleUnlink(staffId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("staffId", staffId);
      fd.set("projectId", projectId);
      const r = await unlinkLineAction(fd);
      setConfirmUnlink(null);
      showFlash(r.success, r.message ?? (r.success ? "連携解除しました" : "失敗しました"));
    });
  }

  function handleTest(staffId: string | null) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      if (staffId) fd.set("staffId", staffId);
      const r = await sendLineTestAction(fd);
      showFlash(r.success, r.message ?? (r.success ? "送信しました" : "送信失敗"));
    });
  }

  return (
    <div className="space-y-4">

      {/* サマリー + 全員テスト */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            連携済み <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{linkedCount}</span>名
          </span>
          <span className="text-xs text-zinc-400">
            未連携 <span className="tabular-nums">{unlinkedCount}</span>名
          </span>
          {/* 未連携フィルター */}
          <button
            type="button"
            onClick={() => setFilterUnlinked(f => !f)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              filterUnlinked
                ? "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            未連携のみ
          </button>
        </div>

        {linkedCount > 0 && (
          <button
            type="button"
            onClick={() => handleTest(null)}
            disabled={isPending}
            className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {isPending ? "送信中…" : `全員にテスト送信（${linkedCount}名）`}
          </button>
        )}
      </div>

      {/* フラッシュ */}
      {flash && (
        <p className={`text-xs px-3 py-2 rounded-xl ${
          flash.ok
            ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
            : "bg-red-50 dark:bg-red-950/20 text-red-500"
        }`}>
          {flash.ok ? "✓ " : "✗ "}{flash.msg}
        </p>
      )}

      {/* スタッフ一覧 */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <p className="text-xs text-zinc-400 py-3 text-center">
            {filterUnlinked ? "未連携スタッフはいません" : "メンバーがいません"}
          </p>
        )}
        {filtered.map(m => (
          <div
            key={m.staffId}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950"
          >
            {/* 連携状態ドット */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              m.lineLinked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
            }`} />

            {/* 名前 */}
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 min-w-0 flex-shrink-0 w-24 truncate">
              {m.name}
            </span>

            {/* LINE ID */}
            <span className="text-[11px] text-zinc-400 font-mono truncate flex-1 min-w-0">
              {m.line_user_id ? shortId(m.line_user_id) : (
                <span className="text-zinc-300 dark:text-zinc-600">未連携</span>
              )}
            </span>

            {/* ボタン */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {m.lineLinked && (
                <button
                  type="button"
                  onClick={() => handleTest(m.staffId)}
                  disabled={isPending}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-40 transition-colors"
                >
                  テスト
                </button>
              )}
              {m.lineLinked && confirmUnlink !== m.staffId && (
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(m.staffId)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400 font-semibold transition-colors"
                >
                  解除
                </button>
              )}
              {confirmUnlink === m.staffId && (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-red-500 font-semibold">本当に解除？</span>
                  <button
                    type="button"
                    onClick={() => handleUnlink(m.staffId)}
                    disabled={isPending}
                    className="text-[11px] px-2 py-0.5 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-40 transition-colors"
                  >
                    解除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmUnlink(null)}
                    className="text-[11px] px-2 py-0.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-semibold hover:bg-zinc-300 transition-colors"
                  >
                    戻る
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
