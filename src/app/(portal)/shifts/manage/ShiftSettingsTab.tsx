"use client";

import { ShiftPatternList } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import ShiftDraftSection from "@/app/(portal)/admin/[projectId]/settings/ShiftDraftSection";

type ShiftPattern = {
  id?: string;
  name: string;
  short_name: string;
  start_time: string;
  end_time: string;
  section: string;
  target_role: string;
  required_count?:   number | null;
  required_weekday?: number | null;
  required_weekend?: number | null;
};

export default function ShiftSettingsTab({
  projectId,
  initialPatterns,
}: {
  projectId: string;
  initialPatterns: ShiftPattern[];
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">シフトパターン</h2>
          <p className="text-[10px] text-zinc-400 mt-0.5">保存するとスプシの「シフトパターン」シートにも反映されます</p>
        </div>
        <ShiftPatternList projectId={projectId} initialPatterns={initialPatterns} />
      </section>

      <div className="border-t border-zinc-100 dark:border-zinc-800" />

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">シフト仮組</h2>
          <p className="text-[10px] text-zinc-400 mt-0.5">月と必要人数を設定して自動でシフトを生成します</p>
        </div>
        <ShiftDraftSection
          projectId={projectId}
          patterns={initialPatterns.map(p => ({
            name:             p.name,
            section:          p.section || null,
            start_time:       p.start_time || null,
            end_time:         p.end_time   || null,
            target_role:      p.target_role,
            required_count:   p.required_count   ?? null,
            required_weekday: p.required_weekday ?? null,
            required_weekend: p.required_weekend ?? null,
          }))}
        />
      </section>
    </div>
  );
}
