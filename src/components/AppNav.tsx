"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { NavItem, NavSection } from "@/app/(portal)/layout";
import { ICON_MAP, MenuIcon } from "@/components/icons";

interface AppNavProps {
  sections: NavSection[];
  staffName: string;
  projectName: string | null;
  logoutAction: () => Promise<void>;
  switchProjectAction: (projectId: string) => Promise<void>;
  initialCollapsed: boolean;
  children: React.ReactNode;
}

export default function AppNav({
  sections,
  staffName,
  logoutAction,
  switchProjectAction,
  initialCollapsed,
  children,
}: AppNavProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [switching, startSwitch]  = useTransition();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `rqp-nav-collapsed=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  const isActive = (href: string) => {
    if (href === "/admin") {
      if (pathname.startsWith("/admin/operators") || pathname.startsWith("/admin/staffs")) return false;
      return pathname === "/admin" || pathname.startsWith("/admin/");
    }
    return pathname === href;
  };

  function handleSwitchProject(projectId: string) {
    startSwitch(async () => {
      await switchProjectAction(projectId);
      router.refresh();
    });
  }

  const isCol = collapsed;
  const initial = staffName.charAt(0).toUpperCase();

  const defaultSectionIdx = Math.max(
    0,
    sections.findIndex(s => s.items.some(item => isActive(item.href)))
  );
  const [activeSectionIdx, setActiveSectionIdx] = useState(defaultSectionIdx);
  const activeSection = sections[activeSectionIdx] ?? sections[0];
  const showSectionTabs = sections.length > 1;

  // ── 案件タブコンポーネント（モバイル用） ─────────────
  function ProjectTabsMobile({ tabs }: { tabs: NonNullable<NavSection["projectTabs"]> }) {
    return (
      <div className="flex overflow-x-auto gap-1.5 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800" style={{ scrollbarWidth: "none" }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleSwitchProject(tab.id)}
            disabled={switching}
            className={[
              "flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap",
              tab.isActive
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
            ].join(" ")}
          >
            {tab.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">

      {/* ── PC サイドバー（常にダーク） ── */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full z-40 bg-[#111111] border-r border-white/[0.06] transition-[width] duration-200 ease-in-out overflow-hidden ${
          isCol ? "w-14" : "w-60"
        }`}
      >
        {/* ロゴ + トグル */}
        <div className={`flex items-center h-12 flex-shrink-0 border-b border-white/[0.06] ${
          isCol ? "justify-center" : "px-3.5 gap-2.5"
        }`}>
          <button
            onClick={toggle}
            aria-label={isCol ? "メニューを開く" : "メニューを閉じる"}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <MenuIcon className="w-[15px] h-[15px]" />
          </button>
          {!isCol && (
            <span className="text-[13px] font-semibold text-zinc-200 tracking-tight select-none">
              RaqWorks
            </span>
          )}
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-px">
          {sections.map((section, si) => (
            <div key={si}>
              {si > 0 && (
                <div className="my-2.5 mx-1 border-t border-white/[0.06]" />
              )}
              {!isCol && (
                section.projectTabs && section.projectTabs.length > 0 ? (
                  /* ── 案件タブ（ファイル見出し風） ── */
                  <div
                    className="flex overflow-x-auto mt-1 mb-0.5 border-b border-white/[0.08]"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {section.projectTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => handleSwitchProject(tab.id)}
                        disabled={switching}
                        title={tab.name}
                        className={[
                          "flex-shrink-0 px-3 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
                          tab.isActive
                            ? "border-blue-500 text-zinc-100"
                            : "border-transparent text-zinc-600 hover:text-zinc-300",
                        ].join(" ")}
                      >
                        {tab.name.length > 7 ? tab.name.slice(0, 7) + "…" : tab.name}
                      </button>
                    ))}
                  </div>
                ) : section.title ? (
                  <p className="px-2.5 pt-2 pb-1.5 text-[9px] font-semibold text-zinc-700 uppercase tracking-[0.12em] select-none">
                    {section.title}
                  </p>
                ) : null
              )}
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = ICON_MAP[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCol ? item.label : undefined}
                    className={`relative flex items-center h-8 rounded-md transition-colors overflow-hidden ${
                      isCol ? "justify-center" : "gap-2.5 px-2.5"
                    } ${
                      active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-blue-500 rounded-r-full" />
                    )}
                    <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                    {!isCol && (
                      <span className={`text-[13px] leading-none ${active ? "font-medium" : "font-normal"}`}>
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ユーザーフッター */}
        <div className="border-t border-white/[0.06] p-2 flex-shrink-0">
          <form action={logoutAction}>
            <button
              type="submit"
              title={isCol ? `${staffName} — ログアウト` : undefined}
              className={`w-full flex items-center h-10 rounded-md transition-colors hover:bg-white/[0.04] group ${
                isCol ? "justify-center" : "gap-2.5 px-2"
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {initial}
              </div>
              {!isCol && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[12px] font-medium text-zinc-300 truncate leading-tight">
                    {staffName}
                  </p>
                  <p className="text-[10px] text-zinc-700 group-hover:text-zinc-500 leading-tight transition-colors">
                    ログアウト
                  </p>
                </div>
              )}
            </button>
          </form>
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <div className={`flex-1 min-w-0 transition-[padding] duration-200 ease-in-out pb-safe md:pb-0 ${
        isCol ? "md:pl-14" : "md:pl-60"
      }`}>
        {children}
      </div>

      {/* ── モバイル bottom nav ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-xl border-t border-zinc-200/60 dark:border-zinc-800/60" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* セクション切り替えタブ */}
        {showSectionTabs && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
              {sections.map((section, idx) => {
                const isActiveSec = idx === activeSectionIdx;
                const SectionIcon = section.icon ? ICON_MAP[section.icon] : null;
                const label = section.mobileLabel ?? section.title ?? "メニュー";
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveSectionIdx(idx)}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                      isActiveSec
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {SectionIcon && <SectionIcon className="w-3 h-3" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 案件切り替えタブ（管理セクション表示中のみ） */}
        {activeSection.projectTabs && activeSection.projectTabs.length > 0 && (
          <ProjectTabsMobile tabs={activeSection.projectTabs} />
        )}

        {/* ナビアイテム */}
        <nav className="flex overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {activeSection.items.map((item) => {
            const active = isActive(item.href);
            const Icon = ICON_MAP[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 flex flex-col items-center justify-center py-2 px-2.5 gap-1 min-w-[58px] transition-colors ${
                  active ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <div className={`w-10 h-7 flex items-center justify-center rounded-xl transition-all ${
                  active ? "bg-blue-100 dark:bg-blue-950/70" : ""
                }`}>
                  <Icon className={`w-[22px] h-[22px] transition-transform ${active ? "scale-105" : ""}`} />
                </div>
                <span className={`text-[10px] leading-none tracking-tight ${active ? "font-bold" : "font-medium"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

      </div>
    </div>
  );
}
