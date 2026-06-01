/**
 * Myページ（全ロール共通）
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProjectId } from "@/lib/project-context";
import { logoutAction } from "@/app/login/actions";
import { unlinkLineAction } from "./actions";
import AvatarEditor from "@/app/(portal)/admin/my/AvatarEditor";
import type { AvatarConfig } from "@/app/(portal)/admin/my/avatar-types";
import PushNotifyToggle from "./PushNotifyToggle";

function ChevronRightIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-zinc-300"><polyline points="9 18 15 12 9 6"/></svg>;
}
function PersonIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function LockIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}
function LogoutIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
}
function LineIcon() {
  return <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ fill: "#06C755" }}><path d="M12 2C6.477 2 2 6.036 2 11c0 2.67 1.28 5.063 3.306 6.73.145.122.203.316.151.496l-.47 1.717c-.073.266.107.538.378.538.07 0 .14-.018.202-.054L8.05 19.05c.131-.076.284-.09.427-.039C9.357 19.332 10.666 19.5 12 19.5c5.523 0 10-4.036 10-9s-4.477-9-10-9z"/></svg>;
}
function BriefcaseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-zinc-500"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>;
}
function ShieldIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-zinc-500"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
}
function IdIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-zinc-500"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="16" y2="10"/><line x1="12" y1="14" x2="16" y2="14"/></svg>;
}

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: staff } = await supabase
    .from("staffs")
    .select("id, name, display_name, global_role, line_user_id, avatar_config")
    .eq("id", staffId)
    .maybeSingle();

  const projectId = await getCurrentProjectId();
  const [{ data: membership }, { data: projectData }] = await Promise.all([
    projectId
      ? supabase.from("project_members").select("role").eq("staff_id", staffId).eq("project_id", projectId).maybeSingle()
      : Promise.resolve({ data: null }),
    projectId
      ? supabase.from("projects").select("name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  let isAbsentToday = false;
  if (projectId) {
    const { data: absenceToday } = await supabase
      .from("absence_reports").select("id")
      .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", todayStr).maybeSingle();
    isAbsentToday = !!absenceToday;
  }

  const displayName  = staff?.display_name ?? staff?.name ?? staffId;
  const lineLinked   = !!staff?.line_user_id;
  const avatarConfig = (staff as { avatar_config?: AvatarConfig | null } | null)?.avatar_config ?? null;
  const projectName  = projectData?.name ?? "未所属";

  const isExecutiveOrAdmin = staff?.global_role === "admin" || staff?.global_role === "executive";
  const isProjectAdmin     = membership?.role === "project_admin";
  const isStaffOnly        = !isExecutiveOrAdmin && !isProjectAdmin;

  const roleLabel =
    staff?.global_role === "admin"      ? "システム管理者"
    : staff?.global_role === "executive" ? "運用者"
    : isProjectAdmin                     ? "案件管理者"
    : "スタッフ";

  const roleBadgeClass =
    staff?.global_role === "admin"       ? "bg-blue-100 text-blue-600"
    : staff?.global_role === "executive" ? "bg-purple-100 text-purple-600"
    : isProjectAdmin                     ? "bg-amber-100 text-amber-600"
    : "bg-zinc-100 text-zinc-500";

  const lineFlash =
    sp.success === "line_linked"       ? "LINEアカウントを連携しました"
    : sp.error === "line_already_used" ? "このLINEアカウントは他のスタッフに紐付いています"
    : sp.error === "line_cancelled"    ? "LINE連携をキャンセルしました"
    : null;

  const nowJST = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <main className="min-h-screen bg-[#f4f6fa] dark:bg-zinc-950 px-4 md:px-8 pt-6 pb-16">

      {/* ── タイトル ── */}
      <h1 className="text-[22px] font-bold text-[#0d1b35] dark:text-white mb-5">My</h1>

      {/* ── プロフィールカード ── */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6 mb-6">
        <div className="flex flex-col md:flex-row items-start gap-6">

          {/* アバター */}
          <div className="flex-shrink-0">
            {isExecutiveOrAdmin ? (
              <AvatarEditor initialConfig={avatarConfig} />
            ) : (
              <div className="relative w-24 h-24">
                <div className="w-24 h-24 rounded-full bg-[#0d1b35] dark:bg-zinc-700 flex items-center justify-center text-white text-[36px] font-bold select-none">
                  {displayName.charAt(0)}
                </div>
              </div>
            )}
          </div>

          {/* 名前 + 情報 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <h2 className="text-[24px] font-bold text-[#0d1b35] dark:text-white">{displayName}</h2>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${roleBadgeClass}`}>{roleLabel}</span>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <IdIcon />
                <span className="text-[13px] text-zinc-500 w-20 flex-shrink-0">社員ID</span>
                <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 font-mono">{staffId}</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldIcon />
                <span className="text-[13px] text-zinc-500 w-20 flex-shrink-0">権限</span>
                <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{roleLabel}</span>
              </div>
              <div className="flex items-center gap-3">
                <BriefcaseIcon />
                <span className="text-[13px] text-zinc-500 w-20 flex-shrink-0">所属案件</span>
                <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{projectName}</span>
              </div>
            </div>
          </div>

          {/* ステータスカード群 */}
          <div className="flex flex-row md:flex-col gap-3 flex-shrink-0 w-full md:w-auto">
            {/* 所属案件 */}
            <div className="flex-1 md:w-44 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3.5 text-center border border-zinc-100 dark:border-zinc-700">
              <BriefcaseIcon />
              <p className="text-[11px] text-zinc-400 mb-1 mt-1.5">所属案件</p>
              <p className="text-[12px] font-bold text-[#0d1b35] dark:text-white truncate">{projectName}</p>
            </div>
            {/* LINE連携 */}
            <div className="flex-1 md:w-44 bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3.5 text-center border border-zinc-100 dark:border-zinc-700">
              <div className="flex justify-center"><LineIcon /></div>
              <p className="text-[11px] text-zinc-400 mb-1 mt-1.5">LINE連携</p>
              {lineLinked ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#06C755]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#06C755]" />連携済み
                </span>
              ) : (
                <span className="text-[11px] text-zinc-400">未連携</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LINE フラッシュ */}
      {lineFlash && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-[13px] font-medium ${
          sp.success ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"
        }`}>{lineFlash}</div>
      )}

      {/* ── アカウント設定 ── */}
      <div>
        <h2 className="text-[15px] font-bold text-[#0d1b35] dark:text-white mb-3">アカウント設定</h2>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">

          {/* スタッフのみ */}
          {isStaffOnly && (
            <>
              <a href="/corrections" className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-500"><LockIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">打刻補正申請</p>
                  <p className="text-[12px] text-zinc-400 mt-0.5">打刻時刻の修正を申請できます</p>
                </div>
                <ChevronRightIcon />
              </a>
              {isAbsentToday && (
                <a href="/absence-followup" className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800 bg-red-50 dark:bg-red-950/10 hover:bg-red-100/50 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0 text-red-500"><PersonIcon /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-red-600 dark:text-red-400">経過報告</p>
                    <p className="text-[12px] text-zinc-400 mt-0.5">翌日の出勤可否を報告してください</p>
                  </div>
                  <ChevronRightIcon />
                </a>
              )}
            </>
          )}

          {/* パスワード変更 */}
          <a href="/change-password" className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-500"><LockIcon /></div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">パスワード変更</p>
              <p className="text-[12px] text-zinc-400 mt-0.5">現在のパスワードの変更ができます</p>
            </div>
            <ChevronRightIcon />
          </a>

          {/* LINE連携 */}
          {lineLinked ? (
            <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0"><LineIcon /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">LINE連携</p>
                <p className="text-[12px] text-[#06C755] font-medium mt-0.5">● 連携済み</p>
              </div>
              <form action={unlinkLineAction}>
                <button type="submit" className="text-[12px] text-zinc-400 hover:text-red-500 transition-colors px-3 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-red-200">解除</button>
              </form>
            </div>
          ) : (
            <a href="/api/auth/line?mode=link" className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0"><LineIcon /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">LINE連携</p>
                <p className="text-[12px] text-zinc-400 mt-0.5">LINEとの連携・解除ができます</p>
              </div>
              <ChevronRightIcon />
            </a>
          )}

          {/* プッシュ通知 */}
          <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 dark:border-zinc-800">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-blue-500">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">プッシュ通知</p>
              <p className="text-[12px] text-zinc-400 mt-0.5">端末への通知を受け取れます</p>
            </div>
            <PushNotifyToggle />
          </div>

          {/* ログアウト */}
          <form action={logoutAction}>
            <button type="submit" className="w-full flex items-center gap-4 px-5 py-4 hover:bg-red-50 dark:hover:bg-red-950/10 transition-colors text-left">
              <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-500"><LogoutIcon /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-red-500">ログアウト</p>
                <p className="text-[12px] text-zinc-400 mt-0.5">現在のアカウントからログアウトします</p>
              </div>
              <ChevronRightIcon />
            </button>
          </form>

        </div>
      </div>
    </main>
  );
}
