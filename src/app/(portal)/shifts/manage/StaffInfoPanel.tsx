"use client";

/**
 * スタッフ情報パネル
 * シフト編集・確認モードでスタッフ名をタップしたときに表示するモーダル
 * セクション・稼働設定・優先・希望休申請一覧・導入研修日を表示する
 */

import TrainingSection from "@/components/TrainingSection";

export type StaffInfoMember = {
  id: string;
  name: string;
  section: string | null;
  sections: string[];
  work_days_type: string | null;
  work_days_count: number | null;
  preferred_shift: string | null;
  preferred_section: string | null;
  max_consecutive_days: number | null;
  shift_note: string | null;
  endDate?: string | null;
  trainingDates?: { id: string; training_date: string }[];
};

export type StaffOffRequest = {
  request_date: string;
  priority: string;
  source: string;
};

const PRIORITY_ORDER = ["冠婚葬祭", "第一希望休", "第二希望休", "第三希望休", "第四希望休"];

const PRIORITY_COLOR: Record<string, string> = {
  "冠婚葬祭":   "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300",
  "第一希望休": "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  "第二希望休": "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
  "第三希望休": "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400",
  "第四希望休": "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300",
};

const SOURCE_LABEL: Record<string, string> = {
  user:   "本人申請",
  admin:  "管理者入力",
  import: "インポート",
  system: "システム",
};

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+09:00");
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}（${dow}）`;
}

export default function StaffInfoPanel({
  member,
  offRequests,
  projectId,
  onClose,
}: {
  member: StaffInfoMember;
  offRequests: StaffOffRequest[];
  projectId: string;
  onClose: () => void;
}) {
  // 優先度ごとにグループ化
  const grouped = PRIORITY_ORDER.map(priority => ({
    priority,
    dates: offRequests
      .filter(r => r.priority === priority)
      .sort((a, b) => a.request_date.localeCompare(b.request_date)),
  })).filter(g => g.dates.length > 0);

  // 第一希望休が複数あるかどうか
  const firstPriorityCount = offRequests.filter(r => r.priority === "第一希望休").length;

  const effectiveSections = member.sections.length > 0
    ? member.sections
    : member.section ? [member.section] : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[85dvh] flex flex-col"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between shrink-0">
          <div>
            <p className="text-[11px] text-zinc-400 font-medium">スタッフ情報</p>
            <p className="text-base font-bold text-zinc-800 dark:text-zinc-100 leading-snug">{member.name}</p>
            <p className="text-xs text-zinc-400 tabular-nums">{member.id}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-sm shrink-0 mt-0.5"
          >✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
          {/* 基本設定 */}
          <section>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">基本設定</p>
            <div className="space-y-1">
              {/* セクション */}
              <Row label="セクション">
                {effectiveSections.length > 0
                  ? effectiveSections.map(s => (
                      <span key={s} className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold">{s}</span>
                    ))
                  : <span className="text-zinc-400 text-xs">未設定</span>
                }
              </Row>
              {/* 稼働日数 */}
              <Row label="稼働設定">
                <span className="text-xs text-zinc-700 dark:text-zinc-200">
                  {member.work_days_type === "weekly"
                    ? `週${member.work_days_count ?? "?"}日`
                    : `月${member.work_days_count ?? "?"}日`}
                </span>
              </Row>
              {/* 連勤上限 */}
              <Row label="連勤上限">
                <span className="text-xs text-zinc-700 dark:text-zinc-200">
                  {member.max_consecutive_days != null ? `${member.max_consecutive_days}日` : "未設定"}
                </span>
              </Row>
              {/* 優先シフト */}
              {member.preferred_shift && (
                <Row label="優先シフト">
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                    {member.preferred_shift}
                  </span>
                </Row>
              )}
              {/* 優先セクション */}
              {member.preferred_section && (
                <Row label="優先セクション">
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                    {member.preferred_section}
                  </span>
                </Row>
              )}
              {/* 備考 */}
              {member.shift_note && (
                <Row label="備考">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">{member.shift_note}</span>
                </Row>
              )}
              {/* 退職予定日 */}
              {member.endDate && (
                <Row label="退職予定日">
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold tabular-nums">{member.endDate}</span>
                </Row>
              )}
            </div>
          </section>

          {/* 希望休申請 */}
          <section>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
              希望休申請（当月）
              {offRequests.length > 0 && (
                <span className="ml-1 text-zinc-500 normal-case font-normal">{offRequests.length}件</span>
              )}
            </p>

            {/* 第一希望休が複数ある場合の説明 */}
            {firstPriorityCount > 1 && (
              <div className="mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                  第一希望休が{firstPriorityCount}件あります
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-snug">
                  システム上、同一優先度を複数日申請できるため、日程の重要度に差がある場合は備考をご確認ください。
                </p>
              </div>
            )}

            {grouped.length === 0 ? (
              <p className="text-xs text-zinc-400 py-2 text-center">申請なし</p>
            ) : (
              <div className="space-y-2">
                {grouped.map(({ priority, dates }) => (
                  <div key={priority}>
                    <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">{priority}</p>
                    <div className="flex flex-wrap gap-1">
                      {dates.map(r => (
                        <div key={r.request_date} className="flex items-center gap-1">
                          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold tabular-nums ${PRIORITY_COLOR[priority] ?? "bg-zinc-100 text-zinc-600"}`}>
                            {fmtDate(r.request_date)}
                          </span>
                          {r.source !== "user" && (
                            <span className="text-[9px] text-zinc-400">{SOURCE_LABEL[r.source] ?? r.source}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 導入研修 */}
          <section>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-2">導入研修</p>
            <TrainingSection
              staffId={member.id}
              initialDates={member.trainingDates ?? []}
            />
          </section>
        </div>

        {/* フッター */}
        <div className="px-4 pb-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <a
            href={`/admin/${projectId}/settings?tab=members`}
            className="block w-full py-2 rounded-xl text-center text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            メンバー設定を開く
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Row helper ─────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] text-zinc-400 w-20 shrink-0 pt-0.5">{label}</span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}
