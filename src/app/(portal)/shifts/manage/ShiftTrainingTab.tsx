"use client";

import { useState } from "react";
import TrainingSection, { type TrainingEntry } from "@/components/TrainingSection";
import { overrideDraftCellsAction } from "@/app/(portal)/shifts/actions";

export type TrainingMember = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  trainings: TrainingEntry[];
};

interface Props {
  projectId: string;
  members: TrainingMember[];
  targetMonth: string; // "YYYY-MM"
}

export default function ShiftTrainingTab({ projectId, members, targetMonth }: Props) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = members.filter(m =>
    !search ||
    m.name.includes(search) ||
    (m.accountNumber ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-1">研修設定</h2>
        <p className="text-xs text-zinc-400">
          スタッフの研修日を設定します。追加した研修日はシフトグリッドに「研修」として反映できます。
        </p>
      </div>

      {/* 検索 */}
      <input
        type="text"
        placeholder="名前・アカウント番号で検索"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />

      {/* メンバーリスト */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-8">メンバーが見つかりません</p>
        ) : (
          filtered.map(m => {
            const isExpanded = expandedId === m.id;
            return (
              <div key={m.id} className="bg-white dark:bg-zinc-900">
                {/* 行ヘッダー */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {m.name}
                      </span>
                      {m.accountNumber && (
                        <span className="text-xs font-mono text-zinc-400 flex-shrink-0">{m.accountNumber}</span>
                      )}
                      {m.section && (
                        <span className="text-xs text-zinc-400 flex-shrink-0">{m.section}</span>
                      )}
                      {m.trainings.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold flex-shrink-0">
                          研修 {m.trainings.length}日
                        </span>
                      )}
                    </div>
                    {/* 登録済み研修日チップ */}
                    {m.trainings.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {m.trainings.map(t => {
                          const [, mo, d] = t.training_date.split("-");
                          return (
                            <span
                              key={t.id}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                            >
                              {parseInt(mo)}/{parseInt(d)}
                              {t.training_name ? ` ${t.training_name}` : ""}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* 展開アイコン */}
                  <svg
                    className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* 展開パネル */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/20">
                    <TrainingSection
                      staffId={m.id}
                      initialDates={m.trainings}
                      onTrainingAdded={async (entries) => {
                        // 研修日を当月のシフトグリッドドラフトへ即時反映
                        const cells = entries
                          .filter(e => e.date.startsWith(targetMonth))
                          .map(e => ({ staffId: m.id, date: e.date, shiftName: e.name ?? "研修" }));
                        if (cells.length > 0) {
                          await overrideDraftCellsAction(projectId, cells);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
