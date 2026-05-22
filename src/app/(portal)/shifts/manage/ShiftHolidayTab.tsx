"use client";

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
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">希望休申請一覧 / インポート</h2>
          <p className="text-[10px] text-zinc-400 mt-0.5">GoogleフォームのExcelを取り込み、スタッフの申請内容を確認できます</p>
        </div>
        <ShiftOffRequestSection projectId={projectId} />
      </section>

      <div className="border-t border-zinc-100 dark:border-zinc-800" />

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">希望休ルール</h2>
          <p className="text-[10px] text-zinc-400 mt-0.5">保存するとスプシの「希望休ルール」シートにも反映されます</p>
        </div>
        <HolidayRulesList projectId={projectId} initialRules={initialRules} />
      </section>
    </div>
  );
}
