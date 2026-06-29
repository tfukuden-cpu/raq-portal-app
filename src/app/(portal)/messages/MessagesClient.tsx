"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import {
  sendMessageAction, staffStartMessageAction, replyMessageAction,
  markThreadReadAction, deleteMessageAction,
  sendDirectMessageAction, markStaffRoomReadAction,
} from "./actions";
import {
  AUDIENCE_LABEL, isImageFile,
  type AdminMessage, type AdminThread, type StaffMessage, type MessageReply,
  type AudienceType, type StaffRoom,
} from "@/lib/messages";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function fmt(iso: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ── 共通アイコン ──────────────────────────────────────────
function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
function Clip() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

// ── 添付表示 ──────────────────────────────────────────────
function Attachment({ url, name }: { url: string; name: string | null }) {
  if (isImageFile(name)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
        <img src={url} alt={name ?? "添付画像"}
          className="max-h-60 rounded-xl border border-zinc-200 dark:border-zinc-700 object-cover hover:opacity-95" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" download={name ?? undefined}
      className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700">
      <Clip />{name ?? "添付ファイル"}
    </a>
  );
}

// ── 返信スレッド表示＋入力 ─────────────────────────────────
// 添付ピッカー（選択中ファイルのチップ＋クリップボタン）。共通利用。
function AttachPicker({ file, onPick, onClear }: {
  file: File | null; onPick: (f: File | null) => void; onClear: () => void;
}) {
  return (
    <>
      {file && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 mb-1 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <Clip /><span className="text-xs flex-1 truncate text-zinc-700 dark:text-zinc-300">{file.name}</span>
          <button type="button" onClick={onClear} className="text-zinc-400 hover:text-red-500 text-xs">✕</button>
        </div>
      )}
      <label className="p-2 rounded-xl text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer flex-shrink-0" title="ファイルを添付">
        <Clip />
        <input type="file" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > MAX_FILE_SIZE) { alert("ファイルが大きすぎます（最大10MB）"); e.target.value = ""; return; }
            onPick(f); e.target.value = "";
          }} />
      </label>
    </>
  );
}

