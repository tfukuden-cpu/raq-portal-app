"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import LineConnectionSection from "./LineConnectionSection";
import RankingTab from "@/app/(portal)/members/RankingTab";
import TrainingSection, { type TrainingDate, type TrainingEntry } from "@/components/TrainingSection";
import HolidayRequestSection, { type HolidayRequestEntry } from "@/components/HolidayRequestSection";
import { fetchTrainingDatesAction } from "./training-actions";
import { fetchHolidayRequestsForStaffAction } from "./holiday-request-actions";
import {
  updateProjectNameAction,
  saveSheetUrlAction,
  createSpreadsheetAction,
  removeMemberAction,
  updateMemberRoleAction,
  updateMemberInfoAction,
  saveShiftPatternsAction,
  saveHolidayRulesAction,
  createAndAddStaffAction,
  bulkCreateAndAddStaffsAction,
  generateShiftTableAction,
  saveLineSettingsAction,
  saveLineGroupAction,
  saveDepartureSettingAction,
  departStaffAction,
  cancelDepartStaffAction,
  testNotifyAction,
  testLinePushToSelfAction,
  sendRestDayRemindNowAction,
} from "./actions";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
  NOTIFY_VARS,
  type NotificationSettings,
  type NotifyItemConfig,
} from "./notify-config";
import {
  RULE_CONFIG,
  type HolidayRuleInput,
  DEFAULT_HOLIDAY_RULES,
  getRuleConfig,
} from "../../holiday-rule-config";
import SeatLayoutEditor, { type SeatItem, type WallItem } from "./SeatLayoutEditor";
import {
  getBreakSlotSettingsAction,
  saveBreakSlotSettingsAction,
  type BreakSlotSetting,
} from "@/app/(portal)/seating/break-actions";

type Member = { staffId: string; name: string; company_name: string | null; role: string; lineLinked: boolean; line_user_id: string | null; line_friend: boolean | null; section: string | null; sections: string[]; account_number: string | null; work_days_type: string | null; work_days_count: number | null; preferred_shift: string | null; preferred_section: string | null; max_consecutive_days: number | null; start_date: string | null; end_date: string | null; churn_risk: boolean; churn_risk_since: string | null; compliance: number | null; trainingDates: TrainingEntry[] };
type ShiftPattern = {
  id?: string;
  name: string;
  short_name: string;
  start_time: string;
  end_time: string;
  section: string;
  target_role: string; // "all" | "admin" | "staff"
};
type TabId = "basic" | "members" | "seats" | "break" | "danger";

// ── 共通フィードバック ──────────────────────────────────

function Flash({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <p className={`text-xs font-medium px-3 py-2 rounded-xl ${
      ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
         : "bg-red-50 dark:bg-red-950/20 text-red-500"
    }`}>
      {ok ? "✓ " : "✗ "}{msg}
    </p>
  );
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h2>
      {sub && <p className="text-[10px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-zinc-100 dark:border-zinc-800" />;
}

// ── 設定コンテナ（タブ管理） ─────────────────────────────

export function SettingsContainer({
  projectId,
  projectName,
  currentUrl,
  isGSheetsConfigured: gsheetsOk,
  members,
  shiftPatterns,
  notificationSettings,
  lineGroupId,
  enableDeparture,
  archiveAction,
  canArchive = true,
  initialSeats,
  initialWalls,
}: {
  projectId: string;
  projectName: string;
  currentUrl: string | null;
  isGSheetsConfigured: boolean;
  members: Member[];
  shiftPatterns: ShiftPattern[];
  notificationSettings: Partial<NotificationSettings>;
  lineGroupId: string | null;
  enableDeparture: boolean;
  archiveAction: (fd: FormData) => Promise<void>;
  canArchive?: boolean;
  initialSeats?: SeatItem[];
  initialWalls?: WallItem[];
}) {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "basic";
  const initialEditStaffId = searchParams.get("edit");
  const [tab, setTab] = useState<TabId>(initialTab);

  const TABS: { id: TabId; label: string; count?: number; red?: boolean }[] = [
    { id: "basic",   label: "基本設定" },
    { id: "members", label: "メンバー", count: members.length },
    { id: "seats",   label: "座席" },
    { id: "break",   label: "休憩設定" },
    ...(canArchive ? [{ id: "danger" as TabId, label: "危険操作", red: true }] : []),
  ];

  return (
    <div>
      {/* ── タブバー（スティッキー） ── */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-zinc-950/95 backdrop-blur border-b border-zinc-100 dark:border-zinc-800 -mx-4 px-4 mb-8">
        <div className="flex overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-3.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? t.red
                    ? "border-red-500 text-red-500"
                    : "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                  tab === t.id
                    ? "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── 基本設定タブ ── */}
      {tab === "basic" && (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionHeading title="案件名" />
            <ProjectNameForm projectId={projectId} currentName={projectName} />
          </section>
          <Divider />
          <section className="space-y-3">
            <SectionHeading title="出発報告" sub="スタッフダッシュボードの「出発報告」ボタンを表示するかどうか" />
            <DepartureToggle projectId={projectId} initialEnabled={enableDeparture} />
          </section>
          <Divider />
          <section className="space-y-3">
            <SectionHeading title="スプレッドシート" sub="シフト・勤怠データのGoogle Sheets連携設定" />
            <SpreadsheetForm
              projectId={projectId}
              projectName={projectName}
              currentUrl={currentUrl}
              isGSheetsConfigured={gsheetsOk}
            />
          </section>
        </div>
      )}

      {/* ── シフトタブ ── */}
      {/* ── メンバータブ ── */}
      {tab === "members" && (
        <MemberList
          projectId={projectId}
          members={members}
          availableSections={[...new Set(shiftPatterns.map(p => p.section).filter(Boolean))].sort()}
          shiftPatternNames={shiftPatterns.map(p => p.name).filter(Boolean)}
          initialEditStaffId={initialEditStaffId ?? undefined}
        />
      )}


      {/* ── 座席タブ ── */}
      {tab === "seats" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">
            座席をドラッグして位置を調整し、「レイアウト保存」してください。配置は当日座席表・翌日配置モードで使われます。
          </p>
          <SeatLayoutEditor
            projectId={projectId}
            initialSeats={initialSeats ?? []}
            initialWalls={initialWalls ?? []}
          />
        </div>
      )}

      {/* ── 休憩設定タブ ── */}
      {tab === "break" && (
        <div className="space-y-4">
          <SectionHeading title="休憩スロット設定" sub="査定・販売セクションの休憩時間帯と割合を設定します" />
          <BreakSlotEditor projectId={projectId} />
        </div>
      )}

      {/* ── 危険操作タブ ── */}
      {tab === "danger" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">この操作は取り消せません。慎重に実行してください。</p>
          <ArchiveButton projectName={projectName} archiveAction={archiveAction} />
        </div>
      )}
    </div>
  );
}

// ── 休憩スロット編集 ─────────────────────────────────────

