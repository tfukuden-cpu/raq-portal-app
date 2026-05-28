"use client";

import { useState } from "react";
import ShiftOffRequestSection from "@/app/(portal)/admin/[projectId]/settings/ShiftOffRequestSection";
import { HolidayRulesList } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import type { HolidayRuleInput } from "@/app/(portal)/admin/holiday-rule-config";

export default function ShiftHolidayTab({
  projectId,
  initialRules,
}: {
  projectId: string;
  initialRules: HolidayRuleInput[];
}) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="space-y-4">

      {/* 希望休一覧（テーブル） ＋ ヘッダー右に「希望休設定」ボタン */}
      <ShiftOffRequestSection
        projectId={projectId}
        onRulesClick={() => setRulesOpen(o => !o)}
        rulesOpen={rulesOpen}
      />

      {/* 希望休ルール設定（ボタンで開閉） */}
      {rulesOpen && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">希望休ルール</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">締切日・上限日数などを設定</p>
            </div>
            <button
              type="button"
              onClick={() => setRulesOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-4 py-4">
            <HolidayRulesList projectId={projectId} initialRules={initialRules} />
          </div>
        </div>
      )}

    </div>
  );
}
