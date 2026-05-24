/**
 * Myページ（全ロール共通）
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProjectId } from "@/lib/project-context";
import { logoutAction } from "@/app/login/actions";
import { unlinkLineAction } from "./actions";
import { ChevronRightIcon, UserCircleIcon } from "@/components/icons";
import AvatarEditor from "@/app/(portal)/admin/my/AvatarEditor";
import type { AvatarConfig } from "@/app/(portal)/admin/my/avatar-types";

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: staff } = await supabase
    .from("staffs")
    .select("id, name, display_name, global_role, line_user_id, avatar_config")
    .eq("id", staffId)
    .maybeSingle();

  const projectId = await getCurrentProjectId();
  const { data: membership } = projectId
    ? await supabase
        .from("project_members")
        .select("role")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .maybeSingle()
    : { data: null };

  const displayName  = staff?.display_name ?? staff?.name ?? staffId;
  const lineLinked   = !!staff?.line_user_id;
  const avatarConfig = (staff as { avatar_config?: AvatarConfig | null } | null)?.avatar_config ?? null;

  // 当日欠勤かつ未報告チェック（経過報告ボタン表示用）
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  let isAbsentToday = false;
  if (projectId) {
    const { data: absenceToday } = await supabase
      .from("absence_reports")
      .select("id")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .eq("absence_date", todayStr)
      .maybeSingle();
    isAbsentToday = !!absenceToday;
  }

  const isExecutiveOrAdmin =
    staff?.global_role === "admin" || staff?.global_role === "executive";
  const isProjectAdmin = membership?.role === "project_admin";
  const isStaffOnly    = !isExecutiveOrAdmin && !isProjectAdmin;

  const roleLabel =
    staff?.global_role === "admin"      ? "システム管理者"
    : staff?.global_role === "executive" ? "運用者"
    : isProjectAdmin                     ? "案件管理者"
    : "スタッフ";

  const roleBadgeClass =
    staff?.global_role === "admin"       ? "bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
    : staff?.global_role === "executive" ? "bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400"
    : isProjectAdmin                     ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500";

  const lineFlash =
    sp.success === "line_linked"         ? "LINEアカウントを連携しました"
    : sp.error === "line_already_used"   ? "このLINEアカウントは他のスタッフに紐付いています"
    : sp.error === "line_cancelled"      ? "LINE連携をキャンセルしました"
    : null;

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">My</h1>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-28 space-y-5">

        {/* プロフィールカード */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
          {isExecutiveOrAdmin ? (
            /* 運用者・管理者：アバター付き */
            <div className="flex flex-col items-center gap-3">
              <AvatarEditor initialConfig={avatarConfig} />
              <div className="text-center">
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">{displayName}</p>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{staffId}</p>
                <span className={`inline-block mt-2 text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${roleBadgeClass}`}>
                  {roleLabel}
                </span>
              </div>
            </div>
          ) : (
            /* スタッフ・案件管理者：横並び */
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <UserCircleIcon className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">{displayName}</p>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{staffId}</p>
                <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${roleBadgeClass}`}>
                  {roleLabel}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* アカウントメニュー */}
        <div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1 mb-2">アカウント</p>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            {/* スタッフのみ：打刻補正申請・打刻画面 */}
            {isStaffOnly && (
              <>
                <a
                  href="/corrections"
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800"
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">打刻補正申請</span>
                  <ChevronRightIcon className="w-4 h-4 text-zinc-400" />
                </a>
                <a
                  href="/punch"
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800"
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">打刻画面</span>
                  <ChevronRightIcon className="w-4 h-4 text-zinc-400" />
                </a>
                {isAbsentToday && (
                  <a
                    href="/absence-followup"
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800 bg-red-50 dark:bg-red-900/10"
                  >
                    <div>
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400">経過報告</span>
                      <p className="text-xs text-zinc-400 mt-0.5">翌日の出勤可否を報告してください</p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-red-400" />
                  </a>
                )}
              </>
            )}
            <a
              href="/change-password"
              className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">パスワード変更</span>
              <ChevronRightIcon className="w-4 h-4 text-zinc-400" />
            </a>
          </div>
        </div>

        {/* LINE連携 */}
        <div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1 mb-2">LINE連携</p>

          {lineFlash && (
            <div className={`px-3 py-2 rounded-xl mb-2 space-y-1.5 ${
              sp.success ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" : "bg-red-50 dark:bg-red-950/30 text-red-500"
            }`}>
              <p className="text-xs">{lineFlash}</p>
            </div>
          )}

          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            {lineLinked ? (
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#06C755] flex-shrink-0" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">連携済み</span>
                </div>
                <form action={unlinkLineAction}>
                  <button type="submit" className="text-xs text-zinc-400 hover:text-red-500 transition-colors">
                    解除
                  </button>
                </form>
              </div>
            ) : (
              <a
                href="/api/auth/line?mode=link"
                className="flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" style={{ fill: "#06C755" }}>
                    <path d="M19.365 9.89c.50 0 .906.407.906.907s-.406.907-.906.907H17.27v1.204h2.094c.5 0 .906.406.906.906s-.406.907-.906.907h-3c-.5 0-.907-.407-.907-.907V9.89c0-.5.407-.907.907-.907h3zm-5.423 0c.5 0 .906.407.906.907v3.924c0 .5-.406.907-.906.907s-.906-.407-.906-.907V10.797c0-.5.406-.907.906-.907zm-2.854 0c.346 0 .657.197.81.504l1.672 3.34c.222.444.041.985-.402 1.207-.443.222-.985.041-1.207-.402l-.22-.44h-1.306l-.22.44c-.222.443-.764.624-1.207.402-.443-.222-.624-.763-.402-1.207l1.672-3.34c.153-.307.464-.504.81-.504zm0 2.27l-.356.71h.713l-.356-.71zM5.84 9.89c.5 0 .906.407.906.907v2.354l1.814-2.682c.183-.27.487-.42.807-.38.32.04.6.26.706.57.044.132.063.267.055.4v3.757c0 .5-.406.907-.906.907s-.907-.407-.907-.907v-2.354l-1.814 2.682c-.21.31-.579.456-.935.376-.357-.08-.627-.376-.669-.74-.01-.083-.01-.167 0-.25V10.797c0-.5.406-.907.906-.907zM12 2C6.477 2 2 6.036 2 11c0 2.67 1.28 5.063 3.306 6.73.145.122.203.316.151.496l-.47 1.717c-.073.266.107.538.378.538.07 0 .14-.018.202-.054L8.05 19.05c.131-.076.284-.09.427-.039C9.357 19.332 10.666 19.5 12 19.5c5.523 0 10-4.036 10-9s-4.477-9-10-9z"/>
                  </svg>
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">LINEアカウントを連携する</span>
                </div>
                <ChevronRightIcon className="w-4 h-4 text-zinc-400" />
              </a>
            )}
          </div>
          <p className="text-[10px] text-zinc-400 px-1 mt-1.5">
            連携するとLINEでログインしたり、各種通知をLINEで受け取れます
          </p>
        </div>

        {/* ログアウト */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            ログアウト
          </button>
        </form>
      </div>
    </main>
  );
}