function BreakSlotEditor({ projectId }: { projectId: string }) {
  const [slots, setSlots] = useState<BreakSlotSetting[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const data = await getBreakSlotSettingsAction(projectId);
      setSlots(data);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof BreakSlotSetting>(idx: number, field: K, value: BreakSlotSetting[K]) {
    setSlots(prev => prev?.map((s, i) => i === idx ? { ...s, [field]: value } : s) ?? null);
  }

  function handleSave() {
    if (!slots) return;
    startTransition(async () => {
      const res = await saveBreakSlotSettingsAction(
        projectId,
        slots.map((s, i) => ({
          slot_number: s.slot_number,
          label:       s.label,
          start_time:  s.start_time,
          end_time:    s.end_time,
          target_shift: s.target_shift,
          ratio:       s.ratio,
          sort_order:  i,
        }))
      );
      setMsg({ ok: res.success, text: res.success ? "保存しました" : (res.error ?? "エラー") });
      setTimeout(() => setMsg(null), 3000);
    });
  }

  if (!slots) return <p className="text-sm text-zinc-400">読み込み中…</p>;

  const totalRatio = slots.reduce((a, s) => a + s.ratio, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="grid grid-cols-[3rem_5rem_5rem_1fr_4rem] gap-0 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <span>記号</span>
          <span>開始</span>
          <span>終了</span>
          <span>対象シフト</span>
          <span>割合</span>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {slots.map((slot, idx) => (
            <div key={slot.slot_number} className="grid grid-cols-[3rem_5rem_5rem_1fr_4rem] gap-2 items-center px-3 py-2">
              <input
                className="w-10 text-center text-sm font-bold px-1 py-0.5 border rounded-lg border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                value={slot.label}
                onChange={e => update(idx, "label", e.target.value)}
              />
              <input type="time"
                className="text-xs px-2 py-0.5 border rounded-lg border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                value={slot.start_time}
                onChange={e => update(idx, "start_time", e.target.value)}
              />
              <input type="time"
                className="text-xs px-2 py-0.5 border rounded-lg border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                value={slot.end_time}
                onChange={e => update(idx, "end_time", e.target.value)}
              />
              <select
                className="text-xs px-2 py-0.5 border rounded-lg border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                value={slot.target_shift}
                onChange={e => update(idx, "target_shift", e.target.value as "early" | "late" | "both")}
              >
                <option value="early">早番のみ</option>
                <option value="late">遅番のみ</option>
                <option value="both">早番・遅番</option>
              </select>
              <div className="flex items-center gap-1">
                <input type="number" min="0" max="100"
                  className="w-12 text-xs px-1 py-0.5 border rounded-lg border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 tabular-nums"
                  value={slot.ratio}
                  onChange={e => update(idx, "ratio", Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                />
                <span className="text-xs text-zinc-400">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className={`px-3 py-1.5 text-xs font-semibold border-t border-zinc-100 dark:border-zinc-800 ${totalRatio === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          合計: {totalRatio}%{totalRatio !== 100 && " （100%にしてください）"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {isPending ? "保存中…" : "保存する"}
        </button>
        {msg && <Flash ok={msg.ok} msg={msg.text} />}
      </div>
    </div>
  );
}

// ── 出発報告 ON/OFF ──────────────────────────────────────

function DepartureToggle({ projectId, initialEnabled }: { projectId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setEnabled(next);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("enabled", String(next));
    startTransition(async () => {
      const r = await saveDepartureSettingAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "保存しました" : "エラー") });
    });
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between cursor-pointer group select-none">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            出発報告ボタンを表示する
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            OFFにするとスタッフの「出発報告」ボタンが非表示になります
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={isPending}
          onClick={() => toggle(!enabled)}
          className={[
            "relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50",
            enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700",
          ].join(" ")}
        >
          <span className={[
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            enabled ? "translate-x-6" : "translate-x-0",
          ].join(" ")} />
        </button>
      </label>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── 案件名 ──────────────────────────────────────────────

export function ProjectNameForm({ projectId, currentName }: { projectId: string; currentName: string }) {
  const [name, setName] = useState(currentName);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handle = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("name", name);
    startTransition(async () => {
      const r = await updateProjectNameAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "更新しました" : "エラー") });
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={handle}
          disabled={isPending || name === currentName || !name}
          className="px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40"
        >
          保存
        </button>
      </div>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── スプレッドシート ────────────────────────────────────

export function SpreadsheetForm({
  projectId,
  projectName,
  currentUrl,
  isGSheetsConfigured,
}: {
  projectId: string;
  projectName: string;
  currentUrl: string | null;
  isGSheetsConfigured: boolean;
}) {
  const [url, setUrl]     = useState(currentUrl ?? "");
  const [mode, setMode]   = useState<"view" | "edit">(currentUrl ? "view" : "edit");
  const [result, setResult] = useState<{ ok: boolean; msg: string; url?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const saveUrl = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("sheetUrl", url);
    startTransition(async () => {
      const r = await saveSheetUrlAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "URLを保存しました" : "エラー") });
      if (r.success) setMode("view");
    });
  };

  const autoCreate = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("projectName", projectName);
    startTransition(async () => {
      const r = await createSpreadsheetAction(fd);
      if (r.success && r.url) {
        setUrl(r.url);
        setMode("view");
        setResult({ ok: true, msg: "スプレッドシートを作成しました", url: r.url });
      } else {
        setResult({ ok: false, msg: r.message ?? "エラー" });
      }
    });
  };

  const displayUrl = result?.url ?? currentUrl ?? url;

  return (
    <div className="space-y-3">
      {mode === "view" && displayUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <a href={displayUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-xs text-blue-600 dark:text-blue-400 hover:underline truncate font-mono">
              {displayUrl}
            </a>
            <button type="button" onClick={() => setMode("edit")}
              className="text-xs text-zinc-400 hover:text-zinc-600 flex-shrink-0">変更</button>
          </div>
          <a href={displayUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            スプレッドシートを開く
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300" />
            <button type="button" onClick={saveUrl} disabled={isPending || !url}
              className="px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40">
              保存
            </button>
          </div>
          {isGSheetsConfigured && (
            <button type="button" onClick={autoCreate} disabled={isPending}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-40 transition-colors">
              {isPending ? "作成中…" : "✦ 新規スプレッドシートを自動作成する"}
            </button>
          )}
          {!isGSheetsConfigured && (
            <p className="text-xs text-amber-500">自動作成にはGOOGLE_SERVICE_ACCOUNT_JSONの設定が必要です</p>
          )}
        </div>
      )}
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── メンバー管理 ─────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  project_admin: "管理者",
  staff: "スタッフ",
  ops: "運営者",
};

// 会社ごとのアバターカラーパレット
const AVATAR_PALETTE = [
  { bg: "bg-blue-100 dark:bg-blue-950/50",    text: "text-blue-600 dark:text-blue-400"    },
  { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-amber-100 dark:bg-amber-950/50",  text: "text-amber-600 dark:text-amber-400"  },
  { bg: "bg-purple-100 dark:bg-purple-950/50", text: "text-purple-600 dark:text-purple-400" },
  { bg: "bg-rose-100 dark:bg-rose-950/50",    text: "text-rose-600 dark:text-rose-400"    },
  { bg: "bg-teal-100 dark:bg-teal-950/50",    text: "text-teal-600 dark:text-teal-400"    },
  { bg: "bg-orange-100 dark:bg-orange-950/50", text: "text-orange-600 dark:text-orange-400" },
  { bg: "bg-zinc-100 dark:bg-zinc-800",        text: "text-zinc-600 dark:text-zinc-400"    },
];

type AddMode = "none" | "new" | "csv";
type CsvRow = { id: string; name: string; role: string; company_name: string; section: string };
type CsvResult = { id: string; name: string; ok: boolean; message: string; noCompany?: boolean };

export function MemberList({
  projectId,
  members,
  availableSections = [],
  shiftPatternNames = [],
  initialEditStaffId,
  projectName,
  rankingHasData = false,
}: {
  projectId: string;
  members: Member[];
  availableSections?: string[];
  shiftPatternNames?: string[];
  initialEditStaffId?: string;
  projectName?: string;
  rankingHasData?: boolean;
}) {
  const [memberTab, setMemberTab] = useState<"list" | "ranking">("list");
  const [addMode, setAddMode]       = useState<AddMode>("none");
  const [newLast, setNewLast]         = useState("");
  const [newFirst, setNewFirst]       = useState("");
  const [newCompany, setNewCompany]   = useState("");
  const [newRole, setNewRole]         = useState("staff");
  const [newSection, setNewSection]   = useState("");
  const [newAssignDate, setNewAssignDate] = useState("");
  const [search, setSearch]         = useState("");
  const [companyFilter, setCompanyFilter] = useState(""); // "" | "__unset__" | company name
  const [sectionFilter, setSectionFilter] = useState(""); // "" | "__unset__" | section name
  const [filterExpanded, setFilterExpanded] = useState<"none" | "company" | "section">("none");
  const [lineFriendFilter, setLineFriendFilter] = useState(false); // true=友達未のみ表示
  const [csvText, setCsvText]       = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvRow[]>([]);
  const [csvResults, setCsvResults] = useState<CsvResult[] | null>(null);
  const fileRef                     = useRef<HTMLInputElement>(null);
  const [result, setResult]         = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, start]          = useTransition();

  // インライン編集
  const [editId, setEditId]                   = useState<string | null>(null);
  const [editName, setEditName]               = useState("");
  const [editCompany, setEditCompany]         = useState("");
  const [editSection, setEditSection]         = useState("");  // legacy single
  const [editSections, setEditSections]       = useState<string[]>([]);
  const [editSectionInput, setEditSectionInput] = useState("");
  const [editRole, setEditRole]               = useState("staff");
  const [editAccountNumber, setEditAccountNumber] = useState("");
  const [editWorkDaysType, setEditWorkDaysType] = useState<"monthly" | "weekly" | "spot" | "">("");
  const [editWorkDaysCount, setEditWorkDaysCount] = useState("");
  const [editPreferredShift, setEditPreferredShift] = useState("");
  const [editPreferredSection, setEditPreferredSection] = useState("");
  const [editMaxConsecDays, setEditMaxConsecDays] = useState("");
  const [editStartDate, setEditStartDate]           = useState("");
  const [shiftSettingsOpen, setShiftSettingsOpen]   = useState(false);
  const [editHolidayRequests, setEditHolidayRequests] = useState<HolidayRequestEntry[]>([]);
  const [editTrainingDates, setEditTrainingDates]   = useState<TrainingEntry[]>([]);
  const [departStep, setDepartStep] = useState<"hidden" | "input" | "confirm">("hidden");
  const [editChurnRisk, setEditChurnRisk] = useState(false);
  const [departType, setDepartType] = useState<"immediate" | "dated">("immediate");
  const [departDate, setDepartDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  );

  const membersRef = useRef(members);
  useEffect(() => {
    if (initialEditStaffId) {
      const m = membersRef.current.find(m => m.staffId === initialEditStaffId);
      if (m) startEdit(m);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditStaffId]);

  const startEdit = (m: Member) => {
    setEditId(m.staffId);
    setEditName(m.name);
    setEditCompany(m.company_name ?? "");
    setEditSection(m.section ?? "");
    // シフトパターンに存在しないセクションを除外（パターン削除後の残留データ対策）
    const rawSections = m.sections.length > 0 ? m.sections : (m.section ? [m.section] : []);
    const validSections = availableSections.length > 0
      ? rawSections.filter(s => availableSections.includes(s))
      : rawSections;
    setEditSections(validSections);
    setEditSectionInput("");
    setEditRole(m.role);
    setEditAccountNumber(m.account_number ?? "");
    setEditWorkDaysType((m.work_days_type as "monthly" | "weekly" | "spot" | "") || "");
    setEditWorkDaysCount(m.work_days_count != null ? String(m.work_days_count) : "21");
    setEditPreferredShift(m.preferred_shift ?? "");
    setEditPreferredSection(m.preferred_section ?? "");
    setEditMaxConsecDays(m.max_consecutive_days != null ? String(m.max_consecutive_days) : "");
    setEditStartDate(m.start_date ?? "");
    setEditChurnRisk(m.churn_risk ?? false);
    setShiftSettingsOpen(true);
    setDepartStep("hidden");
    setDepartDate(new Date().toISOString().slice(0, 10));
    // 研修日・希望休を最新データでフェッチ
    setEditTrainingDates(m.trainingDates);
    fetchTrainingDatesAction(m.staffId).then(dates => setEditTrainingDates(dates));
    setEditHolidayRequests([]);
    fetchHolidayRequestsForStaffAction(m.staffId, projectId).then(reqs => setEditHolidayRequests(reqs));
  };

  const handleSaveEdit = () => {
    if (!editId || !editName.trim()) return;
    const fd = new FormData();
    fd.set("projectId",       projectId);
    fd.set("staffId",         editId);
    fd.set("name",            editName.trim());
    fd.set("company_name",    editCompany.trim());
    fd.set("section",         editSections[0] ?? editSection.trim());
    fd.set("sections",        editSections.join(","));
    fd.set("role",            editRole);
    fd.set("account_number",      editAccountNumber.trim());
    fd.set("work_days_type",       editWorkDaysType);
    fd.set("work_days_count",      (editWorkDaysType === "monthly" || editWorkDaysType === "weekly") ? editWorkDaysCount : "");
    fd.set("preferred_shift",      editPreferredShift);
    fd.set("preferred_section",    editPreferredSection);
    fd.set("max_consecutive_days", editMaxConsecDays);
    fd.set("start_date",           editStartDate);
    fd.set("churn_risk",           editChurnRisk ? "true" : "false");
    start(async () => {
      const r = await updateMemberInfoAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "更新しました" : "エラー") });
      if (r.success) setEditId(null);
    });
  };

  // 会社一覧（ユニーク・ソート済み）
  const companies = [...new Set(
    members.map(m => m.company_name).filter((c): c is string => Boolean(c))
  )].sort();

  // セクション一覧（sections配列 + section単体 からユニーク・ソート済み）
  const sections = [...new Set(
    members.flatMap(m => m.sections.length > 0 ? m.sections : (m.section ? [m.section] : []))
  )].sort();

  // 会社名 → パレットインデックスのマップ
  const companyColorMap = new Map(companies.map((c, i) => [c, i % AVATAR_PALETTE.length]));
  const avatarStyle = (company: string | null) => AVATAR_PALETTE[companyColorMap.get(company ?? "") ?? AVATAR_PALETTE.length - 1];

  // フィルタリング
  const filtered = members.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || m.name.toLowerCase().includes(q)
      || m.staffId.toLowerCase().includes(q)
      || (m.company_name ?? "").toLowerCase().includes(q);
    const matchCompany = !companyFilter ? true
      : companyFilter === "__unset__" ? !m.company_name
      : m.company_name === companyFilter;
    const mSections = m.sections.length > 0 ? m.sections : (m.section ? [m.section] : []);
    const matchSection = !sectionFilter ? true
      : sectionFilter === "__unset__" ? mSections.length === 0
      : mSections.includes(sectionFilter);
    const matchLineFriend = !lineFriendFilter ? true : (m.lineLinked && !m.line_friend);
    return matchSearch && matchCompany && matchSection && matchLineFriend;
  });

  // 友達未のLINE連携済みスタッフ数
  const lineFriendUnsetCount = members.filter(m => m.lineLinked && !m.line_friend).length;

  const reset = (mode: AddMode = "none") => {
    setAddMode(mode);
    setNewLast(""); setNewFirst(""); setNewCompany(""); setNewRole("staff"); setNewSection(""); setNewAssignDate("");
    setCsvText(""); setCsvPreview([]); setCsvResults(null);
    setResult(null);
  };

  const handleCreateNew = () => {
    const fullName = `${newLast}${newFirst}`.trim();
    const fd = new FormData();
    fd.set("projectId", projectId); fd.set("name", fullName);
    fd.set("display_name", fullName); fd.set("role", newRole);
    if (newCompany.trim()) fd.set("company_name", newCompany.trim());
    if (newSection.trim()) fd.set("section", newSection.trim());
    if (newAssignDate.trim()) fd.set("start_date", newAssignDate.trim());
    start(async () => {
      const r = await createAndAddStaffAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "登録しました" : "エラー") });
      if (r.success) reset();
    });
  };

  const ROLE_MAP: Record<string, string> = {
    "スタッフ": "staff", "staff": "staff",
    "管理者": "project_admin", "project_admin": "project_admin",
    "運営者": "ops", "ops": "ops",
  };
  const parseCsv = (text: string) => {
    const lines = text.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());
    // ヘッダー行をスキップ（所属会社・苗字・氏名 いずれかで始まる行）
    const dataLines = lines.filter(l => !l.match(/^(所属会社|苗字|氏名)/));
    return dataLines.map(line => {
      const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim());
      // フォーマット: 所属会社,氏名,役割,セクション
      const company_name = cols[0] ?? "";
      const name         = cols[1] ?? "";
      const role         = ROLE_MAP[cols[2]?.trim() ?? ""] ?? "staff";
      const section      = cols[3]?.trim() ?? "";
      return { id: "", name, role, company_name, section };
    }).filter(r => r.name);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let text = ev.target?.result as string;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      setCsvText(text); setCsvPreview(parseCsv(text)); setCsvResults(null);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleBulkCsv = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("csv", JSON.stringify(csvPreview.map(r => ({ name: r.name, role: r.role, company_name: r.company_name, section: r.section }))));
    start(async () => {
      const r = await bulkCreateAndAddStaffsAction(fd);
      setCsvResults(r.results);
      setResult({ ok: r.success, msg: r.message });
    });
  };

  const handleRemove = (staffId: string) => {
    if (!confirm(`${staffId} をメンバーから削除しますか？`)) return;
    const fd = new FormData();
    fd.set("projectId", projectId); fd.set("staffId", staffId);
    start(async () => {
      const r = await removeMemberAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "削除しました" : "エラー") });
    });
  };

  const handleRoleChange = (staffId: string, role: string) => {
    const fd = new FormData();
    fd.set("projectId", projectId); fd.set("staffId", staffId); fd.set("role", role);
    start(async () => { await updateMemberRoleAction(fd); });
  };

  return (
    <div className={projectName !== undefined ? "" : "space-y-4"}>
      {/* ── Controls（スタンドアロンページはスティッキー） ── */}
      <div className={projectName !== undefined
        ? "sticky top-0 z-30 -mx-4 px-4 bg-[#F5F5F7]/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800"
        : "contents"
      }>
        {projectName !== undefined && (
          <>
            <div className="pt-5 pb-0">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">メンバー管理</h1>
              <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>
            </div>
            {/* タブバー */}
            <div className="flex mt-2 border-b border-zinc-100 dark:border-zinc-800">
              {(["list", "ranking"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMemberTab(t)}
                  className={[
                    "flex-shrink-0 px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px",
                    t === memberTab
                      ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
                  ].join(" ")}
                >
                  {t === "list" ? "メンバー" : "番付"}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={projectName !== undefined ? (memberTab === "list" ? "space-y-3 py-3" : "hidden") : "contents"}>

      {/* ヘッダー：統計 + 追加ボタン */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          {filtered.length !== members.length
            ? <><span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{filtered.length}</span> / {members.length}名</>
            : <><span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{members.length}</span>名</>
          }
          {companies.length > 0 && (
            <span className="ml-2 text-zinc-400 tabular-nums">· {companies.length}社</span>
          )}
        </p>
        {addMode === "none" && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setAddMode("new")}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors">
              ＋ 新規登録
            </button>
            <button type="button" onClick={() => setAddMode("csv")}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              CSV一括
            </button>
          </div>
        )}
      </div>

      {/* 検索ボックス（7名以上のとき表示） */}
      {members.length > 6 && addMode === "none" && (
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="名前・社員ID・会社名で検索"
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition"
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm leading-none">
              ×
            </button>
          )}
        </div>
      )}

      {/* フィルター（アコーディオン式） */}
      {addMode === "none" && (companies.length > 1 || sections.length > 0 || lineFriendUnsetCount > 0) && (
        <div className="space-y-1.5">
          {/* カテゴリボタン行 */}
          <div className="flex gap-2 flex-wrap">
            {companies.length > 1 && (
              <button
                type="button"
                onClick={() => setFilterExpanded(v => v === "company" ? "none" : "company")}
                className={[
                  "flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors border",
                  filterExpanded === "company" || companyFilter
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                ].join(" ")}
              >
                所属会社
                {companyFilter && (
                  <span className="opacity-70">
                    · {companyFilter === "__unset__" ? "未設定" : companyFilter}
                  </span>
                )}
                <span className={`text-[10px] transition-transform ${filterExpanded === "company" ? "rotate-180" : ""}`}>▾</span>
              </button>
            )}
            {sections.length > 0 && (
              <button
                type="button"
                onClick={() => setFilterExpanded(v => v === "section" ? "none" : "section")}
                className={[
                  "flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors border",
                  filterExpanded === "section" || sectionFilter
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                ].join(" ")}
              >
                セクション
                {sectionFilter && (
                  <span className="opacity-70">
                    · {sectionFilter === "__unset__" ? "未設定" : sectionFilter}
                  </span>
                )}
                <span className={`text-[10px] transition-transform ${filterExpanded === "section" ? "rotate-180" : ""}`}>▾</span>
              </button>
            )}
            {lineFriendUnsetCount > 0 && (
              <button
                type="button"
                onClick={() => setLineFriendFilter(v => !v)}
                className={[
                  "flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors border",
                  lineFriendFilter
                    ? "bg-orange-500 text-white border-transparent"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                ].join(" ")}
              >
                友達未
                <span className={`tabular-nums ${lineFriendFilter ? "opacity-80" : "opacity-60"}`}>{lineFriendUnsetCount}</span>
              </button>
            )}
            {(companyFilter || sectionFilter || lineFriendFilter) && (
              <button
                type="button"
                onClick={() => { setCompanyFilter(""); setSectionFilter(""); setLineFriendFilter(false); setFilterExpanded("none"); }}
                className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                クリア
              </button>
            )}
          </div>

          {/* 所属会社チップ展開 */}
          {filterExpanded === "company" && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 pl-1">
              <button onClick={() => { setCompanyFilter(""); }}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  !companyFilter ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}>
                すべて
              </button>
              {companies.map((c, i) => {
                const pal = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
                const active = companyFilter === c;
                const count = members.filter(m => m.company_name === c).length;
                return (
                  <button key={c} onClick={() => setCompanyFilter(active ? "" : c)}
                    className={`flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors max-w-[160px] ${
                      active ? `${pal.bg} ${pal.text}` : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}>
                    <span className="truncate">{c}</span>
                    <span className={`tabular-nums flex-shrink-0 ${active ? "opacity-70" : "opacity-50"}`}>{count}</span>
                  </button>
                );
              })}
              {members.some(m => !m.company_name) && (
                <button onClick={() => setCompanyFilter(companyFilter === "__unset__" ? "" : "__unset__")}
                  className={`flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    companyFilter === "__unset__"
                      ? "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}>
                  未設定
                  <span className="tabular-nums opacity-50">{members.filter(m => !m.company_name).length}</span>
                </button>
              )}
            </div>
          )}

          {/* セクションチップ展開 */}
          {filterExpanded === "section" && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 pl-1">
              <button onClick={() => { setSectionFilter(""); }}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  !sectionFilter ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}>
                すべて
              </button>
              {sections.map((s) => {
                const active = sectionFilter === s;
                const count = members.filter(m => m.section === s).length;
                return (
                  <button key={s} onClick={() => setSectionFilter(active ? "" : s)}
                    className={`flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      active ? "bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}>
                    <span>{s}</span>
                    <span className={`tabular-nums flex-shrink-0 ${active ? "opacity-70" : "opacity-50"}`}>{count}</span>
                  </button>
                );
              })}
              {members.some(m => !m.section) && (
                <button onClick={() => setSectionFilter(sectionFilter === "__unset__" ? "" : "__unset__")}
                  className={`flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    sectionFilter === "__unset__"
                      ? "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}>
                  未設定
                  <span className="tabular-nums opacity-50">{members.filter(m => !m.section).length}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

        </div>{/* end space-y-3/contents inner wrapper */}
      </div>{/* end sticky/contents controls wrapper */}

      {/* ── 番付タブ ── */}
      {memberTab === "ranking" && projectName !== undefined && (
        <RankingTab projectId={projectId} hasData={rankingHasData} />
      )}

      {/* ── Scrollable content (form, list, modal) ── */}
      <div className={projectName !== undefined ? `space-y-4 pt-4${memberTab === "ranking" ? " hidden" : ""}` : "contents"}>

      {/* 追加パネル群 */}
      {addMode === "new" && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500">新規アカウントを作成してこの案件に追加</p>
          <p className="text-[10px] text-zinc-400">社員IDは自動採番 ／ 初期パスワード: 1234</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">苗字 *</label>
              <input type="text" value={newLast} onChange={e => setNewLast(e.target.value)} placeholder="山田"
                className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">名前 *</label>
              <input type="text" value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="太郎"
                className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold">所属会社 *</label>
            <input type="text" value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="株式会社○○"
              className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">ロール</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5">
                <option value="staff">スタッフ</option>
                <option value="project_admin">管理者</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">セクション（任意）</label>
              <input type="text" value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="A班"
                className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold">アサイン日 *</label>
            <p className="text-[9px] text-zinc-400 mb-0.5">この日以前のシフト仮組みから除外されます</p>
            <input type="date" value={newAssignDate} onChange={e => setNewAssignDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm mt-0.5" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => reset()}
              className="flex-1 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">キャンセル</button>
            <button type="button" onClick={handleCreateNew} disabled={!newLast || !newFirst || !newAssignDate || isPending}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40">作成して追加</button>
          </div>
        </div>
      )}

      {addMode === "csv" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500">CSVで一括登録（所属会社,氏名,役割,セクション）</p>
          <div className="flex gap-2 items-center">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-900">
              ファイルを選択
            </button>
            {csvPreview.length > 0 && <span className="text-xs text-zinc-400">{csvPreview.length}件</span>}
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>

          {csvPreview.length > 0 && !csvResults && (
            <div className="max-h-36 overflow-y-auto space-y-1">
              {csvPreview.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${
                  !r.company_name
                    ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                    : "bg-white dark:bg-zinc-900"
                }`}>
                  <span className="flex-1 text-zinc-700 dark:text-zinc-200 truncate">
                    {r.name}
                    {r.company_name
                      ? <span className="ml-1 text-zinc-400">[{r.company_name}]</span>
                      : <span className="ml-1 text-amber-500 font-semibold">⚠ 所属会社なし</span>
                    }
                  </span>
                  <span className="text-zinc-400 flex-shrink-0">
                    {r.role === "project_admin" ? "管理者" : r.role === "ops" ? "運営者" : "スタッフ"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {csvResults && (
            <div className="max-h-36 overflow-y-auto space-y-1">
              {csvResults.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${
                  !r.ok ? "bg-red-50 dark:bg-red-950/20"
                  : r.noCompany ? "bg-amber-50 dark:bg-amber-950/30"
                  : "bg-emerald-50 dark:bg-emerald-950/20"
                }`}>
                  <span className="font-mono w-10 text-zinc-500">{r.id}</span>
                  <span className="flex-1 text-zinc-700 dark:text-zinc-200">{r.name}</span>
                  <span className={!r.ok ? "text-red-500" : r.noCompany ? "text-amber-500" : "text-emerald-600"}>
                    {r.message}{r.noCompany ? " ⚠会社名なし" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => reset()}
              className="flex-1 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
              {csvResults ? "閉じる" : "キャンセル"}
            </button>
            {!csvResults && (
              <button type="button" onClick={handleBulkCsv} disabled={csvPreview.length === 0 || isPending}
                className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold disabled:opacity-40">
                {isPending ? "登録中…" : (() => {
                  const noCompany = csvPreview.filter(r => !r.company_name).length;
                  return noCompany > 0
                    ? `${csvPreview.length}件を登録（⚠ ${noCompany}件 会社名なし）`
                    : `${csvPreview.length}件を登録`;
                })()}
              </button>
            )}
          </div>
        </div>
      )}

      {/* メンバー一覧 */}
      {addMode === "none" && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/70 dark:border-zinc-800 shadow-sm overflow-hidden">
          {/* CSS grid で各列を全行で揃える */}
          <div className="overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="min-w-[600px]">
              {filtered.map((m, i) => {
                const av = avatarStyle(m.company_name);
                const isDeparted = !!m.end_date;
                const memberSections = m.sections.length > 0 ? m.sections : m.section ? [m.section] : [];

                return (
                  <div
                    key={m.staffId}
                    className={`grid items-center px-4 py-3 cursor-pointer active:bg-zinc-50 dark:active:bg-zinc-800/50 transition-colors ${
                      i > 0 ? "border-t border-zinc-100 dark:border-zinc-800/60" : ""
                    } ${isDeparted ? "opacity-50" : ""}`}
                    style={{ gridTemplateColumns: "36px 96px 104px 52px 88px 52px 60px 40px 1fr 16px", gap: "8px" }}
                    onClick={() => startEdit(m)}
                  >
                    {/* ① アイコン */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${av.bg} ${av.text}`}>
                      {m.name[0]}
                    </div>

                    {/* ② 名前 */}
                    <div className="overflow-hidden">
                      <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 truncate leading-tight">{m.name}</p>
                      {m.churn_risk && !isDeparted && (
                        <p className="text-[9px] text-red-500 font-semibold leading-none mt-0.5">離脱リスク</p>
                      )}
                      {isDeparted && (
                        <p className="text-[9px] text-zinc-400 leading-none mt-0.5">離脱済</p>
                      )}
                    </div>

                    {/* ③ 会社名 */}
                    <div className="overflow-hidden">
                      {m.company_name
                        ? <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{m.company_name}</p>
                        : <p className="text-[11px] text-amber-500 font-semibold">未設定</p>
                      }
                    </div>

                    {/* ④ 口座番号 */}
                    <div className="overflow-hidden">
                      <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 truncate tabular-nums">
                        {m.account_number ?? "―"}
                      </p>
                    </div>

                    {/* ⑤ セクション（最大2件、超過は +N） */}
                    <div className="flex items-center gap-1 overflow-hidden">
                      {memberSections.length === 0
                        ? <span className="text-[10px] text-zinc-300 dark:text-zinc-700">―</span>
                        : <>
                            {memberSections.slice(0, 2).map(s => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900 whitespace-nowrap flex-shrink-0">
                                {s}
                              </span>
                            ))}
                            {memberSections.length > 2 && (
                              <span className="text-[10px] text-zinc-400 flex-shrink-0">+{memberSections.length - 2}</span>
                            )}
                          </>
                      }
                    </div>

                    {/* ⑥ ロール（管理者のみ表示・スタッフは空欄） */}
                    <div className="flex items-center">
                      {m.role === "project_admin" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900 whitespace-nowrap">
                          管理者
                        </span>
                      )}
                    </div>

                    {/* ⑦ LINE状態 */}
                    <div className="flex items-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border whitespace-nowrap ${
                        m.lineLinked && m.line_friend
                          ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-100 dark:border-green-900"
                          : m.lineLinked && !m.line_friend
                          ? "bg-orange-50 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400 border-orange-100 dark:border-orange-900"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-700"
                      }`}>
                        {m.lineLinked && m.line_friend ? "LINE済" : m.lineLinked ? "友達未" : "LINE未"}
                      </span>
                    </div>

                    {/* ⑧ 順守率（nullの場合は空欄） */}
                    <div className="flex items-center">
                      {m.compliance != null && (
                        <span className={[
                          "text-[10px] px-1.5 py-0.5 rounded-full font-semibold border tabular-nums whitespace-nowrap",
                          m.compliance >= 90
                            ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900"
                            : m.compliance >= 70
                            ? "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900"
                            : "bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 border-red-100 dark:border-red-900",
                        ].join(" ")}>
                          {m.compliance}%
                        </span>
                      )}
                    </div>

                    {/* スペーサー */}
                    <div />

                    {/* ⑨ トグル */}
                    <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-sm text-zinc-400">
                    {search || companyFilter ? "条件に一致するメンバーが見つかりません" : "メンバーなし"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 編集モーダル ── */}
      {editId && (() => {
        const editingMember = members.find(m => m.staffId === editId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditId(null)}>
            <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
              <div className="p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-zinc-400">{editId}</span>
                  <span className="text-[10px] text-zinc-400">を編集中</span>
                  {editingMember?.end_date && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 font-semibold">
                      離脱済 {editingMember.end_date}
                    </span>
                  )}
                </div>

                {/* ── 基本設定 ── */}
                <div className="space-y-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">基本設定</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">氏名 *</label>
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">所属会社</label>
                      <input type="text" value={editCompany} onChange={e => setEditCompany(e.target.value)}
                        placeholder="任意"
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">ロール</label>
                      <select value={editRole} onChange={e => setEditRole(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                        <option value="staff">スタッフ</option>
                        <option value="project_admin">管理者</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">アカウント番号</label>
                      <input type="text" value={editAccountNumber} onChange={e => setEditAccountNumber(e.target.value)}
                        placeholder="任意"
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 font-semibold">アサイン日（参加日）</label>
                    <p className="text-[9px] text-zinc-400 mb-0.5">設定するとこの日以前のシフト仮組みから除外されます</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                      {editStartDate && (
                        <button type="button" onClick={() => setEditStartDate("")}
                          className="text-[10px] text-zinc-400 hover:text-zinc-600 flex-shrink-0">クリア</button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* ── シフト設定 ── */}
                <div className="space-y-0">
                  <button
                    type="button"
                    onClick={() => setShiftSettingsOpen(v => !v)}
                    className="w-full flex items-center justify-between py-1 group"
                  >
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">シフト設定</p>
                    <span className={`text-[10px] text-zinc-400 transition-transform ${shiftSettingsOpen ? "rotate-180" : ""}`}>▾</span>
                  </button>
                  {shiftSettingsOpen && (
                    <div className="space-y-2.5 pt-2">
                      {/* セクション */}
                      <div>
                        <label className="text-[10px] text-zinc-500 font-semibold">セクション（複数選択可）</label>
                        {availableSections.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {availableSections.map(s => {
                              const active = editSections.includes(s);
                              return (
                                <button key={s} type="button"
                                  onClick={() => setEditSections(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                                  className={["px-2.5 py-1 rounded-full text-xs font-semibold transition-colors border",
                                    active ? "bg-blue-600 text-white border-blue-600"
                                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700",
                                  ].join(" ")}>
                                  {s}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-400 mt-1">シフトタブでパターンを登録するとセクションが選択できます</p>
                        )}
                        {editSections.length > 0 && (
                          <p className="text-[10px] text-zinc-400 mt-1">選択中: {editSections.join("・")}</p>
                        )}
                      </div>
                      {/* 稼働日数 */}
                      <div>
                        <label className="text-[10px] text-zinc-500 font-semibold">稼働日数</label>
                        <div className="flex items-center gap-2 mt-0.5">
                          <select value={editWorkDaysType} onChange={e => setEditWorkDaysType(e.target.value as "monthly" | "weekly" | "spot" | "")}
                            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-700 dark:text-zinc-300">
                            <option value="">未設定</option>
                            <option value="monthly">月</option>
                            <option value="weekly">週</option>
                            <option value="spot">スポット</option>
                          </select>
                          {(editWorkDaysType === "monthly" || editWorkDaysType === "weekly") && (
                            <>
                              <input type="number" value={editWorkDaysCount} onChange={e => setEditWorkDaysCount(e.target.value)}
                                placeholder="21" min={1} max={31}
                                className="w-16 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                              <span className="text-xs text-zinc-500">
                                日/{editWorkDaysType === "weekly" ? "週" : "月"}
                              </span>
                            </>
                          )}
                          {editWorkDaysType === "spot" && (
                            <span className="text-xs text-zinc-400">仮組みの対象外</span>
                          )}
                        </div>
                      </div>
                      {/* 優先セクション（複数セクション設定時のみ） */}
                      {editSections.length > 1 && (
                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold">優先セクション</label>
                          <p className="text-[9px] text-zinc-400 mb-0.5">仮組で複数セクションのどちらを優先するか</p>
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            <button type="button" onClick={() => setEditPreferredSection("")}
                              className={["px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                                !editPreferredSection ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"].join(" ")}>
                              未設定
                            </button>
                            {editSections.map(s => (
                              <button key={s} type="button" onClick={() => setEditPreferredSection(s)}
                                className={["px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                                  editPreferredSection === s ? "bg-blue-600 text-white border-blue-600"
                                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300"].join(" ")}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 優先シフトパターン */}
                      <div>
                        <label className="text-[10px] text-zinc-500 font-semibold">優先シフトパターン</label>
                        <select value={editPreferredShift} onChange={e => setEditPreferredShift(e.target.value)}
                          className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                          <option value="">未設定</option>
                          {shiftPatternNames.map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                      {/* 連勤上限 */}
                      <div>
                        <label className="text-[10px] text-zinc-500 font-semibold">連勤上限（日）</label>
                        <input type="number" value={editMaxConsecDays} onChange={e => setEditMaxConsecDays(e.target.value)}
                          placeholder="5（デフォルト）" min={1} max={31}
                          className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* ── 研修設定 ── */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">研修設定</p>
                  <TrainingSection staffId={editId} initialDates={editTrainingDates} />
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* ── 希望休 ── */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">希望休</p>
                  <HolidayRequestSection
                    staffId={editId}
                    projectId={projectId}
                    initialEntries={editHolidayRequests}
                  />
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* ── 離脱リスク ── */}
                <div className="flex items-center justify-between gap-3 py-0.5">
                  <div>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">離脱リスク</p>
                    <p className="text-[10px] text-zinc-400 leading-snug">ONにすると充足カウント除外・グリッドに赤枠表示</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditChurnRisk(v => !v)}
                    className={[
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      editChurnRisk ? "bg-red-500" : "bg-zinc-300 dark:bg-zinc-600",
                    ].join(" ")}
                  >
                    <span className={[
                      "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
                      editChurnRisk ? "translate-x-4" : "translate-x-0.5",
                    ].join(" ")} />
                  </button>
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800" />

                {/* ── 離脱処理 ── */}
                {editingMember?.end_date && departStep === "hidden" ? (
                  /* 離脱済み：取り消しUIを表示 */
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">離脱済</span>
                      <span className="text-xs text-zinc-400 tabular-nums">{editingMember.end_date}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400">
                      ※ 取り消しても削除済みシフトは復元されません。シフトは手動で再登録してください。
                    </p>
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={() => {
                          setDepartType("immediate");
                          setDepartDate(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
                          setDepartStep("input");
                        }}
                        className="flex-1 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        離脱日を変更…
                      </button>
                      <button type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (!editId) return;
                          start(async () => {
                            const r = await cancelDepartStaffAction(projectId, editId);
                            if (r.success) {
                              setEditId(null);
                              setDepartStep("hidden");
                              setResult({ ok: true, msg: "離脱処理を取り消しました" });
                            } else {
                              setResult({ ok: false, msg: r.message ?? "エラーが発生しました" });
                            }
                          });
                        }}
                        className="flex-1 py-1.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white text-xs font-bold disabled:opacity-40"
                      >
                        {isPending ? "処理中…" : "離脱を取り消す"}
                      </button>
                    </div>
                  </div>
                ) : departStep === "hidden" ? (
                  <button type="button"
                    onClick={() => {
                      setDepartType("immediate");
                      setDepartDate(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
                      setDepartStep("input");
                    }}
                    className="w-full text-left text-xs text-red-500 hover:text-red-600 dark:text-red-400 font-semibold py-1"
                  >
                    離脱処理…
                  </button>
                ) : departStep === "input" ? (
                  <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20 p-3 space-y-3">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">離脱処理</p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="radio" name="departType" checked={departType === "immediate"}
                          onChange={() => setDepartType("immediate")} className="w-4 h-4 accent-red-500" />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          即日（本日 {new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" })} 付けで離脱）
                        </span>
                      </label>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="radio" name="departType" checked={departType === "dated"}
                          onChange={() => setDepartType("dated")} className="w-4 h-4 accent-red-500" />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">期日を指定</span>
                      </label>
                      {departType === "dated" && (
                        <div className="ml-6 space-y-1">
                          <label className="text-[10px] text-zinc-500 font-semibold">最終出勤日（この日までシフトを保持）</label>
                          <input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400">
                      {departType === "immediate" ? "本日以降のシフトが削除されます" : "指定日の翌日以降のシフトが削除されます"}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setDepartStep("hidden")}
                        className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        戻る
                      </button>
                      {/* 確認ステップへ進む（まだ実行しない） */}
                      <button type="button"
                        disabled={departType === "dated" && !departDate}
                        onClick={() => setDepartStep("confirm")}
                        className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-40"
                      >
                        次へ
                      </button>
                    </div>
                  </div>
                ) : departStep === "confirm" ? (
                  /* ── 確認ステップ ── */
                  <div className="rounded-xl border-2 border-red-400 dark:border-red-600 bg-red-50/60 dark:bg-red-950/30 p-3 space-y-3">
                    <p className="text-sm font-bold text-red-600 dark:text-red-400 text-center">
                      ⚠ 本当に離脱処理を実行しますか？
                    </p>
                    <div className="bg-white dark:bg-zinc-900 rounded-lg px-3 py-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                      <p>
                        <span className="font-semibold">{editingMember?.name ?? editId}</span> を離脱処理します
                      </p>
                      <p className="text-zinc-400">
                        {departType === "immediate"
                          ? "本日以降のシフトがすべて削除されます"
                          : `${departDate} の翌日以降のシフトがすべて削除されます`}
                      </p>
                      <p className="text-red-500 font-semibold">削除したシフトは復元できません</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setDepartStep("input")}
                        className="flex-1 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        やっぱりやめる
                      </button>
                      <button type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (!editId) return;
                          const finalDate = departType === "immediate"
                            ? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
                            : departDate;
                          start(async () => {
                            const r = await departStaffAction(projectId, editId, finalDate);
                            if (r.success) {
                              setEditId(null);
                              setDepartStep("hidden");
                              setResult({ ok: true, msg: "離脱処理が完了しました" });
                            } else {
                              setResult({ ok: false, msg: r.message ?? "エラーが発生しました" });
                            }
                          });
                        }}
                        className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-40"
                      >
                        {isPending ? "処理中…" : "実行する"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditId(null)}
                    className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    キャンセル
                  </button>
                  <button type="button" onClick={handleSaveEdit} disabled={!editName.trim() || isPending}
                    className="flex-1 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-40">
                    {isPending ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {result && <Flash ok={result.ok} msg={result.msg} />}

      </div>{/* end scrollable content */}
    </div>
  );
}

// ── シフト表生成 ──────────────────────────────────────────

export function ShiftTableGenerator({ projectId }: { projectId: string }) {
  const now = new Date();
  const [year,  setYear]       = useState(now.getFullYear());
  const [month, setMonth]      = useState(now.getMonth() + 1);
  const [draft, setDraft]      = useState(false);
  const [result, setResult]    = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, start]     = useTransition();

  const handle = () => {
    const fd = new FormData();
    fd.set("projectId",   projectId);
    fd.set("year",        String(year));
    fd.set("month",       String(month));
    fd.set("draftAssign", String(draft));
    start(async () => {
      const r = await generateShiftTableAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "生成しました" : "エラー") });
    });
  };

  const years  = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-400">指定した年月でシフト表シートを上書き生成します。既存の入力は消えます。</p>
      <div className="flex items-center gap-2">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100">
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100">
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button type="button" onClick={handle} disabled={isPending}
          className="flex-1 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40 transition-colors">
          {isPending ? "生成中…" : "シフト表を生成"}
        </button>
      </div>
      {/* 仮組オプション */}
      <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={draft}
          onChange={e => setDraft(e.target.checked)}
          className="w-4 h-4 rounded accent-blue-600"
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          仮組で生成（希望休以外のスタッフをパターンに自動配置）
        </span>
      </label>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── アーカイブボタン ──────────────────────────────────────

export function ArchiveButton({ projectName, archiveAction }: {
  projectName: string;
  archiveAction: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={archiveAction}>
      <button
        type="submit"
        onClick={e => {
          if (!confirm(`「${projectName}」をアーカイブしますか？\nこの案件は一覧から非表示になります。`)) {
            e.preventDefault();
          }
        }}
        className="w-full py-3 rounded-2xl border border-red-200 dark:border-red-900 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
      >
        この案件をアーカイブする
      </button>
    </form>
  );
}

// ── シフトパターン管理 ────────────────────────────────────

export function ShiftPatternList({
  projectId,
  initialPatterns,
}: {
  projectId: string;
  initialPatterns: ShiftPattern[];
}) {
  const [patterns, setPatterns] = useState<ShiftPattern[]>(
    initialPatterns.length > 0 ? initialPatterns : []
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(initialPatterns.map((_, i) => i)));
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // ドラッグ＆ドロップ並び替え
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  const update = (i: number, field: keyof ShiftPattern, value: string) =>
    setPatterns(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  const add = () =>
    setPatterns(prev => [...prev, { name: "", short_name: "", start_time: "", end_time: "", section: "", target_role: "all" }]);
  const remove = (i: number) =>
    setPatterns(prev => prev.filter((_, idx) => idx !== i));

  // ドラッグ並び替えハンドラ
  function handleDragStart(i: number) { dragIdx.current = i; }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    dragOverIdx.current = i;
  }
  function handleDrop() {
    const from = dragIdx.current;
    const to   = dragOverIdx.current;
    if (from === null || to === null || from === to) return;
    setPatterns(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    // collapsed インデックスも更新
    setCollapsed(prev => {
      const arr = [...prev].map(idx => {
        if (idx === from) return to;
        if (from < to && idx > from && idx <= to) return idx - 1;
        if (from > to && idx < from && idx >= to) return idx + 1;
        return idx;
      });
      return new Set(arr);
    });
    dragIdx.current = null;
    dragOverIdx.current = null;
  }

  const save = () => {
    setResult(null);
    const valid = patterns.filter(p => p.name.trim()); // 略称は任意
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("patterns", JSON.stringify(
      valid.map((p, i) => ({
        name:             p.name.trim(),
        short_name:       p.short_name.trim() || p.name.trim().slice(0, 2),
        start_time:       p.start_time || null,
        end_time:         p.end_time   || null,
        required_count:   null,
        required_weekday: null,
        required_weekend: null,
        section:          p.section.trim() || null,
        target_role:      p.target_role || "all",
        sort_order:       i,
      }))
    ));
    startTransition(async () => {
      const r = await saveShiftPatternsAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "保存しました" : "エラー") });
    });
  };

  return (
    <div className="space-y-2">
      {patterns.map((p, i) => {
        const isCollapsed = collapsed.has(i);
        const toggle = () => setCollapsed(prev => {
          const next = new Set(prev);
          next.has(i) ? next.delete(i) : next.add(i);
          return next;
        });
        return (
          <div key={i}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={e => handleDragOver(e, i)}
            onDrop={handleDrop}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 cursor-default">
            {/* ヘッダー行（常に表示） */}
            <div className="flex items-center gap-2 p-3">
              {/* ドラッグハンドル */}
              <span
                className="flex-shrink-0 text-zinc-300 dark:text-zinc-600 cursor-grab active:cursor-grabbing select-none text-sm leading-none px-0.5"
                title="ドラッグで並び替え"
              >⠿</span>
              <button type="button" onClick={toggle}
                className="flex-1 flex items-center gap-2 min-w-0 text-left">
                <span className={`text-zinc-400 text-xs transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                <span className="font-medium text-sm text-zinc-800 dark:text-zinc-100 truncate">
                  {p.name || <span className="text-zinc-300 dark:text-zinc-600">（名称未設定）</span>}
                </span>
                {p.short_name && (
                  <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded-md flex-shrink-0">{p.short_name}</span>
                )}
                {(p.start_time || p.end_time) && (
                  <span className="text-[10px] text-zinc-400 flex-shrink-0 tabular-nums">{p.start_time}〜{p.end_time}</span>
                )}
              </button>
              <button type="button" onClick={() => remove(i)}
                className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">×</button>
            </div>
            {/* 詳細フォーム（展開時のみ） */}
            {!isCollapsed && (
              <div className="px-3 pb-3 space-y-2 border-t border-zinc-100 dark:border-zinc-700 pt-2">
                <div className="flex items-center gap-2">
                  <input type="text" value={p.name} onChange={e => update(i, "name", e.target.value)}
                    placeholder="パターン名（例：早番）"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 min-w-0" />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-zinc-400">略称</span>
                    <input type="text" value={p.short_name} onChange={e => update(i, "short_name", e.target.value.slice(0, 4))}
                      placeholder="早"
                      className="w-16 px-1.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 text-center" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="time" value={p.start_time} onChange={e => update(i, "start_time", e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100" />
                  <span className="text-zinc-400 text-sm flex-shrink-0">〜</span>
                  <input type="time" value={p.end_time} onChange={e => update(i, "end_time", e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 font-semibold flex-shrink-0 w-12">セクション</span>
                  <input type="text" value={p.section} onChange={e => update(i, "section", e.target.value)}
                    placeholder="査定・販売 など"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 font-semibold flex-shrink-0 w-12">対象</span>
                  <select value={p.target_role} onChange={e => update(i, "target_role", e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300">
                    <option value="all">全員</option>
                    <option value="staff">スタッフのみ</option>
                    <option value="admin">管理者のみ</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {patterns.length === 0 && <p className="text-xs text-zinc-300 dark:text-zinc-700 py-1">パターンなし</p>}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={add}
          className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors flex items-center gap-1">
          <span className="text-base leading-none">+</span> パターンを追加
        </button>
        <button type="button" onClick={save} disabled={isPending}
          className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-40 transition-colors">
          {isPending ? "保存中…" : "保存"}
        </button>
      </div>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── LINEグループ連携 ──────────────────────────────────────

export function LineGroupSection({
  projectId,
  currentGroupId,
}: {
  projectId: string;
  currentGroupId: string | null;
}) {
  const [groupId, setGroupId] = useState(currentGroupId ?? "");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("groupId", groupId.trim());
    startTransition(async () => {
      const r = await saveLineGroupAction(fd);
      setResult({ ok: r.success, msg: r.message ?? "" });
    });
  };

  return (
    <div className="space-y-3">
      {result && <Flash ok={result.ok} msg={result.msg} />}
      <div className="flex gap-2">
        <input
          type="text"
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
          placeholder="C1234567890abcdef..."
          className="flex-1 px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
        />
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white rounded-xl transition-colors"
        >
          保存
        </button>
      </div>
      {groupId && (
        <button
          onClick={() => { setGroupId(""); save(); }}
          disabled={isPending}
          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
        >
          連携を解除する
        </button>
      )}
      <p className="text-[11px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900 rounded-xl px-3 py-2">
        グループIDの取得方法：LINE公式アカウントをグループに招待 → LINEアプリのグループ情報からIDをコピー、またはDevelopers ConsoleのWebhookログで確認
      </p>
    </div>
  );
}

// ── LINE通知設定 ──────────────────────────────────────────

type NotifyKey = keyof NotificationSettings;

// イベント通知カード定義（順序・ラベル・説明のみ。変数は NOTIFY_VARS から参照）
const EVENT_NOTIFY_ITEMS: { key: NotifyKey; label: string; desc: string }[] = [
  { key: "absence",      label: "欠勤申請通知",   desc: "スタッフが欠勤申請を行ったとき（管理者グループへ）" },
  { key: "tardiness",    label: "遅刻申請通知",   desc: "スタッフが遅刻申請を行ったとき（管理者グループへ）" },
  { key: "announcement", label: "お知らせ通知",   desc: "管理者がお知らせを投稿したとき（スタッフへ）" },
  { key: "inquiry",      label: "問い合わせ通知", desc: "スタッフから問い合わせが届いたとき（管理者グループへ）" },
  { key: "inquiry_reply", label: "問い合わせ返信通知", desc: "管理者が問い合わせに返信したとき（スタッフ本人へ）" },
];

const RECIPIENT_LABELS: Record<string, string> = {
  admin: "管理者グループのみ",
  staff: "スタッフのみ",
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        checked ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/** 時刻入力 */
function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300"
    />
  );
}

/** 分数入力 */
function MinutesInput({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <input
      type="number"
      min={1}
      max={max ?? 120}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-14 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 text-center"
    />
  );
}

/** 変数チップ（クリックでカーソル位置に挿入） */
function VarChip({
  label,
  note,
  onInsert,
}: {
  label: string;
  note?: string;
  onInsert: (v: string) => void;
}) {
  return (
    <button
      type="button"
      title={note}
      onClick={() => onInsert(label)}
      className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[10px] font-mono text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
    >
      {label}
      {note && (
        <span className="text-[9px] text-blue-400 dark:text-blue-500 font-sans not-italic">※{note}</span>
      )}
    </button>
  );
}

function SendNowButton({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();

  const handleSend = () => {
    start(async () => {
      setStatus("sending");
      const res = await sendRestDayRemindNowAction(projectId);
      setStatus(res.success ? "ok" : "err");
      setMsg(res.message ?? "");
      setTimeout(() => { setStatus("idle"); setMsg(""); }, 5000);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending"}
        className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 transition-colors"
      >
        {status === "sending" ? "送信中…" : "今すぐ送信"}
      </button>
      {msg && (
        <span className={`text-[10px] font-medium ${status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
          {msg}
        </span>
      )}
    </div>
  );
}

/** 1通知のカード */
function NotifyCard({
  notifyKey,
  label,
  desc,
  config,
  vars,
  extra,
  onToggle,
  onRecipient,
  projectId,
}: {
  notifyKey: NotifyKey;
  label: string;
  desc: string;
  config: NotifyItemConfig;
  vars: { label: string; note?: string }[];
  extra?: React.ReactNode;
  onToggle: () => void;
  onRecipient: (v: "admin" | "staff") => void;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testMsg,    setTestMsg]    = useState<string>("");
  const [isPendingTest, startTest]  = useTransition();

  const handleTestSend = () => {
    const message = DEFAULT_NOTIFY_MESSAGES[notifyKey] ?? label;
    startTest(async () => {
      setTestStatus("sending");
      const res = await testNotifyAction(projectId, message, notifyKey);
      setTestStatus(res.success ? "ok" : "err");
      setTestMsg(res.message ?? "");
      setTimeout(() => setTestStatus("idle"), 3000);
    });
  };


  const defaultMsg = DEFAULT_NOTIFY_MESSAGES[notifyKey];

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* ヘッダー行 */}
      <div className="flex items-center gap-3 px-4 py-3.5 relative">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">{label}</p>
          <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">{desc}</p>
        </div>
        {config.enabled && (
          <>
            {/* テスト送信ボタン */}
            <button
              type="button"
              onClick={handleTestSend}
              disabled={isPendingTest}
              className={[
                "flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors",
                testStatus === "ok"  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                : testStatus === "err" ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
              ].join(" ")}
              title="管理者グループへテスト送信"
            >
              {testStatus === "sending" ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : testStatus === "ok" ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : testStatus === "err" ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
              {testStatus === "ok" ? "送信済" : testStatus === "err" ? "失敗" : testStatus === "sending" ? "" : "テスト"}
            </button>
            {/* 展開ボタン */}
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label={open ? "折り畳む" : "設定を開く"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </>
        )}
        <Toggle checked={config.enabled} onChange={() => { onToggle(); if (!config.enabled) setOpen(true); }} />
        {/* テスト結果ツールチップ */}
        {testMsg && testStatus !== "idle" && (
          <span className={`absolute right-16 top-3 text-[10px] px-2 py-0.5 rounded-full ${testStatus === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {testMsg}
          </span>
        )}
      </div>

      {/* 詳細設定（ON かつ open のときのみ） */}
      {config.enabled && open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/40 space-y-3">
          {/* 通知先セレクト */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-500 w-14 flex-shrink-0">通知先</span>
            <select
              value={config.recipient}
              onChange={e => onRecipient(e.target.value as "admin" | "staff")}
              className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300"
            >
              <option value="admin">{RECIPIENT_LABELS.admin}</option>
              <option value="staff">{RECIPIENT_LABELS.staff}</option>
            </select>
          </div>
          {/* タイミング設定（定時通知など） */}
          {extra}
          {/* メッセージ本文（プレビューのみ） */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-zinc-500">メッセージ本文</span>
            <div className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 text-xs text-zinc-600 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
              {defaultMsg}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LineNotifySettings({
  projectId,
  initialSettings,
}: {
  projectId: string;
  initialSettings: Partial<NotificationSettings>;
}) {
  const [settings, setSettings] = useState<NotificationSettings>(
    () => buildDefaultNotificationSettings(initialSettings as Record<string, unknown>)
  );
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, start]  = useTransition();

  const updateItem = (key: NotifyKey, patch: Partial<NotifyItemConfig>) =>
    setSettings(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const save = () => {
    setResult(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("settings", JSON.stringify(settings));
    start(async () => {
      const r = await saveLineSettingsAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "保存しました" : "エラー") });
    });
  };

  return (
    <div className="space-y-6">

      {/* ── イベント通知 ── */}
      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          イベント通知（即時）
        </p>
        {EVENT_NOTIFY_ITEMS.map(item => (
          <NotifyCard
            key={item.key}
            notifyKey={item.key}
            label={item.label}
            desc={item.desc}
            config={settings[item.key]}
            vars={NOTIFY_VARS[item.key]}
            onToggle={() => updateItem(item.key, { enabled: !settings[item.key].enabled })}
            onRecipient={v => updateItem(item.key, { recipient: v })}
            projectId={projectId}
          />
        ))}
      </div>

      {/* ── 定時通知 ── */}
      <div className="space-y-2.5">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          定時通知（スケジュール）
        </p>

        {/* 翌日出勤アナウンス */}
        <NotifyCard
          notifyKey="rest_day_remind"
          label="翌日出勤リマインド"
          desc="翌日に出勤予定のスタッフへ前日夜に通知"
          config={settings.rest_day_remind}
          vars={NOTIFY_VARS.rest_day_remind}
          onToggle={() => updateItem("rest_day_remind", { enabled: !settings.rest_day_remind.enabled })}
          onRecipient={v => updateItem("rest_day_remind", { recipient: v })}
          projectId={projectId}
          extra={
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-zinc-500 w-14 flex-shrink-0">送信時刻</span>
                <TimeInput
                  value={settings.rest_day_remind.time ?? "20:00"}
                  onChange={v => updateItem("rest_day_remind", { time: v })}
                />
                <span className="text-[11px] text-zinc-400">に送信（前日）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-zinc-500 w-14 flex-shrink-0">手動送信</span>
                <SendNowButton projectId={projectId} />
              </div>
            </div>
          }
        />

        {/* 希望休申請受付通知（毎月1日） */}
        <NotifyCard
          notifyKey="holiday_open_notify"
          label="希望休申請受付開始通知"
          desc="毎月1日に希望休申請の受付開始をスタッフへ通知"
          config={settings.holiday_open_notify}
          vars={NOTIFY_VARS.holiday_open_notify}
          onToggle={() => updateItem("holiday_open_notify", { enabled: !settings.holiday_open_notify.enabled })}
          onRecipient={v => updateItem("holiday_open_notify", { recipient: v })}
          projectId={projectId}
          extra={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-zinc-500 w-14 flex-shrink-0">送信時刻</span>
              <TimeInput
                value={settings.holiday_open_notify.time ?? "09:00"}
                onChange={v => updateItem("holiday_open_notify", { time: v })}
              />
              <span className="text-[11px] text-zinc-400">に送信（毎月1日）</span>
            </div>
          }
        />

        {/* 欠勤者経過報告リマインド */}
        <NotifyCard
          notifyKey="absence_followup_remind"
          label="欠勤者経過報告リマインド"
          desc="当日欠勤かつ翌日出勤予定のスタッフへ経過報告を促す通知"
          config={settings.absence_followup_remind}
          vars={NOTIFY_VARS.absence_followup_remind}
          onToggle={() => updateItem("absence_followup_remind", { enabled: !settings.absence_followup_remind.enabled })}
          onRecipient={v => updateItem("absence_followup_remind", { recipient: v })}
          projectId={projectId}
          extra={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-zinc-500 w-14 flex-shrink-0">送信時刻</span>
              <TimeInput
                value={settings.absence_followup_remind.time ?? "17:00"}
                onChange={v => updateItem("absence_followup_remind", { time: v })}
              />
              <span className="text-[11px] text-zinc-400">に送信</span>
            </div>
          }
        />


      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40 transition-colors"
        >
          {isPending ? "保存中…" : "保存"}
        </button>
      </div>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── 希望休ルール ──────────────────────────────────────────

export function HolidayRulesList({
  projectId,
  initialRules,
}: {
  projectId: string;
  initialRules: HolidayRuleInput[];
}) {
  const [rules, setRules]            = useState<HolidayRuleInput[]>(
    initialRules.length > 0 ? initialRules : DEFAULT_HOLIDAY_RULES
  );
  const [showPicker, setShowPicker]  = useState(false);
  const [result, setResult]          = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const updateRule = (i: number, field: keyof HolidayRuleInput, value: string) =>
    setRules(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  const removeRule = (i: number) =>
    setRules(prev => prev.filter((_, idx) => idx !== i));
  const pickRule = (key: string) => {
    setRules(prev => [...prev, { rule_type: key, value: "" }]);
    setShowPicker(false);
  };

  const save = () => {
    setResult(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("rules", JSON.stringify(rules));
    startTransition(async () => {
      const r = await saveHolidayRulesAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "保存しました" : "エラー") });
    });
  };

  const usedKeys  = new Set(rules.map(r => r.rule_type));
  const available = RULE_CONFIG.filter(r => !usedKeys.has(r.key));

  return (
    <div className="space-y-2">
      {rules.map((rule, i) => {
        const config = getRuleConfig(rule.rule_type);
        return (
          <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{config?.label ?? rule.rule_type}</p>
                {config?.hint && <p className="text-[10px] text-zinc-400 mt-0.5">{config.hint}</p>}
              </div>
              <input type="number" value={rule.value} onChange={e => updateRule(i, "value", e.target.value)} min={1}
                className="w-16 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 text-center" />
              <span className="text-xs text-zinc-400 flex-shrink-0 w-4">{config?.unit ?? "日"}</span>
              <button type="button" onClick={() => removeRule(i)}
                className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">×</button>
            </div>
          </div>
        );
      })}
      {rules.length === 0 && !showPicker && <p className="text-xs text-zinc-400 py-1">ルールが設定されていません</p>}
      {showPicker && (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">追加するルールを選択</p>
          {available.map(r => (
            <button key={r.key} type="button" onClick={() => pickRule(r.key)}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-zinc-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.label}</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">{r.hint}</p>
            </button>
          ))}
          <button type="button" onClick={() => setShowPicker(false)}
            className="w-full py-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">キャンセル</button>
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        {!showPicker && (
          <button type="button" onClick={() => setShowPicker(true)} disabled={available.length === 0}
            className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors flex items-center gap-1 disabled:opacity-40">
            <span className="text-base leading-none">+</span> ルールを追加
          </button>
        )}
        {showPicker && <div />}
        <button type="button" onClick={save} disabled={isPending}
          className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-40 transition-colors">
          {isPending ? "保存中…" : "保存"}
        </button>
      </div>
      {result && <Flash ok={result.ok} msg={result.msg} />}
    </div>
  );
}

// ── LINE push 疎通テスト ──────────────────────────────────────
export function LinePushTestSection({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [msg,    setMsg]    = useState<string>("");
  const [detail, setDetail] = useState<string>("");
  const [isPending, start]  = useTransition();

  function handleTest() {
    start(async () => {
      setStatus("sending");
      setMsg("");
      setDetail("");
      const res = await testLinePushToSelfAction(projectId);
      setStatus(res.success ? "ok" : "err");
      setMsg(res.message);
      setDetail(res.detail ?? "");
    });
  }

  return (
    <section className="space-y-3">
      <SectionHeading
        title="LINE push 疎通テスト"
        sub="自分のLINEに直接テストメッセージを送って通知が届くか確認します"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleTest}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40 transition-colors"
        >
          {status === "sending" ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
          自分のLINEにテスト送信
        </button>
        {status === "ok" && (
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ {msg}</p>
        )}
        {status === "err" && (
          <div>
            <p className="text-sm font-semibold text-red-500">✗ {msg}</p>
            {detail && <p className="text-xs text-red-400 mt-0.5">{detail}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
