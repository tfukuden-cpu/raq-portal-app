/**
 * ヘルプ・操作説明書
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";

const STAFF_FAQ = [
  {
    q: "シフトが表示されていない",
    a: "管理者がまだシフトを登録していない可能性があります。管理者にお問い合わせください。",
  },
  {
    q: "打刻時刻が間違っていた",
    a: "My → 打刻補正申請 から申請できます。管理者が承認すると勤怠実績に反映されます。",
  },
  {
    q: "希望休が申請できない",
    a: "今月の締切日を過ぎているか、月の申請上限に達している可能性があります。締切日・上限は案件によって異なりますので管理者にご確認ください。",
  },
  {
    q: "欠勤・遅刻報告はどこからする？",
    a: "ホーム画面の下部に「欠勤報告」「遅刻報告」のボタンがあります。出発前のタイミングでご利用ください。",
  },
  {
    q: "LINEで通知を受け取りたい",
    a: "My → LINE連携 からLINEアカウントを連携すると、シフト変更や申請審査の通知をLINEで受け取れます。",
  },
  {
    q: "パスワードを忘れた",
    a: "管理者にパスワードリセットを依頼してください。",
  },
  {
    q: "アプリをホーム画面に追加したい",
    a: "iOS: Safariで開いて「共有」→「ホーム画面に追加」 / Android: Chromeで開いて「メニュー」→「ホーム画面に追加」",
  },
];

const SECTIONS = [
  {
    title: "ホーム",
    items: [
      { label: "出発報告", desc: "現場に向かう前に青い丸ボタンをタップ。到着予定を選んで報告します。" },
      { label: "欠勤・遅刻報告", desc: "ホーム画面下部のリンクからいつでも報告できます。" },
      { label: "次回出勤", desc: "今後のシフトが表示されます。タップするとシフト詳細画面へ移動します。" },
    ],
  },
  {
    title: "シフト",
    items: [
      { label: "シフト確認", desc: "カレンダー形式で前後3ヶ月のシフトを確認できます。日付タップで詳細・変更履歴が表示されます。" },
      { label: "希望休申請", desc: "「希望休タブ」→「希望休を申請する」ボタンからカレンダーで日付を選んで申請します。" },
      { label: "希望休の取り下げ", desc: "申請済み一覧に表示されている項目をタップすると取り下げできます（締切前のみ）。" },
      { label: "追加申請", desc: "管理者が公開したシフト募集枠に応募できます。「追加申請タブ」から操作します。" },
    ],
  },
  {
    title: "勤怠実績",
    items: [
      { label: "月次実績の確認", desc: "月ごとの出勤日数・労働時間・日別の出退勤時刻を確認できます。" },
    ],
  },
  {
    title: "My",
    items: [
      { label: "打刻補正申請", desc: "出退勤の打刻時刻に誤りがある場合に申請します。管理者承認後に実績へ反映されます。" },
      { label: "LINE連携", desc: "連携するとシフト変更・申請結果などの通知をLINEで受け取れます。" },
      { label: "パスワード変更", desc: "現在のパスワードと新しいパスワードを入力して変更します。" },
    ],
  },
];

export default async function HelpPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();

  const [{ data: myStaff }, { data: membership }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    projectId
      ? supabase.from("project_members").select("role").eq("staff_id", staffId).eq("project_id", projectId!).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const isAdmin =
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive" ||
    membership?.role === "project_admin";

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-28 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">ヘルプ</h1>
          <p className="text-sm text-zinc-400 mt-1">操作方法・よくある質問</p>
        </div>

        {/* 操作説明書リンク */}
        <div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1 mb-2">操作説明書</p>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <a
              href="/help/manual-staff"
              className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-100 dark:border-zinc-800"
            >
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">スタッフ向け操作説明書</p>
                <p className="text-xs text-zinc-400 mt-0.5">全メニューの使い方を詳しく説明します</p>
              </div>
              <ChevronRightIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            </a>
            {isAdmin && (
              <a
                href="/help/manual-admin"
                className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">管理者向け操作説明書</p>
                  <p className="text-xs text-zinc-400 mt-0.5">シフト管理・勤怠修正・案件設定など</p>
                </div>
                <ChevronRightIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              </a>
            )}
          </div>
        </div>

        {/* 機能ガイド */}
        <div className="space-y-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">機能ガイド</p>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 px-1 mb-1.5">{section.title}</p>
              <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                {section.items.map((item, i) => (
                  <div
                    key={item.label}
                    className={`px-5 py-3.5 ${i < section.items.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
                  >
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{item.label}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* よくある質問 */}
        <div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1 mb-2">よくある質問</p>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            {STAFF_FAQ.map((item, i) => (
              <details
                key={item.q}
                className={`group ${i < STAFF_FAQ.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
              >
                <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 pr-3">Q. {item.q}</span>
                  <span className="text-zinc-300 dark:text-zinc-600 flex-shrink-0 text-lg leading-none group-open:rotate-45 transition-transform">＋</span>
                </summary>
                <div className="px-5 pb-4 pt-1">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">A. {item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* お問い合わせ */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-5 shadow-sm text-center">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">解決しない場合は</p>
          <p className="text-xs text-zinc-400 mb-3">管理者へ直接お問い合わせください</p>
          <a
            href="/inquiries"
            className="inline-block px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            問い合わせる
          </a>
        </div>
      </div>
    </main>
  );
}
