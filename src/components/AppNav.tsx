"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
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

const WD = ["日","月","火","水","木","金","土"];

function nowHHMM(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDateHeader(): string {
  const d   = new Date();
  const jst = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y   = jst.getFullYear();
  const m   = String(jst.getMonth() + 1).padStart(2, "0");
  const day = String(jst.getDate()).padStart(2, "0");
  const wd  = WD[jst.getDay()];
  return `${y}.${m}.${day}（${wd}）`;
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

export default function AppNav({
  sections,
  staffName,
  projectName,
  logoutAction,
  switchProjectAction,
  initialCollapsed,
  children,
}: AppNavProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [switching, startSwitch]  = useTransition();
  const [liveTime,  setLiveTime]  = useState(nowHHMM);
  const [dateStr,   setDateStr]   = useState(fmtDateHeader);

  useEffect(() => {
    const tick = () => { setLiveTime(nowHHMM()); setDateStr(fmtDateHeader()); };
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  // シフト・勤怠実績ページではページスクロールを封じる
  const isNoScrollPage = pathname.startsWith("/shifts") || pathname.startsWith("/record") || pathname.startsWith("/post") || pathname.startsWith("/notices") || pathname === "/inquiries";
  useEffect(() => {
    if (!isNoScrollPage) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isNoScrollPage]);

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
                ? "bg-[#0d1b35] text-white"
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
    <div className="flex min-h-screen bg-[#f4f6fa] dark:bg-zinc-950">

      {/* ── PC サイドバー（ネイビー） ── */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full z-40 bg-[#0d1b35] transition-[width] duration-200 ease-in-out overflow-hidden ${
          isCol ? "w-14" : "w-60"
        }`}
      >
        {/* ロゴ + トグル */}
        <div className={`flex items-center h-14 flex-shrink-0 border-b border-white/[0.08] ${
          isCol ? "justify-center" : "px-4 gap-3"
        }`}>
          <button
            onClick={toggle}
            aria-label={isCol ? "メニューを開く" : "メニューを閉じる"}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
          >
            <MenuIcon className="w-4 h-4" />
          </button>
          {!isCol && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-full border-2 border-white/60 flex-shrink-0" />
              <span className="text-[14px] font-semibold text-white truncate">
                RaqWorks
              </span>
            </div>
          )}
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-0.5">
          {sections.map((section, si) => (
            <div key={si}>
              {si > 0 && (
                <div className="my-3 mx-1 border-t border-white/[0.08]" />
              )}
              {!isCol && (
                section.projectTabs && section.projectTabs.length > 0 ? (
                  <div
                    className="flex overflow-x-auto mt-1 mb-1 border-b border-white/[0.08]"
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
                            ? "border-blue-400 text-white"
                            : "border-transparent text-white/40 hover:text-white/70",
                        ].join(" ")}
                      >
                        {tab.name.length > 7 ? tab.name.slice(0, 7) + "…" : tab.name}
                      </button>
                    ))}
                  </div>
                ) : section.title ? (
                  <p className="px-2 pt-2 pb-1.5 text-[9px] font-semibold text-white/30 uppercase tracking-[0.12em] select-none">
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
                    className={`flex items-center h-10 rounded-xl transition-colors ${
                      isCol ? "justify-center" : "gap-3 px-3"
                    } ${
                      active
                        ? "bg-white/[0.12] text-white"
                        : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!isCol && (
                      <span className={`text-[13.5px] leading-none ${active ? "font-semibold" : "font-normal"}`}>
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
        <div className="border-t border-white/[0.08] p-2.5 flex-shrink-0">
          <form action={logoutAction}>
            <button
              type="submit"
              title={isCol ? `${staffName} — ログアウト` : undefined}
              className={`w-full flex items-center h-10 rounded-xl transition-colors hover:bg-white/[0.06] group ${
                isCol ? "justify-center" : "gap-3 px-2"
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                {initial}
              </div>
              {!isCol && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[12px] font-medium text-white/80 truncate leading-tight">
                    {staffName}
                  </p>
                  <p className="text-[10px] text-white/30 group-hover:text-white/50 leading-tight transition-colors">
                    ログアウト
                  </p>
                </div>
              )}
            </button>
          </form>
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <div className={`flex-1 min-w-0 flex flex-col transition-[padding] duration-200 ease-in-out pb-safe md:pb-0 ${
        isCol ? "md:pl-14" : "md:pl-60"
      }`}>

        {/* ── PC トップヘッダー ── */}
        <header className="hidden md:flex sticky top-0 z-30 h-14 bg-white border-b border-zinc-100 dark:bg-zinc-900 dark:border-zinc-800 items-center px-6 gap-3 flex-shrink-0">
          {projectName && (
            <>
              <span className="text-[14px] font-semibold text-[#0d1b35] dark:text-zinc-100">{projectName}</span>
              <span className="text-zinc-200 dark:text-zinc-700 select-none">|</span>
            </>
          )}
          <span className="text-[13px] text-zinc-400 tabular-nums">{dateStr}</span>
          <span className="text-[20px] font-bold tabular-nums text-zinc-800 dark:text-zinc-100 ml-0.5">{liveTime}</span>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/notices" className="p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              <BellIcon className="w-5 h-5 text-zinc-400" />
            </Link>
            <div className="flex items-center gap-2.5 pl-2 border-l border-zinc-100 dark:border-zinc-800">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0">
                {initial}
              </div>
              <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hidden lg:block">
                {staffName}
              </span>
            </div>
          </div>
        </header>

        {children}
      </div>

      {/* ── モバイル bottom nav ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/60 dark:border-zinc-800/60" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>

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

        {activeSection.projectTabs && activeSection.projectTabs.length > 0 && (
          <ProjectTabsMobile tabs={activeSection.projectTabs} />
        )}

        <nav className="flex overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {activeSection.items.map((item) => {
            const active = isActive(item.href);
            const Icon = ICON_MAP[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 flex flex-col items-center justify-center py-2 px-2.5 gap-1 min-w-[58px] transition-colors ${
                  active ? "text-[#0d1b35] dark:text-blue-400" : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <div className={`w-10 h-7 flex items-center justify-center rounded-xl transition-all ${
                  active ? "bg-blue-50 dark:bg-blue-950/70" : ""
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
