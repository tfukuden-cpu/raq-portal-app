"use client";

import { useState, useTransition } from "react";
import { sendShiftNotifyAction, previewShiftNotifyAction } from "./actions";

type Member = { id: string; name: string };

const DEFAULT_TEMPLATE = `{名前}さん、{対象月}のシフトが確定しました。

{シフト一覧}
ポータルのシフトページからご確認ください。`;

type Props = {
  projectId: string;
  year: number;
  month: number;
  members: Member[];
  defaultTemplate?: string;
};

export default function ShiftLineNotifyButton({
  projectId, year, month, members, defaultTemplate,
}: Props) {
  const [open, setOpen]             = useState(false);
  const [message, setMessage]       = useState("");
  const [previewId, setPreviewId]   = useState<string>("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  const [isSending, startSend]       = useTransition();
  const [isPreviewing, startPreview] = useTransition();

  const [result, setResult] = useState<{ sent: number; noLine: string[] } | null>(null);
  const [sendError, setSendError]     = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;
  const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

  function openModal() {
    // {シフト一覧} が含まれていない古いテンプレートは使わず DEFAULT_TEMPLATE を使う
    const tmpl = defaultTemplate?.trim() ?? "";
    setMessage(tmpl.includes("{シフト一覧}") ? tmpl : DEFAULT_TEMPLATE);
    setPreviewId(members[0]?.id ?? "");
    setPreviewText(null);
    setPreviewName("");
    setResult(null);
    setSendError(null);
    setPreviewError(null);
    setOpen(true);
  }

  function handlePreview() {
    if (!previewId) return;
    setPreviewError(null);
    startPreview(async () => {
      const res = await previewShiftNotifyAction(projectId, previewId, year, month, message);
      if (res.success && res.previewText !== undefined) {
        setPreviewText(res.previewText);
        setPreviewName(res.staffName ?? "");
      } else {
        setPreviewError(res.message ?? "プレビューの取得に失敗しました");
      }
    });
  }

  function handleSend() {
    setSendError(null);
    startSend(async () => {
      const res = await sendShiftNotifyAction(projectId, year, month, message);
      if (res.success) {
        setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
        setOpen(false);
      } else {
        setSendError(res.message ?? "送信に失敗しました");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        シフト通知（LINE）
      </button>

      {/* 送信完了バナー */}
      {result && (
        <div className="fixed bottom-6 right-4 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-xl p-4 w-64 text-sm space-y-1">
          <p className="font-semibold text-emerald-600">✓ 送信完了 {result.sent}名</p>
          {result.noLine.length > 0 && (
            <p className="text-xs text-zinc-500">LINE未連携：{result.noLine.join("・")}</p>
          )}
          <button onClick={() => setResult(null)} className="text-[11px] text-zinc-400 hover:text-zinc-600 mt-1">閉じる</button>
        </div>
      )}

      {/* モーダル */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[94dvh] flex flex-col">

            {/* ヘッダー */}
            <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">シフト通知（LINE）</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {targetMonth} — LINE連携済みスタッフへ個別送信
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1 -mt-0.5 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* スクロールエリア */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

              {/* ── メッセージテンプレート ── */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  メッセージテンプレート
                </label>
                <textarea
                  value={message}
                  onChange={e => { setMessage(e.target.value); setPreviewText(null); }}
                  rows={7}
                  className="w-full text-xs font-mono rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  <span className="font-semibold text-zinc-500">{"{名前}"}</span> スタッフ名 ／{" "}
                  <span className="font-semibold text-zinc-500">{"{対象月}"}</span> {targetMonth} ／{" "}
                  <span className="font-semibold text-zinc-500">{"{シフト一覧}"}</span> 全日程（公休含む）
                </p>
              </div>

              {/* ── プレビュー ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">プレビュー</span>
                  <select
                    value={previewId}
                    onChange={e => { setPreviewId(e.target.value); setPreviewText(null); }}
                    className="flex-1 min-w-0 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">スタッフを選択…</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={!previewId || isPreviewing}
                    className="flex-shrink-0 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-xs font-semibold transition-colors"
                  >
                    {isPreviewing ? "読込中…" : "プレビュー"}
                  </button>
                </div>

                {previewError && (
                  <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{previewError}</p>
                )}

                {/* LINE風バブル */}
                {previewText !== null && (
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-[#f0f0f0] dark:bg-zinc-800 shadow-sm">
                    {/* 送信者名 */}
                    <div className="px-3 pt-2.5 pb-0.5">
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                        {previewName} さんへのメッセージ
                      </p>
                    </div>
                    {/* バブル本体 */}
                    <div className="px-3 pb-3">
                      <div className="bg-white dark:bg-zinc-900 rounded-xl overflow-hidden shadow-sm border border-zinc-100 dark:border-zinc-700">
                        {/* 本文 */}
                        <div className="px-4 py-3 max-h-64 overflow-y-auto">
                          <pre className="text-xs whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-100 leading-relaxed font-sans">
                            {previewText}
                          </pre>
                        </div>
                        {/* ボタン（LINEのFlex footerと同じ見た目） */}
                        <div className="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-700 pt-2">
                          <a
                            href={`${APP_URL}/shifts`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            シフトを確認する
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {sendError && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{sendError}</p>
              )}
            </div>

            {/* フッター */}
            <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3 flex-shrink-0">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleSend}
                disabled={isSending || !message.trim()}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white transition-colors"
              >
                {isSending ? "送信中..." : "全員に送信"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
