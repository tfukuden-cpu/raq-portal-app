"use client";

import { useState } from "react";
import LineConnectionSection from "@/app/(portal)/admin/[projectId]/settings/LineConnectionSection";
import { LineGroupSection, LineNotifySettings } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import type { NotificationSettings } from "@/app/(portal)/admin/[projectId]/settings/notify-config";

type Member = {
  staffId: string;
  name: string;
  line_user_id: string | null;
  lineLinked: boolean;
};

type Tab = "connection" | "notify";

const TABS: { id: Tab; label: string }[] = [
  { id: "connection", label: "連携管理" },
  { id: "notify",     label: "通知設定" },
];

export default function LineSettingsClient({
  projectId,
  members,
  lineGroupId,
  notificationSettings,
}: {
  projectId: string;
  members: Member[];
  lineGroupId: string | null;
  notificationSettings: Partial<NotificationSettings>;
}) {
  const [tab, setTab] = useState<Tab>("connection");

  return (
    <div>
      {/* タブバー */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "flex-shrink-0 px-5 py-3 text-sm font-semibold border-b-2 transition-colors",
              t.id === tab
                ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 連携管理タブ */}
      {tab === "connection" && (
        <div className="space-y-8">
          <section className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINE連携状況</h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">スタッフとのLINE連携状況を確認・管理します</p>
            </div>
            <LineConnectionSection projectId={projectId} members={members} />
          </section>

          <div className="border-t border-zinc-100 dark:border-zinc-800" />

          <section className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINEグループ連携</h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">グループIDを入力するとグループへも通知が届きます</p>
            </div>
            <LineGroupSection projectId={projectId} currentGroupId={lineGroupId} />
          </section>
        </div>
      )}

      {/* 通知設定タブ */}
      {tab === "notify" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINE通知設定</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">各イベント発生時にLINEへ通知するかどうかを設定します</p>
          </div>
          <LineNotifySettings
            projectId={projectId}
            initialSettings={notificationSettings}
          />
        </section>
      )}
    </div>
  );
}
