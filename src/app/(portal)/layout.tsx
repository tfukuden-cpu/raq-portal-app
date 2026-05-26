import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppNav from "@/components/AppNav";
import { logoutAction } from "@/app/login/actions";
import { switchProjectAction } from "./switch-project-action";
import type { IconKey } from "@/components/icons";

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
  { href: "/post",       icon: "PenSquare",     label: "投稿" },
  { href: "/inquiries",  icon: "MessageSquare", label: "問い合わせ" },
  { href: "/help",       icon: "HelpCircle",    label: "ヘルプ" },
];

// ── 管理メニュー（管理者・運用者共通） ───────────────────
const ADMIN_MENU_ITEMS: NavItem[] = [
  { href: "/attendance",      icon: "Users",           label: "当日状況" },   // 座席表統合
  { href: "/shifts/manage",   icon: "CalendarSettings", label: "シフト管理" },
  { href: "/members",         icon: "IdCard",          label: "メンバー管理" },
  { href: "/notices/manage",  icon: "Megaphone",       label: "周知・問合せ" }, // 周知＋問合せ統合
  { href: "/attendance/edit", icon: "ClipboardCheck",  label: "勤怠管理" },
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
    .select("name, display_name, global_role, line_user_id")
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

  // ── セクション構築 ───────────────────────────────────
  let sections: NavSection[];

  if (viewMode === "ops") {
    // 運用者：管理セクションに案件切り替えタブを付与
    const projectTabs = opsProjects.map(p => ({
      id: p.id, name: p.name, isActive: p.id === projectId,
    }));
    sections = [
      { mobileLabel: "メイン", icon: "Home",
        items: [...STAFF_ITEMS, MY_ITEM] },
      { title: "管理", icon: "Settings",
        items: ADMIN_MENU_ITEMS,
        projectTabs },
      { title: "運営", icon: "Shield",
        items: OPS_MENU_ITEMS },
    ];
  } else if (viewMode === "admin") {
    sections = [
      { mobileLabel: "メイン", icon: "Home",
        items: [...STAFF_ITEMS, MY_ITEM] },
      { title: "管理", icon: "Settings",
        items: ADMIN_MENU_ITEMS },
    ];
  } else {
    sections = [{ items: [...STAFF_ITEMS, MY_ITEM] }];
  }

  const staffName = staff?.display_name ?? staff?.name ?? staffId;

  return (
    <AppNav
      sections={sections}
      staffName={staffName}
      projectName={projectName}
      logoutAction={logoutAction}
      switchProjectAction={switchProjectAction}
      initialCollapsed={initialCollapsed}
    >
      {children}
    </AppNav>
  );
}
