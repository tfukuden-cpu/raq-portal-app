import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppNav from "@/components/AppNav";
import { logoutAction } from "@/app/login/actions";
import type { IconKey } from "@/components/icons";

export type NavItem = { href: string; icon: IconKey; label: string };
export type NavSection = { title?: string; mobileLabel?: string; icon?: IconKey; items: NavItem[] };

const STAFF_ITEMS: NavItem[] = [
  { href: "/dashboard",  icon: "Home",          label: "ホーム" },
  { href: "/shifts",     icon: "Calendar",      label: "シフト" },
  { href: "/record",     icon: "BarChart2",     label: "勤怠実績" },
  { href: "/post",       icon: "PenSquare",     label: "投稿" },
  { href: "/inquiries",  icon: "MessageSquare", label: "問い合わせ" },
  { href: "/help",       icon: "HelpCircle",    label: "ヘルプ" },
];

const PROJECT_ADMIN_ITEMS: NavItem[] = [
  { href: "/attendance",      icon: "Users",           label: "当日状況" },
  { href: "/seating",         icon: "LayoutGrid",      label: "座席表" },
  { href: "/shifts/manage",   icon: "CalendarSettings", label: "シフト管理" },
  { href: "/members",         icon: "IdCard",          label: "メンバー管理" },
  { href: "/notices/manage",  icon: "Megaphone",       label: "周知管理" },
  { href: "/inquiries/manage", icon: "MessageSquare",  label: "問合せ管理" },
  { href: "/attendance/edit", icon: "ClipboardCheck",  label: "勤怠管理" },
  { href: "/tasks",           icon: "CheckSquare",     label: "タスク" },
  { href: "/line-settings",   icon: "Smartphone",      label: "LINE設定" },
];

const EXECUTIVE_ITEMS: NavItem[] = [
  { href: "/admin", icon: "Grid", label: "案件管理" },
  { href: "/admin/staffs", icon: "IdCard", label: "スタッフ管理" },
  { href: "/admin/operators", icon: "Shield", label: "運用者管理" },
];

const MY_STAFF: NavItem = { href: "/my",       icon: "UserCircle", label: "My" };
const MY_ADMIN: NavItem = { href: "/my", icon: "UserCircle", label: "My" };

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: staff } = await supabase
    .from("staffs")
    .select("name, display_name, global_role, line_user_id")
    .eq("id", staffId)
    .maybeSingle();

  // LINE未連携の場合は連携ページへ強制リダイレクト
  if (!staff?.line_user_id) {
    redirect("/link-line");
  }

  const isExecutive   = staff?.global_role === "executive";
  const isGlobalAdmin = staff?.global_role === "admin" || staff?.global_role === "executive";

  // 運用者は全案件リストを取得
  let opsProjects: { id: string; name: string }[] = [];
  if (isExecutive) {
    const admin = createAdminClient();
    const { data: pj } = await admin
      .from("projects").select("id, name").eq("is_active", true).order("id");
    opsProjects = pj ?? [];
  }

  const cookieStore = await cookies();
  const initialCollapsed =
    cookieStore.get("rqp-nav-collapsed")?.value === "true";

  // 案件メンバーシップを全アカウント共通で取得
  const projectId = await getCurrentProjectId();
  let isProjectAdmin = false;
  let projectName: string | null = null;

  if (projectId) {
    const [{ data: project }, { data: membership }] = await Promise.all([
      supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
      supabase
        .from("project_members")
        .select("role")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .maybeSingle(),
    ]);
    projectName = project?.name ?? null;
    isProjectAdmin = membership?.role === "project_admin";
  }

  // 利用可能モードを確定（運用者はops固定、管理者はadmin固定、スタッフのみstaffと切替可）
  type ViewMode = "staff" | "admin" | "ops";
  let viewMode: ViewMode;
  if (isExecutive) {
    viewMode = "ops";
  } else if (isGlobalAdmin) {
    viewMode = "admin";
  } else if (isProjectAdmin) {
    // project_admin はstaffビューへの切替可
    const savedMode = cookieStore.get("rqp-view-mode")?.value as ViewMode | undefined;
    viewMode = (savedMode === "staff" || savedMode === "admin") ? savedMode : "admin";
  } else {
    viewMode = "staff";
  }

  // 案件設定リンク（現在の projectId に基づく動的アイテム）
  const projectSettingsItem: NavItem | null = projectId
    ? { href: `/admin/${projectId}`, icon: "Settings", label: "案件設定" }
    : null;

  // 表示モードに応じてメニューを構築
  let sections: NavSection[];
  if (viewMode === "ops") {
    const adminItems = projectSettingsItem
      ? [...PROJECT_ADMIN_ITEMS, projectSettingsItem]
      : PROJECT_ADMIN_ITEMS;
    sections = [
      { mobileLabel: "メイン", icon: "Home",     items: [...STAFF_ITEMS, MY_ADMIN] },
      { title: "管理",         icon: "Settings", items: adminItems },
      { title: "運営",         icon: "Shield",   items: EXECUTIVE_ITEMS },
    ];
  } else if (viewMode === "admin") {
    const adminItems = projectSettingsItem
      ? [...PROJECT_ADMIN_ITEMS, projectSettingsItem]
      : PROJECT_ADMIN_ITEMS;
    sections = [
      { mobileLabel: "メイン", icon: "Home",     items: [...STAFF_ITEMS, MY_ADMIN] },
      { title: "管理",         icon: "Settings", items: adminItems },
    ];
  } else {
    sections = [{ items: [...STAFF_ITEMS, MY_STAFF] }];
  }

  const staffName = staff?.display_name ?? staff?.name ?? staffId;

  return (
    <AppNav
      sections={sections}
      staffName={staffName}
      projectName={projectName}
      logoutAction={logoutAction}
      initialCollapsed={initialCollapsed}
    >
      {children}
    </AppNav>
  );
}
