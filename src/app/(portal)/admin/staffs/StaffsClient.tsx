"use client";

import { useState, useTransition, useMemo } from "react";
import {
  toggleStaffActiveAction,
  resetStaffPasswordAction,
  updateStaffInfoAction,
} from "./actions";

type StaffProject = { id: string; name: string; role: string };
type StaffEntry = {
  id: string; name: string; company_name: string | null;
  global_role: string; is_active: boolean; must_change_password: boolean;
  projects: StaffProject[];
};

const ROLE_BADGE: Record<string, string> = {
  executive: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
  admin:     "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
};
const ROLE_LABEL: Record<string, string> = { executive: "運用者", admin: "管理者", staff: "スタッフ" };

const AVATAR_COLORS = [
  "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300",
  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300",
  "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300",
  "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300",
  "bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300",
  "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300",
  "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300",
];
const EXEC_AVATAR = "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300";
const ADMIN_AVATAR = "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300";

export default function StaffsClient({ staffs }: { staffs: StaffEntry[] }) {
  const [isPending, start]  = useTransition();
  const [toast, setToast]   = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterRole, setFilterRole]       = useState("");
  const [showInactive, setShowInactive]   = useState(false);

  const [editId, setEditId]           = useState<string | null>(null);
  const [editName, setEditName]       = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editRole, setEditRole]       = useState("staff");

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  const companies = useMemo(() =>
    [...new Set(staffs.map(s => s.company_name).filter((c): c is string => !!c))].sort(), [staffs]);
  const companyColorMap = useMemo(() =>
    new Map(companies.map((c, i) => [c, AVATAR_COLORS[i % AVATAR_COLORS.length]])), [companies]);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffs) for (const p of s.projects) m.set(p.id, p.name);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [staffs]);

  function avatarColor(s: StaffEntry) {
    if (s.global_role === "executive") return EXEC_AVATAR;
    if (s.global_role === "admin")     return ADMIN_AVATAR;
    return companyColorMap.get(s.company_name ?? "") ?? AVATAR_COLORS[AVATAR_COLORS.length - 1];
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return staffs.filter(s => {
      if (!showInactive && !s.is_active) return false;
      if (filterCompany && s.company_name !== filterCompany) return false;
      if (filterProject && !s.projects.some(p => p.id === filterProject)) return false;
      if (filterRole && s.global_role !== filterRole) return false;
      if (q && ![s.name, s.id, s.company_name ?? "", ...s.projects.map(p => p.name)]
        .some(v => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [staffs, search, filterCompany, filterProject, filterRole, showInactive]);

  function handleSave() {
    if (!editId || !editName.trim()) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", editId);
      fd.set("name", editName);
      fd.set("company_name", editCompany);
      fd.set("global_role", editRole);
      const r = await updateStaffInfoAction(fd);
      notify(r.message ?? (r.success ? "更新しました" : "エラー"));
      if (r.success) setEditId(null);
    });
  }

  function handleToggle(s: StaffEntry) {
    start(async () => {
      const fd = new FormData(); fd.set("id", s.id); fd.set("is_active", String(!s.is_active));
      const r = await toggleStaffActiveAction(fd);
      if (!r.success) notify(r.message ?? "エラー");
    });
  }

  function handlePW(s: StaffEntry) {
    start(async () => {
      const fd = new FormData(); fd.set("id", s.id);
      const r = await resetStaffPasswordAction(fd);
      notify(r.message ?? (r.success ? "リセットしました" : "エラー"));
    });
  }

  const inactiveCount = staffs.filter(s => !s.is_active).length;

  return (
    <div className="space-y-4">

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm shadow-xl">
          {toast}
        </div>
      )}

      {/* 統計チップ */}
      <div className="flex flex-wrap gap-2">
        {([
          ["稼働中",   staffs.filter(s => s.is_active).length,             "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"],
          ["運用者",   staffs.filter(s => s.global_role === "executive").length, "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"],
          ["管理者",   staffs.filter(s => s.global_role === "admin").length,     "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"],
          ["スタッフ", staffs.filter(s => s.global_role === "staff").length,     "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"],
          ["社",       companies.length,                                          "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"],
        ] as [string, number, string][]).map(([label, count, cls]) => (
          <span key={label} className={`px-3 py-1 rounded-full text-xs font-semibold tabular-nums ${cls}`}>
            {count}{label}
          </span>
        ))}
      </div>

      {/* 検索 */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
        </svg>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="氏名・ID・会社名・案件で検索"
          className="w-full pl-9 pr-8 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm">×</button>
        )}
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap gap-2">
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none">
          <option value="">すべての会社</option>
          {companies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none">
          <option value="">すべての案件</option>
          {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none">
          <option value="">すべてのロール</option>
          <option value="executive">運用者</option>
          <option value="admin">管理者</option>
          <option value="staff">スタッフ</option>
        </select>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-500 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
              className="w-3.5 h-3.5 accent-zinc-600" />
            無効も表示
          </label>
        )}
      </div>

      <p className="text-xs text-zinc-400 tabular-nums">
        {filtered.length !== staffs.length ? `${filtered.length} / ${staffs.length}名` : `${filtered.length}名`}
      </p>

      {/* ── カード一覧 ── */}
      <ul className="space-y-2">
        {filtered.map(s => {
          const isEditing = editId === s.id;

          return (
            <li key={s.id}
              className={`rounded-2xl border bg-white dark:bg-zinc-900 px-4 py-3 flex items-center gap-3 ${
                s.is_active
                  ? "border-zinc-200 dark:border-zinc-800"
                  : "border-zinc-100 dark:border-zinc-800/40 opacity-55"
              }`}
            >
              {/* アバター（左端・縦中央） */}
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 ${avatarColor(s)}`}>
                {s.name[0]}
              </div>

              {/* 情報列（中央・3行） */}
              {isEditing ? (
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-400 font-semibold">氏名</label>
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 font-semibold">所属会社</label>
                      <input type="text" value={editCompany} onChange={e => setEditCompany(e.target.value)}
                        placeholder="任意"
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 font-semibold">システム役割</label>
                    <select value={editRole} onChange={e => setEditRole(e.target.value)}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                      <option value="staff">スタッフ</option>
                      <option value="admin">管理者（全社）</option>
                      <option value="executive">運用者</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditId(null)}
                      className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      キャンセル
                    </button>
                    <button onClick={handleSave} disabled={!editName.trim() || isPending}
                      className="flex-1 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-40">
                      {isPending ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  {/* 行1：ID · 会社 · 案件 */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[11px] text-zinc-400 tracking-wide">{s.id}</span>
                    {s.company_name && (
                      <>
                        <span className="text-zinc-200 dark:text-zinc-700 text-[10px]">·</span>
                        <span className="text-[11px] text-zinc-400 truncate max-w-[120px]">{s.company_name}</span>
                      </>
                    )}
                    {!s.company_name && (
                      <span className="text-[11px] text-zinc-300 dark:text-zinc-600 italic">会社名未設定</span>
                    )}
                  </div>

                  {/* 行2：氏名（大きめ） */}
                  <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug mt-0.5">
                    {s.name}
                  </p>

                  {/* 行3：ロールバッジ + その他バッジ */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {ROLE_BADGE[s.global_role] ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ROLE_BADGE[s.global_role]}`}>
                        {ROLE_LABEL[s.global_role]}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                        スタッフ
                      </span>
                    )}
                    {s.must_change_password && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">
                        初回PW未変更
                      </span>
                    )}
                    {!s.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                        無効
                      </span>
                    )}
                    {s.projects.map(p => (
                      <a key={p.id} href={`/admin/${p.id}/settings`}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        {p.name}（{p.id}）{p.role === "project_admin" ? "★" : ""}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ボタン列（右端・縦積み） */}
              {!isEditing && (
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { setEditId(s.id); setEditName(s.name); setEditCompany(s.company_name ?? ""); setEditRole(s.global_role); }}
                    disabled={isPending}
                    className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handlePW(s)}
                    disabled={isPending}
                    className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    PW初期化
                  </button>
                  <button
                    onClick={() => handleToggle(s)}
                    disabled={isPending}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-medium disabled:opacity-40 whitespace-nowrap ${
                      s.is_active
                        ? "border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : "border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                    }`}
                  >
                    {s.is_active ? "無効化" : "有効化"}
                  </button>
                </div>
              )}
            </li>
          );
        })}

        {filtered.length === 0 && (
          <li className="text-sm text-zinc-400 text-center py-12">
            {search || filterCompany || filterProject || filterRole
              ? "条件に一致するアカウントが見つかりません"
              : "アカウントがありません"}
          </li>
        )}
      </ul>
    </div>
  );
}