function ReplyThread({
  messageId, threadStaffId, replies, myStaffId, canReply,
}: {
  messageId: string; threadStaffId: string; replies: MessageReply[];
  myStaffId: string; canReply: boolean;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!text.trim() && !file) return;
    setError(null);
    const fd = new FormData();
    fd.set("messageId", messageId);
    fd.set("threadStaffId", threadStaffId);
    fd.set("body", text.trim());
    if (file) fd.set("attachment", file);
    startTransition(async () => {
      const r = await replyMessageAction(fd);
      if (!r.success) setError(r.message ?? "失敗しました");
      else { setText(""); setFile(null); }
    });
  }

  return (
    <div className="mt-2 space-y-2">
      {replies.map(r => {
        const mine = r.authorStaffId === myStaffId;
        return (
          <div key={r.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
              mine ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
            }`}>
              {!mine && <p className="text-[10px] font-semibold opacity-70 mb-0.5">{r.authorName}</p>}
              {r.body && <p className="text-sm whitespace-pre-wrap break-words">{r.body}</p>}
              {r.attachmentUrl && <Attachment url={r.attachmentUrl} name={r.attachmentName} />}
              <p className={`text-[10px] mt-0.5 tabular-nums ${mine ? "text-blue-100" : "text-zinc-400"}`}>{fmt(r.createdAt)}</p>
            </div>
          </div>
        );
      })}
      {canReply && (
        <div>
          <AttachPicker file={file} onPick={setFile} onClear={() => setFile(null)} />
          <div className="flex items-end gap-2 pt-1">
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="返信を入力…" rows={1}
              className="flex-1 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none" />
            <button type="button" onClick={submit} disabled={isPending || (!text.trim() && !file)}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium flex-shrink-0">
              {isPending ? "…" : "送信"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  管理者：送信モーダル
// ════════════════════════════════════════════════════════════
function ComposeModal({
  members, sections, onClose,
}: {
  members: { id: string; name: string }[];
  sections: string[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceType>("all");
  const [selSections, setSelSections] = useState<Set<string>>(new Set());
  const [selStaff, setSelStaff] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [allowReply, setAllowReply] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredMembers = useMemo(() => {
    const q = search.trim();
    return q ? members.filter(m => m.name.includes(q)) : members;
  }, [members, search]);

  function toggle(set: Set<string>, v: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  }

  const recipientCount = useMemo(() => {
    if (audience === "all") return members.length;
    if (audience === "staff") return selStaff.size;
    return null; // section は送信時に解決
  }, [audience, members.length, selStaff]);

  function submit() {
    setError(null);
    if (!body.trim()) { setError("本文を入力してください"); return; }
    if (audience === "section" && selSections.size === 0) { setError("セクションを選択してください"); return; }
    if (audience === "staff" && selStaff.size === 0) { setError("スタッフを選択してください"); return; }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("body", body);
    fd.set("audienceType", audience);
    fd.set("isPinned", String(isPinned));
    fd.set("allowReply", String(allowReply));
    fd.set("sections", JSON.stringify([...selSections]));
    fd.set("staffIds", JSON.stringify([...selStaff]));
    if (file) fd.set("attachment", file);
    startTransition(async () => {
      const r = await sendMessageAction(fd);
      if (!r.success) setError(r.message ?? "失敗しました");
      else onClose();
    });
  }

  const TABS: { k: AudienceType; label: string }[] = [
    { k: "all", label: "全員" },
    { k: "section", label: "セクション" },
    { k: "staff", label: "個別" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 shadow-xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-4 text-zinc-900 dark:text-zinc-50">メッセージを送信</h2>

        {/* 宛先タブ */}
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">宛先</label>
        <div className="flex gap-2 mb-2">
          {TABS.map(t => (
            <button key={t.k} type="button" onClick={() => setAudience(t.k)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                audience === t.k ? "bg-blue-600 text-white border-blue-600"
                  : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}>{t.label}</button>
          ))}
        </div>

        {audience === "section" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {sections.length === 0 && <p className="text-xs text-zinc-400">セクションがありません</p>}
            {sections.map(s => {
              const on = selSections.has(s);
              return (
                <button key={s} type="button" onClick={() => toggle(selSections, s, setSelSections)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    on ? "bg-blue-600 text-white border-blue-600"
                      : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                  }`}>{s}</button>
              );
            })}
          </div>
        )}

        {audience === "staff" && (
          <div className="mb-3 space-y-2">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="名前で検索…"
              className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
            {selStaff.size > 0 && (
              <p className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">{selStaff.size}人 選択中</p>
            )}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-40 overflow-y-auto">
              {filteredMembers.map(m => {
                const on = selStaff.has(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => toggle(selStaff, m.id, setSelStaff)}
                    className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs border-b border-zinc-100 dark:border-zinc-800 last:border-0 ${
                      on ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? "bg-blue-600 border-blue-600 text-white" : "border-zinc-300 dark:border-zinc-600"}`}>
                      {on && "✓"}
                    </span>
                    <span className="text-zinc-700 dark:text-zinc-300">{m.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">タイトル（任意）</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="例：シフトについて"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">本文</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
              placeholder="メッセージ内容を入力してください"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">添付ファイル（最大10MB）</label>
            {file ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <Clip /><span className="text-xs flex-1 truncate text-zinc-700 dark:text-zinc-300">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-zinc-400 hover:text-red-500 text-xs">✕</button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs">
                <Clip />クリックしてファイルを選択
                <input ref={fileRef} type="file" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > MAX_FILE_SIZE) { setError("ファイルが大きすぎます（最大10MB）"); e.target.value = ""; return; }
                    setFile(f); e.target.value = "";
                  }} />
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">上部に固定する</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={allowReply} onChange={e => setAllowReply(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">返信を受け付ける<span className="text-xs text-zinc-400 ml-1">（OFF＝確認のみのお知らせ）</span></span>
          </label>

          {recipientCount !== null && (
            <p className="text-[11px] text-zinc-400">送信先: {recipientCount}人</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">キャンセル</button>
            <button type="button" onClick={submit} disabled={isPending}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
              {isPending ? "送信中…" : "送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  スタッフ：管理者へ送るモーダル
// ════════════════════════════════════════════════════════════
function StaffComposeModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function submit() {
    setError(null);
    if (!body.trim()) { setError("内容を入力してください"); return; }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("body", body);
    startTransition(async () => {
      const r = await staffStartMessageAction(fd);
      if (!r.success) setError(r.message ?? "失敗しました");
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-1 text-zinc-900 dark:text-zinc-50">管理者へメッセージ</h2>
        <p className="text-xs text-zinc-400 mb-4">問い合わせ・相談などを送れます。返信はこの画面に届きます。</p>
        <div className="space-y-3">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="件名（任意）"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
            placeholder="内容を入力してください"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">キャンセル</button>
            <button type="button" onClick={submit} disabled={isPending}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
              {isPending ? "送信中…" : "送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  管理者：1メッセージのカード（受信者ごとのスレッド）
// ════════════════════════════════════════════════════════════
function AdminMessageCard({ m, myStaffId }: { m: AdminMessage; myStaffId: string }) {
  const [open, setOpen] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const attentionCount = m.threads.filter(t => t.needsAttention).length;

  function openThreadAndRead(t: AdminThread) {
    const next = openThread === t.staffId ? null : t.staffId;
    setOpenThread(next);
    if (next && t.needsAttention) {
      startTransition(() => { markThreadReadAction(m.id, t.staffId); });
    }
  }

  function del() {
    if (!confirm("このメッセージを削除しますか？（全受信者ぶん削除されます）")) return;
    const fd = new FormData(); fd.set("id", m.id);
    startTransition(() => { deleteMessageAction(fd); });
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-950 overflow-hidden ${
      m.isPinned ? "border-blue-200 dark:border-blue-800" : "border-zinc-100 dark:border-zinc-800"
    }`}>
      <div className="flex items-center gap-2 px-3 pt-2.5 flex-wrap">
        <span className="text-[11px] text-zinc-400 tabular-nums">{fmt(m.createdAt)}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-semibold">
          {m.audienceType === "admins" ? "問い合わせ" : AUDIENCE_LABEL[m.audienceType]}
        </span>
        <span className="text-[11px] text-zinc-400">{m.senderName}</span>
        {attentionCount > 0 && (
          <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 leading-none">新着{attentionCount}</span>
        )}
        {m.isPinned && <span className="text-[10px] font-semibold text-blue-500 border border-blue-200 dark:border-blue-700 rounded px-1.5 py-0.5 ml-auto">固定</span>}
      </div>

      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate flex-1">
          {m.title || m.body.slice(0, 40)}
          <span className="ml-2 text-[11px] font-normal text-zinc-400">宛先{m.threads.length}人</span>
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
          <pre className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans py-3">{m.body}</pre>
          {m.attachmentUrl && <Attachment url={m.attachmentUrl} name={m.attachmentName} />}

          <div className="mt-3">
            <p className="text-[11px] font-semibold text-zinc-400 mb-1.5">受信者ごとのやり取り</p>
            <div className="space-y-1.5">
              {m.threads.map(t => {
                const isOpen = openThread === t.staffId;
                return (
                  <div key={t.staffId} className="rounded-lg border border-zinc-100 dark:border-zinc-800">
                    <button type="button" onClick={() => openThreadAndRead(t)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex-1 truncate">{t.staffName}</span>
                      {t.needsAttention && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                      {t.replies.length > 0 && <span className="text-[10px] text-zinc-400">{t.replies.length}件</span>}
                      {!t.staffReadAt && t.replies.length === 0 && <span className="text-[10px] text-zinc-300">未読</span>}
                      <Chevron open={isOpen} />
                    </button>
                    {isOpen && (
                      <div className="px-2.5 pb-2.5">
                        <ReplyThread messageId={m.id} threadStaffId={t.staffId}
                          replies={t.replies} myStaffId={myStaffId} canReply={m.allowReply} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button type="button" onClick={del} className="mt-3 text-[11px] text-red-500 hover:text-red-600">削除</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  スタッフ：1メッセージのカード
// ════════════════════════════════════════════════════════════
function StaffMessageCard({ m, myStaffId, defaultOpen }: { m: StaffMessage; myStaffId: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && m.hasUnread) {
      startTransition(() => { markThreadReadAction(m.messageId, myStaffId); });
    }
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-950 overflow-hidden ${
      m.isPinned ? "border-blue-200 dark:border-blue-800" : "border-zinc-100 dark:border-zinc-800"
    }`}>
      <button type="button" onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
        {m.hasUnread && <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm truncate ${m.hasUnread ? "font-bold text-zinc-900 dark:text-zinc-50" : "font-semibold text-zinc-700 dark:text-zinc-200"}`}>
              {m.title || m.body.slice(0, 30)}
            </span>
            {m.iAmSender && <span className="text-[10px] text-zinc-400 flex-shrink-0">送信済</span>}
          </div>
          <p className="text-[11px] text-zinc-400 tabular-nums">{m.iAmSender ? "管理者へ" : m.senderName} · {fmt(m.createdAt)}</p>
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
          <pre className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans py-3">{m.body}</pre>
          {m.attachmentUrl && <Attachment url={m.attachmentUrl} name={m.attachmentName} />}
          <ReplyThread messageId={m.messageId} threadStaffId={myStaffId}
            replies={m.replies} myStaffId={myStaffId} canReply={m.allowReply} />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  管理者：スタッフ別チャットルーム（LINE風）
// ════════════════════════════════════════════════════════════
function RoomView({ room, onBack }: { room: StaffRoom; onBack: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 開いたら既読化
  useEffect(() => {
    if (room.unreadCount > 0) {
      startTransition(() => { markStaffRoomReadAction(room.staffId); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.staffId]);

  function send() {
    if (!text.trim() && !file) return;
    setError(null);
    const fd = new FormData();
    fd.set("staffId", room.staffId);
    fd.set("body", text.trim());
    if (file) fd.set("attachment", file);
    startTransition(async () => {
      const r = await sendDirectMessageAction(fd);
      if (!r.success) setError(r.message ?? "失敗しました");
      else { setText(""); setFile(null); }
    });
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-9rem)]">
      {/* ルームヘッダー */}
      <div className="flex items-center gap-2 px-1 pb-2 border-b border-zinc-100 dark:border-zinc-800">
        <button type="button" onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-base font-bold text-zinc-900 dark:text-zinc-50">{room.staffName}</span>
      </div>

      {/* タイムライン */}
      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        {room.items.length === 0 ? (
          <p className="text-center text-xs text-zinc-400 py-10">まだやり取りがありません。下から送信できます。</p>
        ) : room.items.map(it => {
          const right = it.side === "admin";
          return (
            <div key={it.id} className={`flex ${right ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                right ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-100 dark:border-zinc-700"
              }`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  {it.isBroadcast && (
                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${right ? "bg-blue-500 text-blue-50" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"}`}>配信</span>
                  )}
                  {!right && <span className="text-[10px] font-semibold opacity-60">{it.authorName}</span>}
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{it.body}</p>
                {it.attachmentUrl && <Attachment url={it.attachmentUrl} name={it.attachmentName} />}
                <p className={`text-[10px] mt-0.5 tabular-nums ${right ? "text-blue-100" : "text-zinc-400"}`}>{fmt(it.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 入力 */}
      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
        {error && <p className="text-xs text-red-600 mb-1">{error}</p>}
        {file && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 mb-1 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <Clip /><span className="text-xs flex-1 truncate text-zinc-700 dark:text-zinc-300">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} className="text-zinc-400 hover:text-red-500 text-xs">✕</button>
          </div>
        )}
        <div className="flex items-end gap-1">
          <label className="p-2 rounded-xl text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer flex-shrink-0" title="ファイルを添付">
            <Clip />
            <input type="file" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_FILE_SIZE) { alert("ファイルが大きすぎます（最大10MB）"); e.target.value = ""; return; }
                setFile(f); e.target.value = "";
              }} />
          </label>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder={`${room.staffName} さんへ送信…`} rows={1}
            className="flex-1 px-3 py-2 rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none max-h-32" />
          <button type="button" onClick={send} disabled={isPending || (!text.trim() && !file)}
            className="px-4 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold flex-shrink-0">
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactList({ rooms, onOpen }: { rooms: StaffRoom[]; onOpen: (r: StaffRoom) => void }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return rooms;
    return rooms.filter(r => r.staffName.includes(q) || r.lastSnippet.includes(q));
  }, [rooms, search]);

  return (
    <>
      <div className="relative mb-3">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="スタッフを検索…"
          className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {filtered.map(r => (
          <button key={r.staffId} type="button" onClick={() => onOpen(r)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-500 dark:text-zinc-300 flex-shrink-0">
              {r.staffName.slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm truncate ${r.unreadCount > 0 ? "font-bold text-zinc-900 dark:text-zinc-50" : "font-semibold text-zinc-700 dark:text-zinc-200"}`}>{r.staffName}</span>
                {r.lastActivityAt && <span className="text-[10px] text-zinc-400 tabular-nums ml-auto flex-shrink-0">{fmt(r.lastActivityAt)}</span>}
              </div>
              <p className="text-xs text-zinc-400 truncate">{r.lastSnippet || "（やり取りなし）"}</p>
            </div>
            {r.unreadCount > 0 && (
              <span className="text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center flex-shrink-0">{r.unreadCount}</span>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-10">該当するスタッフがいません</p>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════
//  管理者ビュー（スタッフ別チャット / 送信履歴 のタブ）
// ════════════════════════════════════════════════════════════
function AdminView({
  myStaffId, adminMessages, staffRooms, members, sections,
}: {
  myStaffId: string;
  adminMessages: AdminMessage[];
  staffRooms: StaffRoom[];
  members: { id: string; name: string }[];
  sections: string[];
}) {
  const [tab, setTab] = useState<"staff" | "history">("staff");
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [histSearch, setHistSearch] = useState("");

  const openRoom = openRoomId ? staffRooms.find(r => r.staffId === openRoomId) ?? null : null;
  const totalUnread = staffRooms.reduce((s, r) => s + r.unreadCount, 0);

  const filteredHistory = useMemo(() => {
    const q = histSearch.trim();
    if (!q) return adminMessages;
    return adminMessages.filter(m => (m.title ?? "").includes(q) || m.body.includes(q));
  }, [adminMessages, histSearch]);

  // ルーム表示中はヘッダー/タブを隠してチャットに集中
  if (openRoom) {
    return (
      <main className="min-h-[100dvh] bg-[#F5F5F7] dark:bg-zinc-950">
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <RoomView room={openRoom} onBack={() => setOpenRoomId(null)} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 pt-5 pb-2 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">メッセージ</h1>
          {tab === "history" && (
            <button type="button" onClick={() => setCompose(true)}
              className="flex-shrink-0 text-sm px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              ＋ 新規配信
            </button>
          )}
        </div>
        <div className="max-w-3xl mx-auto px-4 flex gap-1">
          <button type="button" onClick={() => setTab("staff")}
            className={`relative px-3 py-2 text-sm font-semibold border-b-2 ${tab === "staff" ? "border-blue-600 text-blue-600" : "border-transparent text-zinc-400"}`}>
            スタッフ
            {totalUnread > 0 && <span className="ml-1 text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 align-middle">{totalUnread}</span>}
          </button>
          <button type="button" onClick={() => setTab("history")}
            className={`px-3 py-2 text-sm font-semibold border-b-2 ${tab === "history" ? "border-blue-600 text-blue-600" : "border-transparent text-zinc-400"}`}>
            送信履歴
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 pb-24">
        {tab === "staff" ? (
          <ContactList rooms={staffRooms} onOpen={r => setOpenRoomId(r.staffId)} />
        ) : (
          <>
            <div className="relative mb-3">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={histSearch} onChange={e => setHistSearch(e.target.value)}
                placeholder="件名・本文で検索…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="space-y-2">
              {filteredHistory.length > 0 ? (
                filteredHistory.map(m => <AdminMessageCard key={m.id} m={m} myStaffId={myStaffId} />)
              ) : (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 text-center">
                  <p className="text-sm text-zinc-500">{histSearch ? "該当する配信がありません" : "まだ配信がありません"}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {compose && <ComposeModal members={members} sections={sections} onClose={() => setCompose(false)} />}
    </main>
  );
}

// ════════════════════════════════════════════════════════════
//  メイン
// ════════════════════════════════════════════════════════════
export default function MessagesClient({
  isAdmin, myStaffId, adminMessages, staffMessages, staffRooms = [], members, sections, initialOpenId,
}: {
  isAdmin: boolean;
  myStaffId: string;
  adminMessages: AdminMessage[];
  staffMessages: StaffMessage[];
  staffRooms?: StaffRoom[];
  members: { id: string; name: string }[];
  sections: string[];
  initialOpenId: string | null;
}) {
  const [compose, setCompose] = useState(false);
  const [search, setSearch] = useState("");

  if (isAdmin) {
    return (
      <AdminView
        myStaffId={myStaffId}
        adminMessages={adminMessages}
        staffRooms={staffRooms}
        members={members}
        sections={sections}
      />
    );
  }

  // ── スタッフ受信箱 ──
  const unreadCount = staffMessages.filter(m => m.hasUnread).length;
  const filteredStaff = (() => {
    const q = search.trim();
    if (!q) return staffMessages;
    return staffMessages.filter(m =>
      (m.title ?? "").includes(q) || m.body.includes(q) || m.senderName.includes(q));
  })();

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 pt-5 pb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">メッセージ</h1>
            {unreadCount > 0 && (
              <p className="text-sm font-semibold text-red-500 mt-0.5">未読 {unreadCount}件</p>
            )}
          </div>
          <button type="button" onClick={() => setCompose(true)}
            className="flex-shrink-0 text-sm px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">
            ＋ 管理者へ
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 pb-24">
        <div className="relative mb-3">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="件名・本文・相手で検索…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div className="space-y-2">
          {filteredStaff.length > 0 ? (
            filteredStaff.map(m => (
              <StaffMessageCard key={m.messageId} m={m} myStaffId={myStaffId}
                defaultOpen={initialOpenId === m.messageId} />
            ))
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 text-center">
              <p className="text-sm text-zinc-500">{search ? "該当するメッセージがありません" : "まだメッセージがありません"}</p>
            </div>
          )}
        </div>
      </div>

      {compose && <StaffComposeModal onClose={() => setCompose(false)} />}
    </main>
  );
}
