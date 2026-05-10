/**
 * 案件選択画面
 * 兼務者用に、所属している案件のリストから選ばせる
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { logoutAction } from "../login/actions";
import { selectProjectAction } from "./actions";

export default async function SelectProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 運用者（代表・役員）は案件メンバーでなくてもよい → 管理画面へ
  const { data: staffData } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (staffData?.global_role === "executive") {
    redirect("/admin");
  }

  // 所属案件一覧を取得
  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id, role, is_main, projects(id, name, is_active)")
    .eq("staff_id", staffId);

  const items = (memberships ?? [])
    .map((m) => {
      const project = Array.isArray(m.projects) ? m.projects[0] : m.projects;
      return { ...m, project };
    })
    .filter((m) => m.project?.is_active);

  if (items.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
        <div className="max-w-sm w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-zinc-700 dark:text-zinc-300 mb-4">
            所属している案件がありません。<br />
            管理者にお問い合わせください。
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              ログアウト
            </button>
          </form>
        </div>
      </main>
    );
  }

  // 所属が1件のみなら自動で選択してダッシュボードへ
  const currentProjectId = await getCurrentProjectId();
  if (items.length === 1 && !currentProjectId) {
    const fd = new FormData();
    fd.set("projectId", items[0].project!.id);
    await selectProjectAction(fd);
    // selectProjectAction が redirect するのでここには来ない
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black p-4">
      <div className="max-w-md mx-auto pt-8">
        <header className="text-center mb-6">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            案件を選択
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            利用する案件を選んでください
          </p>
        </header>

        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.project_id}>
              <form action={selectProjectAction}>
                <input type="hidden" name="projectId" value={m.project_id} />
                <button
                  type="submit"
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    currentProjectId === m.project_id
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700"
                      : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-xs text-zinc-500">
                        {m.project_id}
                      </span>
                      <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-50">
                        {m.project?.name}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {m.is_main && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                          メイン
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                        {m.role === "project_admin" ? "案件管理者" : "スタッフ"}
                      </span>
                    </div>
                  </div>
                </button>
              </form>
            </li>
          ))}
        </ul>

        <div className="mt-6 text-center">
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
