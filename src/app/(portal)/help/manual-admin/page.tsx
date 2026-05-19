/**
 * 管理者向け操作説明書
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";

const SECTIONS = [
  {
    id: "roles",
    title: "1. ロールと権限",
    content: [
      {
        heading: "ロールの種類",
        body: "スタッフ：ホーム・シフト・勤怠実績・投稿・問い合わせ・My\n案件管理者（project_admin）：スタッフ機能全部 ＋ 当日状況・シフト管理・お知らせ管理・問合せ管理・勤怠修正・実績出力・案件設定\nシステム管理者（admin）・運営者（executive）：上記全部 ＋ 案件管理・スタッフ管理・運用者管理",
      },
    ],
  },
  {
    id: "attendance",
    title: "2. 当日状況",
    content: [
      {
        heading: "画面の見かた",
        body: "本日出勤予定のスタッフ全員の状況をリアルタイムで確認できます。画面上部のサマリーカードに「出勤・遅刻・欠勤」の人数が表示されます。",
      },
      {
        heading: "ステータスの手動変更",
        body: "スタッフカードをタップするとステータスを手動で変更できます。システムの打刻が使えない場合や特殊な状況の記録に使います。",
      },
      {
        heading: "セクションフィルター",
        body: "複数セクションがある案件では、上部のフィルターボタンでセクション別に絞り込めます。",
      },
    ],
  },
  {
    id: "shifts",
    title: "3. シフト管理",
    content: [
      {
        heading: "シフトグリッドの見かた",
        body: "縦軸がスタッフ、横軸が日付のグリッド形式でシフトを一覧確認できます。上部の「‹」「›」で月を切り替えます。スタッフ名をタップするとメンバー設定へ移動します。",
      },
      {
        heading: "シフトを編集する",
        body: "右上の「編集」ボタンをタップして編集モードにします。変更したいセルをタップするとシフトパターン一覧が表示されます。選択すると即座に反映されます。",
      },
      {
        heading: "変更をLINEで通知する",
        body: "シフト変更後に「確定・通知する」ボタンをタップすると、変更対象のスタッフにLINEで変更前後の内容が通知されます。",
      },
      {
        heading: "シフト仮組（自動生成）",
        body: "「仮組」ボタンをタップします。各スタッフの稼働日数・希望休・連勤上限・優先シフトなどをもとに自動でシフト案を生成します。内容を確認して「このシフトを採用する」で確定します。",
      },
      {
        heading: "希望休の審査",
        body: "「希望休タブ」にスタッフからの申請一覧が表示されます。申請をタップして「承認」または「却下」を選択します。結果はLINEでスタッフに通知されます。",
      },
      {
        heading: "シフト募集枠の作成と審査",
        body: "「追加申請タブ」→「募集を追加」から日付・シフトパターン・募集人数を設定して公開します。スタッフが応募すると一覧に表示されるので、タップして承認・却下できます。",
      },
    ],
  },
  {
    id: "notices",
    title: "4. お知らせ管理",
    content: [
      {
        heading: "お知らせを投稿する",
        body: "「新しいお知らせ」ボタンをタップし、タイトルと本文を入力します。「ピン留め」をONにすると常に上部に表示されます。投稿するとLINEグループに通知が届きます（通知設定がONの場合）。",
      },
      {
        heading: "既読状況の確認",
        body: "各お知らせの「既読 x/y」表示をタップすると、既読・未読のスタッフ一覧が確認できます。",
      },
    ],
  },
  {
    id: "inquiries",
    title: "5. 問合せ管理",
    content: [
      {
        heading: "返信する",
        body: "ナビゲーションの「問合せ管理」から開きます。未回答の問い合わせが上部に表示されます。タップするとチャット形式のやり取りが表示されます。返信文を入力して「送信」するとスタッフにLINEで通知されます。",
      },
    ],
  },
  {
    id: "edit",
    title: "6. 勤怠修正",
    content: [
      {
        heading: "勤怠異常タブ：打刻に問題があるスタッフを確認",
        body: "打刻なし・退勤なし・時間外打刻など、異常のあるスタッフが一覧で表示されます。対象のスタッフをタップして「直接修正」から正しい時刻を入力・保存できます。",
      },
      {
        heading: "補正申請タブ：スタッフからの申請を審査",
        body: "スタッフが申請した打刻補正を審査します。フィルターで「審査中」に絞り込み、申請をタップして内容を確認します。「承認」または「却下」を選択し（却下はコメント入力）、「確定」をタップします。承認すると打刻時刻に自動反映されます。",
      },
    ],
  },
  {
    id: "records",
    title: "7. 実績出力",
    content: [
      {
        heading: "月次稼働実績の確認・出力",
        body: "ナビゲーションの「実績出力」から開きます。対象月を選択すると全スタッフの出勤日数・労働時間・日別時刻が一覧で表示されます。「Sheetsに出力」ボタンで連携しているGoogle スプレッドシートにデータを書き出せます。",
      },
    ],
  },
  {
    id: "settings",
    title: "8. 案件設定",
    content: [
      {
        heading: "メンバー管理",
        body: "「メンバーを追加」から社員IDを検索してロールを設定して追加します。スタッフ名をタップすると詳細設定（セクション・稼働日数・連勤上限・優先シフトなど）を編集できます。",
      },
      {
        heading: "シフトパターン管理",
        body: "案件で使うシフトの種類を設定します。パターン名・略称・開始〜終了時刻・必要人数（平日/休日）・セクション・対象ロールを設定します。仮組の精度を上げるために正確に設定してください。",
      },
      {
        heading: "希望休ルール",
        body: "「締切日」（毎月x日以降は翌月申請に切り替わる）と「月の上限日数」を設定して保存します。",
      },
      {
        heading: "通知設定",
        body: "欠勤・遅刻・出発報告・シフト変更・お知らせ・希望休申請などのLINE通知をON/OFFで切り替えられます。「出発報告機能」をOFFにするとスタッフのホーム画面から出発報告ボタンが非表示になります。",
      },
      {
        heading: "Google Sheets連携",
        body: "「Googleアカウントと連携する」からGoogleアカウントの承認を行い、スプレッドシートのURLを入力して保存します。「実績出力」画面からデータを書き出せるようになります。",
      },
    ],
  },
  {
    id: "staffs",
    title: "9. スタッフ管理（運営者のみ）",
    content: [
      {
        heading: "スタッフを追加する",
        body: "「スタッフを追加」から社員ID・氏名・初期パスワード・グローバルロールを入力して作成します。CSVファイルによる一括登録も可能です（既存IDはスキップ）。",
      },
      {
        heading: "パスワードをリセットする",
        body: "スタッフ詳細画面の「パスワードをリセット」から新しいパスワードを設定できます。",
      },
    ],
  },
  {
    id: "admin",
    title: "10. 案件管理・運用者管理（運営者のみ）",
    content: [
      {
        heading: "案件管理",
        body: "ナビゲーションの「案件管理」から全案件の一覧と詳細設定を管理します。「新しい案件」で案件を作成し、案件名をタップして詳細設定（メンバー・シフトパターンなど）を行います。",
      },
      {
        heading: "運用者管理",
        body: "admin・executive ロールを持つ運用者の一覧と管理を行います。「運用者を追加」から社員IDとロールを設定して追加します。",
      },
    ],
  },
];

export default async function ManualAdminPage() {
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

  if (!isAdmin) redirect("/help");

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-28 space-y-1">
        {/* ヘッダー */}
        <div className="mb-6">
          <a href="/help" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-3">
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            ヘルプに戻る
          </a>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">管理者向け操作説明書</h1>
          <p className="text-sm text-zinc-400 mt-1">シフト管理・勤怠修正・案件設定などの操作方法</p>
        </div>

        {/* 目次 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-5 shadow-sm mb-6">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">目次</p>
          <ul className="space-y-1.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* 各セクション */}
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.id} id={section.id} className="scroll-mt-4">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 px-1 mb-2">{section.title}</h2>
              <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                {section.content.map((item, i) => (
                  <div
                    key={item.heading}
                    className={`px-5 py-4 ${i < section.content.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
                  >
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">{item.heading}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-line">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="pt-4 text-center">
          <a href="/help" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← ヘルプに戻る
          </a>
        </div>
      </div>
    </main>
  );
}
