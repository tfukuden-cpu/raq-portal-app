"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavItem, NavSection } from "@/app/(portal)/layout";
import { ICON_MAP, MenuIcon, LogOutIcon } from "@/components/icons";

interface AppNavProps {
  sections: NavSection[];
  staffName: string;
  projectName: string | null;
  logoutAction: () => Promise<void>;
  initialCollapsed: boolean;
  children: React.ReactNode;
}

export default function AppNav({
  sections,
  staffName,
  logoutAction,
  initialCollapsed,
  children,
}: AppNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `rqp-nav-collapsed=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
    if (href === "/admin") return pathname.startsWith("/admin");
    return pathname === href || pathname.startsWith(href + "/");
  };

  const isCol = collapsed;
  const initial = staffName.charAt(0).toUpperCase();

  // モバイル: 現在のパスが属するセクションを初期表示
  const defaultSectionIdx = Math.max(
    0,
    sections.findIndex(s => s.items.some(item => isActive(item.href)))
  );
  const [activeSectionIdx, setActiveSectionIdx] = useState(defaultSectionIdx);
  const activeSection = sections[activeSectionIdx] ?? sections[0];
  const showSectionTabs = sections.length > 1;


  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">

      {/* ── PC サイドバー（常にダーク） ── */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full z-40 bg-[#111111] border-r border-white/[0.06] transition-[width] duration-200 ease-in-out overflow-hidden ${
          isCol ? "w-14" : "w-52"
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
              {!isCol && section.title && (
                <p className="px-2.5 pt-2 pb-1.5 text-[9px] font-semibold text-zinc-700 uppercase tracking-[0.12em] select-none">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = ICON_MAP[item.icon];
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    title={isCol ? item.label : undefined}
                    className={`relative flex items-center h-8 rounded-md transition-colors overflow-hidden ${
                      isCol ? "justify-center" : "gap-2.5 px-2.5"
                    } ${
                      active
                        ? "text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-200"
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
                  </a>
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
        isCol ? "md:pl-14" : "md:pl-52"
      }`}>
        {children}
      </div>

      {/* ── モバイル bottom nav ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* セクション切り替え（セグメントコントロール） */}
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

        {/* ナビアイテム */}
        <nav className="flex overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {activeSection.items.map((item) => {
            const active = isActive(item.href);
            const Icon = ICON_MAP[item.icon];
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 flex flex-col items-center justify-center py-1.5 px-2.5 gap-0.5 min-w-[58px] rounded-xl transition-colors ${
                  active
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <div className={`p-1.5 rounded-xl transition-colors ${active ? "bg-blue-50 dark:bg-blue-950/60" : ""}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
                  {item.label}
                </span>
              </a>
            );
          })}
        </nav>

      </div>
    </div>
  );
}
