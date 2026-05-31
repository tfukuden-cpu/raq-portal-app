"use client";

import { useState, useRef, useEffect } from "react";
import LineConnectionSection from "@/app/(portal)/admin/[projectId]/settings/LineConnectionSection";
import { LineGroupSection, LineNotifySettings } from "@/app/(portal)/admin/[projectId]/settings/SettingsClient";
import type { NotificationSettings } from "@/app/(portal)/admin/[projectId]/settings/notify-config";
import NotifyHistory from "./NotifyHistory";
import type { NotifyLog } from "./notify-history-actions";

type Member = {
  staffId: string;
  name: string;
  line_user_id: string | null;
  lineLinked: boolean;
};

type Tab = "connection" | "notify" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "connection", label: "連携管理" },
  { id: "notify",     label: "通知設定" },
  { id: "history",    label: "通知履歴" },
];

export default function LineSettingsClient({
  projectId,
  members,
  lineGroupId,
  notificationSettings,
  projectName,
  initialLogs,
  initialCursor,
}: {
  projectId: string;
  members: Member[];
  lineGroupId: string | null;
  notificationSettings: Partial<NotificationSettings>;
  projectName: string;
  initialLogs: NotifyLog[];
  initialCursor: string | null;
}) {
  const [tab, setTab] = useState<Tab>("connection");
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    setHeaderHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setHeaderHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div>
      {/* ── Sticky header（タイトル + プロジェクト名 + タブ） ── */}
      <div ref={headerRef} className="sticky top-0 z-30 -mx-4 px-4 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="pt-5 pb-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">LINE設定</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>
        </div>
        <div className="flex mt-2">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "flex-shrink-0 px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors",
                t.id === tab
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 連携管理タブ */}
      {tab === "connection" && (
        <div className="space-y-8 pt-4">
          <section className="space-y-3">
            <LineConnectionSection
              projectId={projectId}
              members={members}
              stickyTopOffset={headerHeight}
            />
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
        <div className="space-y-8 pt-4">
          <div className="border-t border-zinc-100 dark:border-zinc-800" />

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
        </div>
      )}

      {/* 通知履歴タブ */}
      {tab === "history" && (
        <div className="pt-4 space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">通知履歴</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">LINEで送信された通知の履歴（直近30件〜）</p>
          </div>
          <NotifyHistory initialLogs={initialLogs} initialCursor={initialCursor} />
        </div>
      )}
    </div>
  );
}
