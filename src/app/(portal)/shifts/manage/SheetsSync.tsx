"use client";

import { useEffect, useReducer, useTransition } from "react";
import {
  importShiftFromSheetAction,
  exportShiftToSheetAction,
  exportHolidayToSheetAction,
  exportPunchLogToSheetAction,
  exportAttendanceDetailToSheetAction,
  exportAttendanceSummaryToSheetAction,
  exportShiftChangeLogToSheetAction,
  importSettingsFromSheetAction,
  importMembersFromSheetAction,
  exportMembersToSheetAction,
  createShiftTemplateAction,
  importShiftTableAction,
} from "../sheet-actions";

const LS_URL = "rqp_gsheet_url";

type OpKey =
  | "import_shift" | "export_shift"
  | "import_shift_table" | "create_shift_template"
  | "export_holiday"
  | "export_punch"
  | "export_detail" | "export_summary"
  | "export_changelog"
  | "import_settings"
  | "import_members" | "export_members";

type OpResult = { ok: boolean; msg: string } | null;
type ResultMap = Partial<Record<OpKey, OpResult>>;

const OP_CONFIG: {
  key: OpKey;
  label: string;
  direction: "in" | "out";
  sheet: string;
  color: string;
  note?: string;
}[] = [
  { key: "import_settings",    label: "設定を読み込む",      direction: "in",  sheet: "設定",          color: "text-violet-600 dark:text-violet-400" },
  { key: "import_shift_table", label: "シフト表を読み込む",  direction: "in",  sheet: "シフト表",      color: "text-blue-600 dark:text-blue-400" },
  { key: "import_shift",       label: "シフト詳細を読み込む",direction: "in",  sheet: "シフト",        color: "text-blue-600 dark:text-blue-400" },
  { key: "import_members",     label: "メンバーを読み込む",  direction: "in",  sheet: "メンバー",      color: "text-emerald-600 dark:text-emerald-400", note: "初期PW: 1234" },
  { key: "create_shift_template", label: "シフト表テンプレート作成", direction: "out", sheet: "シフト表", color: "" },
  { key: "export_members",     label: "メンバー",            direction: "out", sheet: "メンバー",      color: "" },
  { key: "export_shift",       label: "シフト詳細",          direction: "out", sheet: "シフト",        color: "" },
  { key: "export_holiday",     label: "希望休",              direction: "out", sheet: "希望休",        color: "" },
  { key: "export_punch",       label: "打刻ログ",            direction: "out", sheet: "打刻ログ",      color: "" },
  { key: "export_detail",      label: "日別勤怠",            direction: "out", sheet: "日別勤怠",      color: "" },
  { key: "export_summary",     label: "月次集計",            direction: "out", sheet: "月次集計",      color: "" },
  { key: "export_changelog",   label: "シフト変更ログ",      direction: "out", sheet: "シフト変更ログ", color: "" },
];

const ACTION_MAP: Record<OpKey, (fd: FormData) => Promise<{ success: boolean; count?: number; message?: string }>> = {
  import_shift:        importShiftFromSheetAction,
  export_shift:        exportShiftToSheetAction,
  import_shift_table:    importShiftTableAction,
  create_shift_template: createShiftTemplateAction,
  export_holiday:      exportHolidayToSheetAction,
  export_punch:        exportPunchLogToSheetAction,
  export_detail:       exportAttendanceDetailToSheetAction,
  export_summary:      exportAttendanceSummaryToSheetAction,
  export_changelog:    exportShiftChangeLogToSheetAction,
  import_settings:     importSettingsFromSheetAction,
  import_members:      importMembersFromSheetAction,
  export_members:      exportMembersToSheetAction,
};

const RESULT_LABELS: Record<OpKey, (n: number) => string> = {
  import_shift:        (n) => `${n}件をインポート`,
  export_shift:        (n) => `${n}件を書き出し`,
  import_shift_table:    (n) => `${n}件をインポート`,
  create_shift_template: (n) => `${n}名分のテンプレートを作成`,
  export_holiday:      (n) => `${n}件を書き出し`,
  export_punch:        (n) => `${n}件を書き出し`,
  export_detail:       (n) => `${n}日分を書き出し`,
  export_summary:      (n) => `${n}名分を書き出し`,
  export_changelog:    (n) => `${n}件を書き出し`,
  import_settings:     (n) => `${n}項目を読み込み`,
  import_members:      (n) => `${n}名を処理`,
  export_members:      (n) => `${n}名を書き出し`,
};

