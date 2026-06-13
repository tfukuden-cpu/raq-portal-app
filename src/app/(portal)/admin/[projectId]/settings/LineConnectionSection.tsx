"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { unlinkLineAction, sendLineTestAction, fetchLineTestConfirmationsAction, clearLineTestConfirmationsAction } from "./actions";

type Member = {
  staffId: string;
  name: string;
  line_user_id: string | null;
  lineLinked: boolean;
  lineFriend?: boolean;
};

function shortId(id: string) {
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…" + id.slice(-4);
}

function fmtTime(iso: string) {
  // confirmed_at は UTC ISO → JST に変換して HH:MM
  const utcMs = new Date(iso).getTime();
  const jstMs = utcMs + 9 * 60 * 60 * 1000;
  const jst   = new Date(jstMs);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export default function LineConnectionSection({
  projectId,
  members,
  stickyTopOffset,
}: {
  projectId: string;
  members: Member[];
  stickyTopOffset?: number;
}) {
  const [filterUnlinked, setFilterUnlinked] = useState(false);
  const [confirmUnlink, setConfirmUnlink]   = useState<string | null>(null);
  const [flash, setFlash]                   = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition]        = useTransition();
  // staffId → confirmed_at(ISO)
  const [confirmMap, setConfirmMap]         = useState<Record<string, string>>({});
  const [failedSet,  setFailedSet]          = useState<Set<string>>(new Set());
  const [isFetching, setIsFetching]         = useState(false);
  const pollTimerRef                        = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollEndRef                          = useRef<number>(0);
  const [isPolling, setIsPolling]           = useState(false);

  const linkedCount    = members.filter(m => m.lineLinked).length;
  const unlinkedCount  = members.length - linkedCount;
  const friendCount    = members.filter(m => m.lineFriend).length;
  const confirmedCount = Object.keys(confirmMap).filter(id =>
    members.some(m => m.staffId === id && m.lineLinked)
  ).length;

  const filtered = filterUnlinked ? members.filter(m => !m.lineLinked) : members;

  // --- 確認状況をDBから取得 ---
  const fetchConfirmations = useCallback(async () => {
    setIsFetching(true);
    try {
      const results = await fetchLineTestConfirmationsAction(projectId);
      const map: Record<string, string> = {};
      for (const r of results) map[r.staffId] = r.confirmedAt;
      setConfirmMap(map);
    } catch (e) {
      console.error("fetchLineTestConfirmationsAction failed", e);
    } finally {
      setIsFetching(false);
    }
  }, [projectId]);

  // 初回取得（マウント時のデータ取得＝意図的）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchConfirmations(); }, [fetchConfirmations]);

  // ポーリング開始
  function startPolling() {
    pollEndRef.current = Date.now() + 60_000;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(true);
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() >= pollEndRef.current) {
        clearInterval(pollTimerRef.current!);
        pollTimerRef.current = null;
        setIsPolling(false);
        return;
      }
      await fetchConfirmations();
    }, 3000);
  }

  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

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

  function handleTest(staffId: string | null, staffIdsFilter?: string[]) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      if (staffId) fd.set("staffId", staffId);
      if (staffIdsFilter) fd.set("staffIdsJson", JSON.stringify(staffIdsFilter));
      const r = await sendLineTestAction(fd);
      showFlash(r.success, r.message ?? (r.success ? "送信しました" : "送信失敗"));
      if (r.failedStaffIds && r.failedStaffIds.length > 0) {
        setFailedSet(prev => new Set([...prev, ...r.failedStaffIds!]));
      }
      if (r.success) startPolling();
    });
  }

  function handleClear() {
    startTransition(async () => {
      await clearLineTestConfirmationsAction(projectId);
      setConfirmMap({});
      setFailedSet(new Set());
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    });
  }

  return (
    <div className="space-y-4">

      {/* ── サマリー + 全員テスト + 受信確認バー（sticky対応） ── */}
      <div
        className={stickyTopOffset !== undefined
          ? "sticky z-20 -mx-4 px-4 bg-white dark:bg-zinc-950 pb-3 pt-1 space-y-3 border-b border-zinc-100 dark:border-zinc-800"
          : "space-y-3"
        }
        style={stickyTopOffset !== undefined ? { top: stickyTopOffset } : undefined}
      >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            連携済み <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{linkedCount}</span>名
          </span>
          <span className="text-xs text-zinc-400">
            未連携 <span className="tabular-nums">{unlinkedCount}</span>名
          </span>
          <span className="text-xs text-zinc-400">
            友達追加済み <span className="text-[#06C755] font-semibold tabular-nums">{friendCount}</span>名
          </span>
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

        <div className="flex items-center gap-2 flex-wrap">
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
          {(() => {
            const unconfirmedIds = members
              .filter(m => m.lineLinked && !confirmMap[m.staffId])
              .map(m => m.staffId);
            if (unconfirmedIds.length === 0) return null;
            return (
              <button
                type="button"
                onClick={() => handleTest(null, unconfirmedIds)}
                disabled={isPending}
                className="px-3 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-40 transition-colors"
              >
                {isPending ? "送信中…" : `未確認者に再送（${unconfirmedIds.length}名）`}
              </button>
            );
          })()}
        </div>
      </div>

      {/* ── 受信確認バー（常に表示） ── */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {isPolling && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          )}
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            受信確認済み{" "}
            <span className={`tabular-nums ${confirmedCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
              {confirmedCount}
            </span>
            {" "}/{" "}{linkedCount}名
          </span>
          {isPolling && (
            <span className="text-[10px] text-emerald-500 dark:text-emerald-400">自動更新中…</span>
          )}
          {isFetching && !isPolling && (
            <span className="text-[10px] text-zinc-400">更新中…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchConfirmations}
            disabled={isFetching}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          >
            更新
          </button>
          {confirmedCount > 0 && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isPending}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 font-semibold disabled:opacity-40 transition-colors"
            >
              クリア
            </button>
          )}
        </div>
      </div>
      </div>{/* end sticky stats+confirmation wrapper */}

      {/* ── フラッシュ ── */}
      {flash && (
        <p className={`text-xs px-3 py-2 rounded-xl ${
          flash.ok
            ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
            : "bg-red-50 dark:bg-red-950/20 text-red-500"
        }`}>
          {flash.ok ? "✓ " : "✗ "}{flash.msg}
        </p>
      )}

      {/* ── スタッフ一覧 ── */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <p className="text-xs text-zinc-400 py-3 text-center">
            {filterUnlinked ? "未連携スタッフはいません" : "メンバーがいません"}
          </p>
        )}
        {filtered.map(m => {
          const confirmedAt = confirmMap[m.staffId];
          return (
            <div
              key={m.staffId}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-white dark:bg-zinc-950 transition-colors ${
                confirmedAt
                  ? "border-emerald-100 dark:border-emerald-900"
                  : "border-zinc-100 dark:border-zinc-800"
              }`}
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
              <span className="text-[11px] text-zinc-400 font-mono truncate min-w-0" style={{ flex: "1 1 0" }}>
                {m.line_user_id ? shortId(m.line_user_id) : (
                  <span className="text-zinc-300 dark:text-zinc-600">未連携</span>
                )}
              </span>

              {/* 友達追加状態 */}
              {m.lineLinked && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                  m.lineFriend
                    ? "bg-[#06C755]/10 text-[#06C755]"
                    : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                }`}>
                  {m.lineFriend ? "友達✓" : "未追加"}
                </span>
              )}

              {/* 確認状態バッジ */}
              {m.lineLinked && (() => {
                const failed = failedSet.has(m.staffId);
                if (confirmedAt) return (
                  <span className="text-[11px] font-semibold flex-shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400 min-w-[64px] text-right">
                    ✓ 開封 {fmtTime(confirmedAt)}
                  </span>
                );
                if (failed) return (
                  <span className="text-[11px] font-semibold flex-shrink-0 text-red-500 dark:text-red-400 min-w-[64px] text-right">
                    ⚠ 未達
                  </span>
                );
                return (
                  <span className="text-[11px] font-semibold flex-shrink-0 text-zinc-300 dark:text-zinc-600 min-w-[64px] text-right">
                    —
                  </span>
                );
              })()}

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
          );
        })}
      </div>
    </div>
  );
}
