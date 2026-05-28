"use client";

import { useState } from "react";
import ShiftOffRequestSection from "@/app/(portal)/admin/[projectId]/settings/ShiftOffRequestSection";
import ShiftImportSection from "@/app/(portal)/admin/[projectId]/settings/ShiftImportSection";
import { HolidayRulesList } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import type { HolidayRuleInput } from "@/app/(portal)/admin/holiday-rule-config";

function Collapsible({
  title,
  sub,
  defaultOpen = false,
  children,
}: {
  title: string;
  sub?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
          {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

export default function ShiftHolidayTab({
  projectId,
  initialRules,
}: {
  projectId: string;
  initialRules: HolidayRuleInput[];
}) {
  return (
    <div className="space-y-4">

      {/* 1. 希望休設定（メイン：月別テーブル） */}
      <ShiftOffRequestSection projectId={projectId} />

      {/* 2. 希望休ルール（折り畳み） */}
      <Collapsible
        title="希望休ルール"
        sub="締切日・上限日数などを設定"
        defaultOpen={false}
      >
        <HolidayRulesList projectId={projectId} initialRules={initialRules} />
      </Collapsible>

      {/* 3. Excelインポート（折り畳み） */}
      <Collapsible
        title="Excelインポート"
        sub="GoogleフォームのExcelから取り込み"
        defaultOpen={false}
      >
        <ShiftImportSection projectId={projectId} />
      </Collapsible>

    </div>
  );
}
