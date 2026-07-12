"use client";

import { useState, useTransition } from "react";
import { toggleStaffSkillAction, addSkillItemAction, deleteSkillItemAction, toggleSkillValueAction } from "./actions";

export type SkillMember = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  mainSection: string | null;
  sections: string[];
  itemValues: Record<string, boolean>;
};

export type SkillItem = { id: string; label: string };

const ACC_W = 96;
const NAME_W = 112;
const MAIN_W = 96;

export default function SkillsMatrixClient({
  projectId,
  projectName,
  members,
  availableSections,
  skillItems,
}: {
  projectId: string;
  projectName?: string;
  members: SkillMember[];
  availableSections: string[];
  skillItems: SkillItem[];
}) {
  const [rows, setRows] = useState(members);
  const [items, setItems] = useState(skillItems);
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [itemBusy, setItemBusy] = useState(false);

  const filtered = rows.filter(m => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || (m.accountNumber ?? "").toLowerCase().includes(q);
  });

  function toggle(m: SkillMember, section: string) {
    const key = `${m.staffId}:${section}`;
    const enabled = !m.sections.includes(section);
    setPendingKey(key);
    setErrorMsg(null);
    // 楽観的更新
    setRows(prev => prev.map(r => r.staffId === m.staffId
      ? { ...r, sections: enabled ? [...r.sections, section] : r.sections.filter(s => s !== section) }
      : r
    ));
    startTransition(async () => {
      const res = await toggleStaffSkillAction(projectId, m.staffId, section, enabled);
      if (!res.success) {
        // ロールバック
        setRows(prev => prev.map(r => r.staffId === m.staffId
          ? { ...r, sections: enabled ? r.sections.filter(s => s !== section) : [...r.sections, section] }
          : r
        ));
        setErrorMsg(res.message ?? "保存できませんでした");
      }
      setPendingKey(null);
    });
  }

  function toggleItem(m: SkillMember, item: SkillItem) {
    const key = `${m.staffId}:item:${item.id}`;
    const next = !(m.itemValues[item.id] ?? false);
    setPendingKey(key);
    setErrorMsg(null);
    setRows(prev => prev.map(r => r.staffId === m.staffId
      ? { ...r, itemValues: { ...r.itemValues, [item.id]: next } }
      : r
    ));
    startTransition(async () => {
      const res = await toggleSkillValueAction(projectId, m.staffId, item.id, next);
      if (!res.success) {
        setRows(prev => prev.map(r => r.staffId === m.staffId
          ? { ...r, itemValues: { ...r.itemValues, [item.id]: !next } }
          : r
        ));
        setErrorMsg(res.message ?? "保存できませんでした");
      }
      setPendingKey(null);
    });
  }

  function handleAddItem() {
    const label = newItemLabel.trim();
    if (!label || itemBusy) return;
    setItemBusy(true);
    setErrorMsg(null);
    startTransition(async () => {
      const res = await addSkillItemAction(projectId, label);
      if (res.success && res.itemId) {
        setItems(prev => [...prev, { id: res.itemId!, label }]);
        setNewItemLabel("");
        setShowAddItem(false);
      } else {
        setErrorMsg(res.message ?? "追加できませんでした");
      }
      setItemBusy(false);
    });
  }

  function handleDeleteItem(item: SkillItem) {
    if (itemBusy) return;
    if (!window.confirm(`項目「${item.label}」を削除しますか？\n全スタッフの○×も消えます。`)) return;
    setItemBusy(true);
    setErrorMsg(null);
    startTransition(async () => {
      const res = await deleteSkillItemAction(projectId, item.id);
      if (res.success) {
        setItems(prev => prev.filter(i => i.id !== item.id));
      } else {
        setErrorMsg(res.message ?? "削除できませんでした");
      }
      setItemBusy(false);
    });
  }

  return (
    <div className="space-y-3 py-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">スキル管理</h1>
        {projectName && <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-zinc-500">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{filtered.length}</span>
          {filtered.length !== rows.length && <> / {rows.length}</>}名
        </p>
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-300 dark:bg-blue-900/40 dark:border-blue-700 inline-block" />
            対応可能
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900 inline-block" />
            対応不可
          </span>
          <span className="hidden sm:inline">（タップで切替）</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={`/api/admin/skills/export?projectId=${encodeURIComponent(projectId)}`}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
        >
          Excel出力
        </a>
        {showAddItem ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newItemLabel}
              onChange={e => setNewItemLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAddItem(); }}
              placeholder="項目名（例: 導入研修済み）"
              maxLength={20}
              autoFocus
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-48"
            />
            <button
              type="button"
              onClick={handleAddItem}
              disabled={itemBusy || !newItemLabel.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >追加</button>
            <button
              type="button"
              onClick={() => { setShowAddItem(false); setNewItemLabel(""); }}
              className="px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >キャンセル</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddItem(true)}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >＋ 項目追加</button>
        )}
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="名前・アカウント番号で検索"
          className="w-full pl-9 pr-8 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition"
        />
      </div>

      {errorMsg && (
        <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">
          ✗ {errorMsg}
        </p>
      )}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: MAIN_W + ACC_W + NAME_W + (availableSections.length + items.length) * 84 }}>
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-950 sticky top-0 z-20">
                <th
                  className="sticky left-0 z-30 bg-zinc-50 dark:bg-zinc-950 border-b border-r border-zinc-200 dark:border-zinc-800 px-2 py-2 text-left font-semibold text-zinc-500"
                  style={{ width: MAIN_W, minWidth: MAIN_W }}
                >メインセクション</th>
                <th
                  className="sticky z-30 bg-zinc-50 dark:bg-zinc-950 border-b border-r border-zinc-200 dark:border-zinc-800 px-2 py-2 text-left font-semibold text-zinc-500"
                  style={{ left: MAIN_W, width: ACC_W, minWidth: ACC_W }}
                >アカウント番号</th>
                <th
                  className="sticky z-30 bg-zinc-50 dark:bg-zinc-950 border-b border-r border-zinc-200 dark:border-zinc-800 px-2 py-2 text-left font-semibold text-zinc-500"
                  style={{ left: MAIN_W + ACC_W, width: NAME_W, minWidth: NAME_W }}
                >名前</th>
                {availableSections.map(s => (
                  <th key={s}
                    className="border-b border-r border-zinc-200 dark:border-zinc-800 px-1.5 py-2 text-center font-semibold text-zinc-500 whitespace-nowrap"
                    style={{ width: 84, minWidth: 84 }}
                  >{s}</th>
                ))}
                {items.map(item => (
                  <th key={item.id}
                    className="border-b border-r border-zinc-200 dark:border-zinc-800 px-1.5 py-2 text-center font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap"
                    style={{ width: 84, minWidth: 84 }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {item.label}
                      <button
                        type="button"
                        title="項目を削除"
                        onClick={() => handleDeleteItem(item)}
                        className="w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[9px] text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >✕</button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={m.staffId} className={i % 2 === 1 ? "bg-zinc-50/60 dark:bg-zinc-950/40" : ""}>
                  <td
                    className="sticky left-0 z-10 bg-inherit border-b border-r border-zinc-100 dark:border-zinc-800 px-2 py-1.5 text-zinc-500 dark:text-zinc-400 truncate"
                    style={{ width: MAIN_W, minWidth: MAIN_W, backgroundColor: "inherit" }}
                  >{m.mainSection ?? "―"}</td>
                  <td
                    className="sticky z-10 bg-inherit border-b border-r border-zinc-100 dark:border-zinc-800 px-2 py-1.5 font-mono tabular-nums text-zinc-500 dark:text-zinc-400"
                    style={{ left: MAIN_W, width: ACC_W, minWidth: ACC_W, backgroundColor: "inherit" }}
                  >{m.accountNumber ?? "―"}</td>
                  <td
                    className="sticky z-10 bg-inherit border-b border-r border-zinc-100 dark:border-zinc-800 px-2 py-1.5 font-semibold text-zinc-800 dark:text-zinc-100 truncate"
                    style={{ left: MAIN_W + ACC_W, width: NAME_W, minWidth: NAME_W, backgroundColor: "inherit" }}
                  >{m.name}</td>
                  {availableSections.map(s => {
                    const capable = m.sections.includes(s);
                    const key = `${m.staffId}:${s}`;
                    const isPending = pendingKey === key;
                    return (
                      <td key={s} className="border-b border-r border-zinc-100 dark:border-zinc-800 p-0.5 text-center"
                        style={{ width: 84, minWidth: 84 }}
                      >
                        <ToggleCell
                          capable={capable}
                          pending={isPending}
                          onClick={() => toggle(m, s)}
                        />
                      </td>
                    );
                  })}
                  {items.map(item => {
                    const on = m.itemValues[item.id] ?? false;
                    const key = `${m.staffId}:item:${item.id}`;
                    const isPending = pendingKey === key;
                    return (
                      <td key={item.id} className="border-b border-r border-zinc-100 dark:border-zinc-800 p-0.5 text-center"
                        style={{ width: 84, minWidth: 84 }}
                      >
                        <ToggleCell
                          capable={on}
                          pending={isPending}
                          onClick={() => toggleItem(m, item)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3 + availableSections.length + items.length} className="px-3 py-8 text-center text-zinc-400">
                    該当するメンバーがいません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ToggleCell({ capable, pending, onClick }: { capable: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={[
        "w-full h-7 rounded-md text-[11px] font-bold transition-colors disabled:opacity-50",
        capable
          ? "bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/60"
          : "bg-red-50 text-red-400 border border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-500 dark:border-red-900 dark:hover:bg-red-950/50",
      ].join(" ")}
    >
      {pending ? "…" : capable ? "○" : "×"}
    </button>
  );
}
