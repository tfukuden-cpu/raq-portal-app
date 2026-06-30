import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppNav from "@/components/AppNav";
import { logoutAction } from "@/app/login/actions";
import { switchProjectAction } from "./switch-project-action";
import type { IconKey } from "@/components/icons";
import PushPermissionRequest from "./PushPermissionRequest";
import LineFriendGate from "./LineFriendGate";

export type NavItem = { href: string; icon: IconKey; label: string };
export type NavSection = {
  title?: string;
  mobileLabel?: string;
  icon?: IconKey;
  items: NavItem[];
  /** 運用者アカウントの管理セクション用：案件切り替えタブ */
  projectTabs?: { id: string; name: string; isActive: boolean }[];
};

// ── スタッフ共通メニュー ─────────────────────────────────
const STAFF_ITEMS: NavItem[] = [
  { href: "/dashboard",  icon: "Home",          label: "ホーム" },
  { href: "/shifts",     icon: "Calendar",      label: "シフト" },
  { href: "/record",     icon: "BarChart2",     label: "勤怠実績" },
  { href: "/messages",   icon: "MessageSquare", label: "メッセージ" },
  { href: "/help",       icon: "HelpCircle",    label: "ヘルプ" },
];

// ── 管理メニュー（管理者・運用者共通） ───────────────────
const ADMIN_MENU_ITEMS: NavItem[] = [
  { href: "/attendance",      icon: "Users",           label: "当日状況" },   // 座席表統合
  { href: "/shifts/manage",   icon: "CalendarSettings", label: "シフト管理" },
  { href: "/members",         icon: "IdCard",          label: "メンバー管理" },
  { href: "/attendance/edit",        icon: "ClipboardCheck", label: "勤怠管理" },
  { href: "/line-settings",   icon: "Smartphone",      label: "LINE連携" },
  { href: "/admin",           icon: "Settings",        label: "案件設定" },
];

// ── 運用メニュー（運用者のみ） ───────────────────────────
const OPS_MENU_ITEMS: NavItem[] = [
  { href: "/admin",           icon: "Grid",   label: "案件管理" },
  { href: "/admin/operators", icon: "Shield", label: "運用者管理" },
  { href: "/admin/staffs",    icon: "IdCard", label: "スタッフ一覧" },
];

const MY_ITEM: NavItem = { href: "/my", icon: "UserCircle", label: "My" };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <>{children}</>;

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: staff } = await supabase
    .from("staffs")
    .select("name, display_name, global_role, line_user_id, line_friend, rpg_character")
    .eq("id", staffId)
    .maybeSingle();

  if (!staff?.line_user_id) redirect("/link-line");

  const isExecutive   = staff?.global_role === "executive";
  const isGlobalAdmin = staff?.global_role === "admin";

  const cookieStore    = await cookies();
  const initialCollapsed = cookieStore.get("rqp-nav-collapsed")?.value === "true";

  const projectId = await getCurrentProjectId();
  let isProjectAdmin = false;
  let projectName: string | null = null;

  if (projectId) {
    const [{ data: project }, { data: membership }] = await Promise.all([
      supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
      supabase.from("project_members").select("role")
        .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    ]);
    projectName = project?.name ?? null;
    isProjectAdmin = membership?.role === "project_admin";
  }

  // ── 運用者：全案件リスト取得（案件切り替えタブ用） ───
  let opsProjects: { id: string; name: string }[] = [];
  if (isExecutive) {
    const admin = createAdminClient();
    const { data: pj } = await admin
      .from("projects").select("id, name").eq("is_active", true).order("id");
    opsProjects = pj ?? [];
  }

  // ── 表示モード確定 ───────────────────────────────────
  type ViewMode = "staff" | "admin" | "ops";
  let viewMode: ViewMode;
  if (isExecutive) {
    viewMode = "ops";
  } else if (isGlobalAdmin) {
    viewMode = "admin";
  } else if (isProjectAdmin) {
    const savedMode = cookieStore.get("rqp-view-mode")?.value as ViewMode | undefined;
    viewMode = (savedMode === "staff" || savedMode === "admin") ? savedMode : "admin";
  } else {
    viewMode = "staff";
  }

  // ガチャ／モンスターはナビに出さず、ホームのキャラエリアのアイコンから開く
  const staffMenu: NavItem[] = STAFF_ITEMS;

  // ── セクション構築 ───────────────────────────────────
  let sections: NavSection[];

  if (viewMode === "ops") {
    // 運用者：管理セクションに案件切り替えタブを付与
    const projectTabs = opsProjects.map(p => ({
      id: p.id, name: p.name, isActive: p.id === projectId,
    }));
    sections = [
      { mobileLabel: "メイン", icon: "Home",
        items: [...staffMenu, MY_ITEM] },
      { title: "管理", icon: "Settings",
        items: ADMIN_MENU_ITEMS,
        projectTabs },
      { title: "運営", icon: "Shield",
        items: OPS_MENU_ITEMS },
    ];
  } else if (viewMode === "admin") {
    // project_admin（非グローバル）は案件設定を直リンクにする
    const settingsHref = (!isGlobalAdmin && isProjectAdmin && projectId)
      ? `/admin/${projectId}`
      : "/admin";
    const adminItems = ADMIN_MENU_ITEMS.map(item =>
      item.href === "/admin" ? { ...item, href: settingsHref } : item
    );
    sections = [
      { mobileLabel: "メイン", icon: "Home",
        items: [...staffMenu, MY_ITEM] },
      { title: "管理", icon: "Settings",
        items: adminItems },
    ];
  } else {
    sections = [{ items: [...staffMenu, MY_ITEM] }];
  }

  const staffName = staff?.display_name ?? staff?.name ?? staffId;

  // LINE友達追加ゲート用のURLを取得（line_friend でない場合のみ）
  let lineAddUrl = process.env.NEXT_PUBLIC_LINE_ADD_FRIEND_URL ?? "";
  if (!staff?.line_friend && !lineAddUrl) {
    try {
      const botRes = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
        next: { revalidate: 3600 }, // 1時間キャッシュ
      });
      if (botRes.ok) {
        const botInfo = await botRes.json() as { basicId?: string };
        if (botInfo.basicId) {
          lineAddUrl = `https://line.me/R/ti/p/${botInfo.basicId}`;
        }
      }
    } catch {
      // フォールバック：ゲートは表示するがURLは空
    }
  }

  return (
    <>
      {!staff?.line_friend && (
        <LineFriendGate lineAddUrl={lineAddUrl} />
      )}
      <PushPermissionRequest />
      <AppNav
        sections={sections}
        staffName={staffName}
        staffId={staffId}
        rpgCharId={(staff as { rpg_character?: number | null } | null)?.rpg_character ?? null}
        projectName={projectName}
        logoutAction={logoutAction}
        switchProjectAction={switchProjectAction}
        initialCollapsed={initialCollapsed}
      >
        {children}
      </AppNav>
    </>
  );
}
