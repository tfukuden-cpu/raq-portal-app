/**
 * スタッフ向け操作説明書
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";

const SECTIONS = [
  {
    id: "login",
    title: "1. ログイン・ログアウト",
    content: [
      {
        heading: "ログイン",
        body: "ブラウザでポータルのURLを開き、社員ID（例：S001）とパスワードを入力して「ログイン」をタップします。複数の案件に所属している場合は案件選択画面が表示されます。",
      },
      {
        heading: "ホーム画面に追加（PWA）",
        body: "iOS: Safariで開いて「共有」→「ホーム画面に追加」\nAndroid: Chromeで開いて「メニュー」→「ホーム画面に追加」\nアプリのように使えるようになります。",
      },
      {
        heading: "ログアウト",
        body: "ナビゲーションの「My」をタップし、一番下の「ログアウト」ボタンをタップします。",
      },
    ],
  },
  {
    id: "home",
    title: "2. ホーム（ダッシュボード）",
    content: [
      {
        heading: "出発報告",
        body: "現場に向かう前に中央の青い丸ボタン「出発報告」をタップします。到着予定時間を選択して「報告する」をタップすると管理者にLINE通知が届きます。",
      },
      {
        heading: "出勤・退勤打刻",
        body: "打刻は現場の共用端末（タブレットなど）で行います。ホーム画面での操作は不要です。出勤打刻後は「勤務中」、退勤打刻後は「退勤済み」と表示されます。",
      },
      {
        heading: "欠勤報告",
        body: "画面下部の「欠勤報告」をタップします。①欠勤理由を入力 → ②明日出勤できるか選択 → ③明後日出勤できるか選択、の3ステップで送信します。管理者にLINEで通知が届きます。",
      },
      {
        heading: "遅刻報告",
        body: "画面下部の「遅刻報告」をタップします。①遅刻理由を入力 → ②到着予定時間を選択、の2ステップで送信します。",
      },
      {
        heading: "次回出勤の確認",
        body: "「次回出勤」欄に今後のシフトが表示されます。タップするとシフト詳細画面に移動できます。",
      },
    ],
  },
  {
    id: "shifts",
    title: "3. シフト",
    content: [
      {
        heading: "シフト確認タブ",
        body: "カレンダー形式で前後3ヶ月のシフトを確認できます。月の切り替えは上部の「‹」「›」ボタンで行います。日付をタップするとシフト詳細と変更履歴が表示されます。",
      },
      {
        heading: "希望休を申請する",
        body: "「希望休タブ」→「希望休を申請する」ボタンをタップします。カレンダーが表示されるので申請したい日付をタップして選択し、「申請する」で送信します。\n※締切日を過ぎると翌月申請に切り替わります。月の上限日数があります。",
      },
      {
        heading: "希望休を取り下げる",
        body: "希望休タブの申請一覧に表示されている項目をタップすると取り下げ確認が表示されます。「取り下げる」をタップで取り下げできます（締切前のみ）。",
      },
      {
        heading: "追加申請（シフト募集への応募）",
        body: "「追加申請タブ」に管理者が公開したシフト募集枠が表示されます。応募したい枠をタップして「応募する」をタップします。管理者が審査し、承認されるとシフトに反映されます。",
      },
    ],
  },
  {
    id: "record",
    title: "4. 勤怠実績",
    content: [
      {
        heading: "月次実績の確認",
        body: "ナビゲーションの「勤怠実績」から開きます。月の合計（出勤日数・総労働時間）と日別の出退勤時刻が確認できます。月の切り替えは上部の「‹」「›」ボタンで行います。",
      },
      {
        heading: "打刻時刻に誤りがある場合",
        body: "My → 打刻補正申請 から申請できます。管理者が承認すると勤怠実績に反映されます。",
      },
    ],
  },
  {
    id: "notices",
    title: "5. お知らせ",
    content: [
      {
        heading: "お知らせの確認",
        body: "ナビゲーションのベルアイコンから開きます。未読のお知らせがある場合、ベルアイコンに赤いバッジが表示されます。タイトルをタップすると本文が表示され、既読になります。",
      },
    ],
  },
  {
    id: "post",
    title: "6. 投稿",
    content: [
      {
        heading: "投稿を読む・コメントする",
        body: "ナビゲーションの「投稿」から開きます。一覧から投稿をタップすると本文とコメントが表示されます。コメント欄から返信できます。",
      },
      {
        heading: "投稿する",
        body: "右下の「＋」ボタンをタップ → タイトルと本文を入力 → 「投稿する」で送信します。",
      },
    ],
  },
  {
    id: "inquiries",
    title: "7. 問い合わせ",
    content: [
      {
        heading: "管理者へ問い合わせる",
        body: "ナビゲーションの「問い合わせ」から開きます。「新しい問い合わせ」ボタンをタップし、件名と本文を入力して送信します。管理者から返信が届くとLINEで通知されます。",
      },
    ],
  },
  {
    id: "my",
    title: "8. My（個人設定）",
    content: [
      {
        heading: "打刻補正申請",
        body: "My → 「打刻補正申請」をタップします。「新しい補正申請」→ 対象日を選択 → 正しい出退勤時刻を入力 → 理由を入力して「申請する」で送信します。管理者が承認すると勤怠実績に反映されます。",
      },
      {
        heading: "打刻画面",
        body: "My → 「打刻画面」をタップするとスマートフォンから直接打刻できます。通常は現場端末で打刻しますが、端末が使えない場合にご利用ください。",
      },
      {
        heading: "パスワード変更",
        body: "My → 「パスワード変更」をタップし、現在のパスワードと新しいパスワードを入力して「変更する」をタップします。",
      },
      {
        heading: "LINE連携",
        body: "My → LINE連携欄の「LINEアカウントを連携する」をタップします。LINEアプリが開くので「許可する」をタップすると完了です。連携すると各種通知をLINEで受け取れます。\n※事前に公式LINEアカウントを友達追加しておく必要があります。",
      },
    ],
  },
];

export default async function ManualStaffPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-28 space-y-1">
        {/* ヘッダー */}
        <div className="mb-6">
          <a href="/help" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-1.5">
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            ヘルプに戻る
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">スタッフ向け操作説明書</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">各メニューの操作方法をご確認ください</p>
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

