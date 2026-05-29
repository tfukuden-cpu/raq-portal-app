"use client";

import { useState, useTransition, useMemo } from "react";
import { sendShiftNotifyAction, previewShiftNotifyAction, postShiftNoticeAction } from "./actions";

type Member = { id: string; name: string };

const DEFAULT_TEMPLATE = `{名前}さん、{対象月}のシフトが確定しました。

{シフト一覧}
アプリシフトページからご確認ください。`;

type SendResult = { sent: number; noLine: string[] };

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
  const [open, setOpen]               = useState(false);
  const [message, setMessage]         = useState("");
  const [search, setSearch]           = useState("");
  const [previewId, setPreviewId]     = useState<string>("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  // アプリ内通知
  const [alsoNotice, setAlsoNotice]         = useState(false);
  const [noticeTitle, setNoticeTitle]       = useState("");
  const [noticeBody, setNoticeBody]         = useState("");

  const [isSending, startSend]         = useTransition();
  const [isPreviewing, startPreview]   = useTransition();

  const [result, setResult]           = useState<SendResult | null>(null);
  const [sendError, setSendError]     = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;
  const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

  const filteredMembers = useMemo(() =>
    search.trim() ? members.filter(m => m.name.includes(search.trim())) : members,
    [members, search]
  );

  function openModal() {
    const tmpl = defaultTemplate?.trim() ?? "";
    setMessage(tmpl.includes("{シフト一覧}") ? tmpl : DEFAULT_TEMPLATE);
    setSearch("");
    setPreviewId(members[0]?.id ?? "");
    setPreviewText(null);
    setPreviewName("");
    setAlsoNotice(false);
    setNoticeTitle(`${targetMonth} シフトが確定しました`);
    setNoticeBody(`${targetMonth}のシフトが確定しました。\nアプリのシフトページからご確認ください。`);
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

  async function doSend(staffId?: string) {
    setSendError(null);
    startSend(async () => {
      // LINE送信
      const res = await sendShiftNotifyAction(projectId, year, month, message, staffId);
      if (!res.success) {
        setSendError(res.message ?? "送信に失敗しました");
        return;
      }

      // アプリ内お知らせ（全員送信時のみ、個別送信は除く）
      if (alsoNotice && !staffId) {
        const nr = await postShiftNoticeAction(projectId, noticeTitle, noticeBody);
        if (!nr.success) {
          setSendError(`LINEは送信済みですが、お知らせ投稿に失敗しました：${nr.message}`);
          setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
          setOpen(false);
          return;
        }
      }

      setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
      setOpen(false);
    });
  }

  const selectedMember = members.find(m => m.id === previewId);

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

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[94dvh] flex flex-col">

            {/* ヘッダー */}
            <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">シフト通知（LINE）</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{targetMonth} — 個別 / 全員へ送信</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1 -mt-0.5 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* スクロールエリア */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

              {/* ── LINEメッセージテンプレート ── */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">LINEメッセージ</label>
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

              {/* ── アプリ内お知らせ ── */}
              <div className="space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alsoNotice}
                    onChange={e => setAlsoNotice(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    アプリ内のお知らせにも同時投稿する
                  </span>
                </label>

                {alsoNotice && (
                  <div className="space-y-2 pl-6 border-l-2 border-blue-200 dark:border-blue-800">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">タイトル</label>
                      <input
                        type="text"
                        value={noticeTitle}
                        onChange={e => setNoticeTitle(e.target.value)}
                        className="w-full text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">本文</label>
                      <textarea
                        value={noticeBody}
                        onChange={e => setNoticeBody(e.target.value)}
                        rows={3}
                        className="w-full text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <p className="text-[10px] text-zinc-400">お知らせはアプリ内の全スタッフに表示されます</p>
                  </div>
                )}
              </div>

              {/* ── スタッフ選択（名前検索付き） ── */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  プレビュー / 個別送信
                </label>
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="名前で検索…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                  {filteredMembers.length === 0 ? (
                    <p className="text-xs text-zinc-400 text-center py-3">該当なし</p>
                  ) : (
                    filteredMembers.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setPreviewId(m.id); setPreviewText(null); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors border-b last:border-0 border-zinc-100 dark:border-zinc-800 ${
                          previewId === m.id
                            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {m.name}
                      </button>
                    ))
                  )}
                </div>

                {previewId && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={isPreviewing || isSending}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-40 transition-colors"
                    >
                      {isPreviewing ? "読込中…" : `${selectedMember?.name} のプレビュー`}
                    </button>
                    <button
                      type="button"
                      onClick={() => doSend(previewId)}
                      disabled={isSending || isPreviewing || !message.trim()}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-400 text-white text-xs font-semibold transition-colors"
                    >
                      {isSending ? "送信中…" : "この人だけ送信"}
                    </button>
                  </div>
                )}
              </div>

              {/* LINE風プレビューバブル */}
              {previewError && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{previewError}</p>
              )}

              {previewText !== null && (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-[#f0f0f0] dark:bg-zinc-800 shadow-sm">
                  <div className="px-3 pt-2.5 pb-0.5">
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">{previewName} さんへのメッセージ</p>
                  </div>
                  <div className="px-3 pb-3">
                    <div className="bg-white dark:bg-zinc-900 rounded-xl overflow-hidden shadow-sm border border-zinc-100 dark:border-zinc-700">
                      <div className="px-4 py-3 max-h-64 overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-100 leading-relaxed font-sans">
                          {previewText}
                        </pre>
                      </div>
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
                onClick={() => doSend()}
                disabled={isSending || isPreviewing || !message.trim()}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white transition-colors"
              >
                {isSending ? "送信中..." : `全員に送信（${members.length}名）`}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