export default function SheetsSync({
  targetYear,
  targetMonth,
  isConfigured,
}: {
  targetYear: number;
  targetMonth: number;
  isConfigured: boolean;
}) {
  const [url, setUrl] = useReducer((_: string, v: string) => {
    localStorage.setItem(LS_URL, v); return v;
  }, "");

  useEffect(() => {
    setUrl(localStorage.getItem(LS_URL) ?? "");
  }, []);

  const [results, setResult] = useReducer(
    (state: ResultMap, action: { key: OpKey; result: OpResult }) => ({
      ...state, [action.key]: action.result,
    }),
    {}
  );

  const [activeOp, setActiveOp] = useReducer(
    (_: OpKey | null, v: OpKey | null) => v, null
  );

  const [isPending, startTransition] = useTransition();

  const run = (key: OpKey) => {
    setActiveOp(key);
    const fd = new FormData();
    fd.set("url",   url);
    fd.set("year",  String(targetYear));
    fd.set("month", String(targetMonth));
    startTransition(async () => {
      const r = await ACTION_MAP[key](fd);
      setResult({
        key,
        result: {
          ok: r.success,
          msg: r.success
            ? (r.message ?? RESULT_LABELS[key](r.count ?? 0))
            : (r.message ?? "エラーが発生しました"),
        },
      });
      setActiveOp(null);
    });
  };

  if (!isConfigured) {
    return (
      <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/20 px-5 py-4 space-y-3">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          Google Sheets API が未設定です
        </p>
        <ol className="text-xs text-amber-600 dark:text-amber-400 list-decimal list-inside space-y-1">
          <li>Google Cloud Console でサービスアカウントを作成</li>
          <li>Google Sheets API を有効化</li>
          <li>JSONキーをダウンロード</li>
          <li><code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.env.local</code> に追加：</li>
        </ol>
        <pre className="bg-amber-100 dark:bg-amber-900/30 rounded-xl px-3 py-2 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
          {`GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","client_email":"...","private_key":"..."}'`}
        </pre>
        <p className="text-[10px] text-amber-500">スプレッドシートはサービスアカウントのメールに「編集者」で共有してください</p>
      </div>
    );
  }

  const inOps  = OP_CONFIG.filter((o) => o.direction === "in");
  const outOps = OP_CONFIG.filter((o) => o.direction === "out");

  return (
    <div className="space-y-5">
      {/* URL入力 */}
      <div>
        <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
          スプレッドシートURL
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300"
        />
        <p className="text-[10px] text-zinc-400 mt-1">URLは自動で保存されます</p>
      </div>

      {/* 対象月 */}
      <p className="text-xs text-zinc-400">
        対象月：<span className="font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">
          {targetYear}年 {targetMonth}月
        </span>
      </p>

      {/* スプシ → アプリ */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          ↓ スプシ → アプリ
        </p>
        <div className="grid grid-cols-2 gap-2">
          {inOps.map((op) => (
            <SyncButton
              key={op.key}
              label={op.label}
              sheet={op.sheet}
              direction="in"
              running={isPending && activeOp === op.key}
              disabled={!url || isPending}
              result={results[op.key] ?? null}
              note={op.note}
              onClick={() => run(op.key)}
            />
          ))}
        </div>
      </div>

      {/* アプリ → スプシ */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          ↑ アプリ → スプシ
        </p>
        <div className="grid grid-cols-2 gap-2">
          {outOps.map((op) => (
            <SyncButton
              key={op.key}
              label={op.label}
              sheet={op.sheet}
              direction="out"
              running={isPending && activeOp === op.key}
              disabled={!url || isPending}
              result={results[op.key] ?? null}
              onClick={() => run(op.key)}
            />
          ))}
        </div>
      </div>

      {/* シート名一覧 */}
      <details className="group">
        <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-600 select-none">
          スプレッドシートのシート名
        </summary>
        <div className="mt-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2.5 text-xs text-zinc-500 space-y-1">
          {OP_CONFIG.map((op) => (
            <div key={op.key} className="flex items-center gap-2">
              <span className="font-mono text-zinc-400">{op.sheet}</span>
              <span className="text-zinc-300 dark:text-zinc-600">—</span>
              <span>{op.label}</span>
            </div>
          ))}
          <p className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-200 dark:border-zinc-700 mt-1">
            シート名はこの通りに作成してください（自動では作成されません）
          </p>
        </div>
      </details>
    </div>
  );
}

// ── 個別ボタンコンポーネント ──────────────────────────────

function SyncButton({
  label, sheet, direction, running, disabled, result, note, onClick,
}: {
  label: string;
  sheet: string;
  direction: "in" | "out";
  running: boolean;
  disabled: boolean;
  result: { ok: boolean; msg: string } | null;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex flex-col items-start gap-1 px-3 py-3 rounded-2xl text-left transition-colors disabled:opacity-40",
        direction === "in"
          ? "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          : "bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-xs ${direction === "in" ? "text-zinc-400" : "text-zinc-400 dark:text-zinc-600"}`}>
          {direction === "in" ? "↓" : "↑"}
        </span>
        <span className={`text-xs font-mono ${direction === "in" ? "text-zinc-400" : "text-zinc-500 dark:text-zinc-500"}`}>
          {sheet}
        </span>
      </div>
      <span className={`text-sm font-semibold leading-tight ${direction === "in" ? "text-zinc-800 dark:text-zinc-200" : ""}`}>
        {running ? "処理中…" : label}
      </span>
      {note && !result && (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
          {note}
        </span>
      )}
      {result && (
        <span className={`text-[10px] font-medium ${result.ok ? "text-emerald-500" : "text-red-500"}`}>
          {result.ok ? "✓ " : "✗ "}{result.msg}
        </span>
      )}
    </button>
  );
}
