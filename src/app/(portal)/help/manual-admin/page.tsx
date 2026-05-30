/**
 * 管理者向け操作説明書
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";

const SECTIONS = [
  {
    id: "attendance",
    title: "1. 当日状況",
    content: [
      {
        heading: "サマリーカード",
        body:
          "画面上部に3つのカードが表示されます。\n" +
          "・出勤 x/y：出勤打刻済み人数 / 出勤予定総人数\n" +
          "・遅刻：遅刻報告があるスタッフの人数\n" +
          "・欠勤：欠勤報告があるスタッフの人数\n\n" +
          "未打刻スタッフがいる場合、ヘッダーに「未打刻 x名」と赤いバッジで表示されます。",
      },
      {
        heading: "ステータスの種類",
        body:
          "・未出勤：シフトがあるが出勤打刻なし\n" +
          "・勤務中：出勤打刻済み・退勤打刻なし\n" +
          "・退勤済：退勤打刻済み\n" +
          "・遅刻連絡：遅刻報告あり\n" +
          "・欠勤：欠勤報告あり",
      },
      {
        heading: "ステータスを手動変更する",
        body:
          "打刻システムが使えない場合などに使います。\n\n" +
          "1. スタッフのステータスバッジ「▾」をタップ\n" +
          "2. ポップアップメニューから新しいステータスを選択\n" +
          "3. 変更が即座に反映されます",
      },
      {
        heading: "催促する（遅刻中スタッフへのLINE送信）",
        body:
          "遅刻連絡中のスタッフに「催促する」ボタンが表示されます。\n\n" +
          "1. 「催促する」をタップして選択（複数人まとめて選択も可）\n" +
          "2. 画面下部バーの「x名にまとめて催促する →」をタップ\n" +
          "3. 送信内容と対象者を確認して「送信する」\n\n" +
          "LINEが未連携のスタッフには送信されません。",
      },
      {
        heading: "本日休みスタッフへの出勤依頼",
        body:
          "画面下部「本日休み（補填調整）」セクションの「依頼する」ボタンからLINEで出勤依頼を送れます。催促と同じ手順です（催促と依頼は同時選択できません）。",
      },
    ],
  },
  {
    id: "shifts-list",
    title: "2-1. シフト管理 — 日別一覧",
    content: [
      {
        heading: "日別一覧の使いかた",
        body:
          "ナビゲーションの「シフト管理」から開きます。デフォルト表示です。\n\n" +
          "・上部の「‹」「›」で前月・翌月に移動\n" +
          "・横スクロールの日付一覧から確認したい日を選択\n" +
          "・各スタッフのシフト名・開始〜終了時間・セクションが表示されます",
      },
    ],
  },
  {
    id: "shifts-grid",
    title: "2-2. シフト管理 — グリッド編集",
    content: [
      {
        heading: "グリッドの見かた",
        body:
          "「グリッド編集」タブをタップして切り替えます。\n\n" +
          "・縦軸（行）：スタッフ名\n" +
          "・横軸（列）：日付（左右スクロール）\n" +
          "・セル：シフトの略称（A、早、公休 など）\n\n" +
          "色の見かた：公休＝グレー、今日の列＝青い背景、人数不足の日＝オレンジ/赤",
      },
      {
        heading: "1日・1人を変更する",
        body:
          "1. 変更したいスタッフのセルをタップ\n" +
          "2. シフトパターン一覧がポップアップ表示される\n" +
          "3. 適用したいシフト名をタップ（「公休」「削除（空白）」も選択可）\n" +
          "4. 変更はグリッドに即座に反映されます",
      },
      {
        heading: "複数日をまとめて変更する",
        body:
          "1. スタッフ行の名前部分を長押し\n" +
          "2. 開始日〜終了日のセル範囲を選択\n" +
          "3. 適用するシフトパターンを選択\n" +
          "4. 選択した全日程に一括で適用されます",
      },
      {
        heading: "変更を確定・LINEで通知する",
        body:
          "編集後、グリッド上部に「確定・通知する」ボタンが表示されます。タップすると変更があったスタッフにLINEで変更前後の内容が通知されます。\n\n" +
          "※ 通知設定の「シフト変更通知」がONの場合のみLINEへ送信されます。",
      },
      {
        heading: "ドラフト保存",
        body:
          "編集途中で別のページに移動しても変更内容はドラフトとして自動保存されます。再びシフト管理を開くと編集モードが自動再開します。「破棄」ボタンでドラフトを消去できます。",
      },
    ],
  },
  {
    id: "holiday-review",
    title: "2-3. シフト管理 — 希望休の審査",
    content: [
      {
        heading: "希望休を審査する",
        body:
          "「希望休」タブをタップします。スタッフからの申請一覧が表示されます。\n\n" +
          "バッジの見かた：申請中（黄）・承認済（緑）・却下（赤）\n\n" +
          "審査手順：\n" +
          "1. 審査したい申請をタップ\n" +
          "2. スタッフ名・申請日・内容を確認\n" +
          "3. 「承認」または「却下」をタップ\n" +
          "4. 却下の場合は理由を入力\n" +
          "5. 「確定」をタップ → 結果がLINEでスタッフに通知されます\n\n" +
          "承認された希望休はシフト仮組時に自動で考慮されます。",
      },
    ],
  },
  {
    id: "shift-request",
    title: "2-4. シフト管理 — 追加申請（シフト募集）",
    content: [
      {
        heading: "募集枠を作成する",
        body:
          "「追加申請」タブ →「募集を追加」をタップします。\n\n" +
          "設定項目：対象日・シフトパターン・募集人数・備考（任意）\n\n" +
          "「作成する」をタップするとスタッフの追加申請タブに募集枠が表示されます。",
      },
      {
        heading: "応募を審査する",
        body:
          "1. 応募が届くと一覧に「申請中」バッジで表示される\n" +
          "2. 申請をタップして内容を確認\n" +
          "3. 「承認」または「却下」を選択\n" +
          "4. 承認するとスタッフのシフトに自動で反映されます\n" +
          "5. 審査結果がLINEでスタッフに通知されます",
      },
    ],
  },
  {
    id: "notices",
    title: "3. 周知管理",
    content: [
      {
        heading: "周知を投稿する",
        body:
          "ナビゲーションの「周知管理」から開きます。\n\n" +
          "1. 「新しいお知らせ」ボタンをタップ\n" +
          "2. タイトル（必須）と本文を入力\n" +
          "3. 「ピン留め」をONにすると常に一覧上部に固定表示される\n" +
          "4. 「投稿する」をタップ → 通知設定がONの場合LINEグループに通知が届きます",
      },
      {
        heading: "お知らせを編集・削除する",
        body:
          "投稿済みのお知らせをタップして詳細を開き、「編集」または「削除」をタップします。\n\n" +
          "削除したお知らせは復元できません。",
      },
      {
        heading: "既読状況を確認する",
        body: "お知らせ一覧の「既読 x/y」をタップすると、既読・未読のスタッフ名一覧が表示されます。",
      },
    ],
  },
  {
    id: "inquiries",
    title: "4. 問合せ管理",
    content: [
      {
        heading: "返信する",
        body:
          "ナビゲーションの「問合せ管理」から開きます。未読・未回答が上部に表示されます。\n\n" +
          "1. 返信したい問い合わせをタップ\n" +
          "2. チャット形式でやり取りが表示される\n" +
          "3. 下部の入力欄にメッセージを入力して「送信」\n" +
          "4. スタッフのLINEに通知が届きます",
      },
    ],
  },
  {
    id: "corrections-abnormal",
    title: "5-1. 勤怠修正 — 勤怠異常タブ",
    content: [
      {
        heading: "勤怠異常タブの概要",
        body:
          "ナビゲーションの「勤怠修正」→「勤怠異常」タブを開きます。\n\n" +
          "打刻に問題がある日を自動検出して一覧表示します。月の切り替えは「‹」「›」で行います。\n\n" +
          "異常の種類：\n" +
          "・出勤打刻なし：シフトがあるが出勤打刻がない\n" +
          "・退勤打刻なし：出勤打刻はあるが退勤打刻がない\n" +
          "・時間外打刻：シフト時間から大きくずれた時刻に打刻がある",
      },
      {
        heading: "直接修正する手順",
        body:
          "1. 修正したいスタッフ行をタップ\n" +
          "2. 「直接修正」をタップ\n" +
          "3. 正しい出勤時刻・退勤時刻を入力\n" +
          "4. 修正理由を入力（必須）\n" +
          "5. 「保存」をタップ → 勤怠実績に即座に反映されます",
      },
    ],
  },
  {
    id: "corrections-review",
    title: "5-2. 勤怠修正 — 補正申請タブ",
    content: [
      {
        heading: "補正申請を審査する",
        body:
          "スタッフが「My → 打刻補正申請」から提出した申請を審査します。\n\n" +
          "フィルター：審査中 / すべて / 承認 / 却下\n\n" +
          "審査手順：\n" +
          "1. 申請をタップ\n" +
          "2. 対象日・変更前後の打刻時刻・申請理由を確認\n" +
          "3. 「承認」または「却下」をタップ\n" +
          "4. 却下の場合はコメント（却下理由）を入力\n" +
          "5. 「確定」をタップ\n" +
          "6. 承認した場合、打刻時刻が自動修正されます\n" +
          "7. 審査結果がLINEでスタッフに通知されます",
      },
    ],
  },
  {
    id: "records-export",
    title: "6-1. 実績出力 — エクスポート",
    content: [
      {
        heading: "期間の設定",
        body:
          "ナビゲーションの「実績出力」から開きます。\n\n" +
          "画面上部の日付ピッカーで集計期間を指定します。クイックボタン（今月・先月・先週）も使えます。",
      },
      {
        heading: "Excelファイルをダウンロードする",
        body:
          "・「会社別」タブ：プルダウンで会社名を選択して絞り込み\n" +
          "・「個別」タブ：チェックボックスでスタッフを個別に選択\n" +
          "・検索欄：氏名・社員ID・口座番号で検索\n\n" +
          "「エクスポート（x名）」ボタンをタップすると .xlsx がダウンロードされます。\n\n" +
          "出力内容：スタッフ名・社員ID・口座番号・会社名・セクション・日別出勤退勤時刻・合計出勤日数・総労働時間",
      },
    ],
  },
  {
    id: "records-compliance",
    title: "6-2. 実績出力 — 順守率",
    content: [
      {
        heading: "順守率タブの見かた",
        body:
          "「順守率」タブで、スタッフごとの勤怠状況を確認できます。\n\n" +
          "表示項目：順守率（%）・遅刻日数・早退日数・欠勤日数\n\n" +
          "色の見かた：\n" +
          "・緑：95%以上（良好）\n" +
          "・黄：80〜94%（要注意）\n" +
          "・赤：79%以下（要確認）\n\n" +
          "上部ボタンで「順守率 / 氏名 / 遅刻 / 早退 / 欠勤」の並べ替えができます。",
      },
    ],
  },
  {
    id: "settings-basic",
    title: "7-1. 案件設定 — 基本設定",
    content: [
      {
        heading: "案件名の変更",
        body:
          "ナビゲーションの「案件設定」→「基本設定」タブを開きます。\n\n" +
          "「案件名」欄を編集して「保存」をタップします。",
      },
      {
        heading: "スプレッドシート連携",
        body:
          "Google SheetsのURLを入力して「保存」します。\n" +
          "「✦ 新規スプレッドシートを自動作成する」ボタンで案件専用スプレッドシートを自動生成することもできます。\n\n" +
          "連携済みの場合は「スプレッドシートを開く」リンクが表示されます。変更は「変更」ボタンから行えます。",
      },
    ],
  },
  {
    id: "settings-members",
    title: "7-2. 案件設定 — メンバー管理",
    content: [
      {
        heading: "1人追加する",
        body:
          "「+ メンバーを追加」をタップします。\n\n" +
          "苗字・名前・所属会社（必須）、ロール・セクション（任意）を入力して「作成して追加」をタップします。\n\n" +
          "社員IDは自動採番、初期パスワードは「1234」に設定されます。スタッフ本人に伝えてください。",
      },
      {
        heading: "CSVで一括登録する",
        body:
          "CSVフォーマット（1行目はヘッダー行）：\n" +
          "所属会社,氏名,役割,セクション\n" +
          "例）株式会社A,山田太郎,スタッフ,A班\n\n" +
          "役割欄：「スタッフ」または「管理者」\n\n" +
          "「CSVで一括登録」→「ファイルを選択」→ プレビュー確認 →「一括登録する」の順に操作します。",
      },
      {
        heading: "メンバー設定を編集する（基本情報）",
        body:
          "スタッフ名をタップすると詳細設定が展開されます。\n\n" +
          "・表示名：シフト表などに表示される名前\n" +
          "・所属会社：実績出力のグループ分けに使用\n" +
          "・ロール：スタッフ / 管理者\n" +
          "・セクション：入力して「+」またはEnterで追加、「×」で削除（複数設定可）\n" +
          "・口座番号：実績出力・当日状況での識別番号\n\n" +
          "編集後「保存」をタップします。",
      },
      {
        heading: "メンバー設定を編集する（シフト設定）",
        body:
          "「シフト設定 ▼」をタップして展開します。\n\n" +
          "・稼働日数：「月x日」または「週x日」を選択して数値を入力。仮組の基準になります\n" +
          "・連勤上限：連続勤務の最大日数（空白時はデフォルト5日）\n" +
          "・優先シフト：仮組時に優先して割り当てるシフトパターン名\n" +
          "・優先セクション：複数セクション所属時の優先セクション",
      },
      {
        heading: "離脱処理・削除",
        body:
          "【離脱処理】スタッフ行を開いて「離脱処理」→ 終了日を入力 →「離脱確定」をタップ。過去データは保持されます。\n\n" +
          "【削除】「削除」ボタンをタップすると案件からメンバーが外れます（スタッフアカウント自体は削除されません）。",
      },
    ],
  },
  {
    id: "settings-shift",
    title: "7-3. 案件設定 — シフトパターン・仮組",
    content: [
      {
        heading: "シフトパターンを追加する",
        body:
          "「案件設定」→「シフト」タブ →「パターンを追加」をタップします。\n\n" +
          "入力項目：\n" +
          "・パターン名：正式名称（例：Aシフト、早番）\n" +
          "・略称：グリッド表示用（例：A、早）1〜2文字推奨\n" +
          "・開始時刻 / 終了時刻（例：09:00 / 18:00）\n" +
          "・必要人数（平日）：仮組の充足判定に使用\n" +
          "・必要人数（休日）：空欄時は平日と同じ\n" +
          "・セクション：特定セクション専用の場合のみ設定\n" +
          "・対象ロール：all（全員）/ staff / admin\n\n" +
          "「保存」をタップするとGoogle Sheetsの「シフトパターン」シートにも自動反映されます。",
      },
      {
        heading: "パターンの並べ替え・編集・削除",
        body:
          "・並べ替え：ドラッグ&ドロップで順番変更（仮組の割り当て優先度に影響）\n" +
          "・編集・削除：パターン名をタップして編集フォームを開く",
      },
      {
        heading: "シフト仮組を実行する",
        body:
          "「シフト」タブ下部の「シフト仮組」セクションで操作します。\n\n" +
          "1. 対象月を選択\n" +
          "2. 「仮組を実行する」をタップ\n" +
          "3. 処理完了 → シフト管理のグリッド編集に反映される\n" +
          "4. 内容を確認して必要に応じて手動修正\n" +
          "5. 「確定・通知する」で確定\n\n" +
          "考慮される条件：稼働日数・承認済み希望休・連勤上限・優先シフト/セクション・前月末の連勤引き継ぎ・必要人数\n\n" +
          "仮組はあくまで「案」です。生成後に手動で自由に修正できます。",
      },
    ],
  },
  {
    id: "settings-holiday",
    title: "7-4. 案件設定 — 希望休ルール",
    content: [
      {
        heading: "希望休ルールを設定する",
        body:
          "「案件設定」→「希望休」タブを開きます。\n\n" +
          "・締切日：毎月x日を締切として、それ以降は翌月申請に切り替わります\n" +
          "例）「25」を設定すると毎月25日が当月締切\n\n" +
          "・月の上限日数：1人が1ヶ月に申請できる最大日数\n\n" +
          "「保存」をタップするとGoogle Sheetsの「希望休ルール」シートにも自動反映されます。",
      },
    ],
  },
  {
    id: "settings-notify",
    title: "7-5. 案件設定 — LINE通知",
    content: [
      {
        heading: "LINEグループIDを設定する",
        body:
          "「案件設定」→「LINE通知」タブを開きます。\n\n" +
          "「LINEグループID」欄にグループIDを入力して「保存」をタップします。「接続テスト」ボタンでテストメッセージを送って確認できます。",
      },
      {
        heading: "通知のON/OFF設定",
        body:
          "各イベントのトグルをON/OFFにするだけで即座に保存されます。\n\n" +
          "設定できる通知の種類：\n" +
          "・欠勤報告：スタッフが欠勤報告を送信したとき\n" +
          "・遅刻報告：スタッフが遅刻報告を送信したとき\n" +
          "・シフト変更通知：管理者がシフトを確定・通知したとき\n" +
          "・お知らせ投稿：管理者がお知らせを投稿したとき\n" +
          "・希望休申請：スタッフが希望休を申請したとき\n" +
          "・補正申請：スタッフが打刻補正申請を送信したとき\n" +
          "・問い合わせ：スタッフが新しい問い合わせを送信したとき",
      },
    ],
  },
  {
    id: "faq",
    title: "8. よくある質問",
    content: [
      {
        heading: "Q. スタッフの打刻時刻を修正したい",
        body: "A. 「勤怠修正」→「勤怠異常」タブ → 対象スタッフをタップ →「直接修正」から変更できます。",
      },
      {
        heading: "Q. 希望休の締切日や上限日数を変更したい",
        body: "A. 「案件設定」→「希望休」タブから変更できます。",
      },
      {
        heading: "Q. シフトをまとめて変更したい",
        body: "A. 「シフト管理」→「グリッド編集」タブで、スタッフ名を長押しすると複数日の一括変更ができます。",
      },
      {
        heading: "Q. 仮組が思ったとおりに組まれない",
        body: "A. メンバー設定で「稼働日数」「連勤上限」「優先シフト」を設定するほど精度が上がります。希望休の承認状況も確認してください。",
      },
      {
        heading: "Q. LINEグループへの通知が届かない",
        body: "A. 「案件設定」→「LINE通知」タブで通知がONになっているか確認してください。またLINEグループIDが正しく設定されているかも確認してください。",
      },
      {
        heading: "Q. CSVで登録したスタッフのIDがわからない",
        body: "A. 登録完了後の結果一覧に自動採番されたIDが表示されます。",
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
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-28 space-y-1">
        {/* ヘッダー */}
        <div className="mb-6">
          <a href="/help" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-1.5">
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            ヘルプに戻る
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">管理者向け操作説明書</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">シフト管理・勤怠修正・案件設定などの操作方法</p>
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
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">{item.heading}</p>
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

