"use client";

import { useState } from "react";
import ShiftOffRequestSection from "@/app/(portal)/admin/[projectId]/settings/ShiftOffRequestSection";
import { HolidayRulesList } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import type { HolidayRuleInput } from "@/app/(portal)/admin/holiday-rule-config";

type Member = { id: string; name: string; accountNumber: string | null };

export default function ShiftHolidayTab({
  projectId,
  initialRules,
  members = [],
}: {
  projectId: string;
  initialRules: HolidayRuleInput[];
  members?: Member[];
}) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="space-y-4">

      {/* 希望休一覧（テーブル） ＋ ヘッダー右に「希望休設定」ボタン */}
      <ShiftOffRequestSection
        projectId={projectId}
        members={members}
        onRulesClick={() => setRulesOpen(o => !o)}
        rulesOpen={rulesOpen}
      />

      {/* 希望休ルール設定モーダル */}
      {rulesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
          onClick={() => setRulesOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
              <div>
                <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">希望休ルール</p>
                <p className="text-xs text-zinc-400 mt-0.5">締切日・上限日数などを設定</p>
              </div>
              <button
                type="button"
                onClick={() => setRulesOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* コンテンツ（スクロール可） */}
            <div className="overflow-y-auto px-5 py-4">
              <HolidayRulesList projectId={projectId} initialRules={initialRules} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
