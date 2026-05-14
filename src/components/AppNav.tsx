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
  // 全セクションを結合してモバイルに表示（横スクロールで全件対応）
  const mobileItems = sections.flatMap(s => s.items);
  const initial = staffName.charAt(0).toUpperCase();

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
              Raq Portal
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
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-3 nav-safe bg-transparent">
        <nav
          className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 shadow-2xl shadow-black/10 flex overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {mobileItems.map((item) => {
            const active = isActive(item.href);
            const Icon = ICON_MAP[item.icon];
            return (
              <a
                key={item.href}
                href={item.href}
                className={`relative flex-shrink-0 flex flex-col items-center pt-2.5 pb-2.5 px-3 gap-[3px] transition-colors min-w-[64px] ${
                  active
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400 dark:text-zinc-600"
                }`}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[2px] bg-blue-500 rounded-b-full" />
                )}
                <Icon className="w-[20px] h-[20px]" />
                <span className="text-[9px] font-medium leading-none tracking-tight">
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
