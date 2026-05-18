# Raq 社内ポータル PWA — 引継ぎ資料

最終更新：2026-05-18（v19：P2-3 シフトグリッド編集モード実装）

---

## 1. プロジェクト概要

合同会社Raq の社内ポータルを **GAS（Google Apps Script）Webアプリ** から
**Next.js + Supabase 製の PWA** へ全面移行するプロジェクト。

| 項目 | 値 |
|---|---|
| 利用人数 | 約100人 |
| 案件数 | 10〜20案件（マルチテナント） |
| 兼務 | あり（1人が複数案件に所属） |
| LINE通知 | 案件ごとに別グループへ通知 |
| 配布方法 | PWA（ホーム画面追加・iOS/Android両対応） |
| 月額予算 | できるだけ安く（$0/月目標） |
| 開発体制 | 1人（バイブコーディング・JS/SQL未経験） |

---

## 2. 技術スタック

```
Next.js 15+ (App Router) + TypeScript
Tailwind CSS v4 (@import "tailwindcss", class-based dark mode)
Supabase (PostgreSQL + Auth + RLS)
Vercel（ホスティング・Cron Jobs）
```

### 認証方式：合成メール方式
ユーザーは **社員ID（例：S001）＋パスワード** でログイン。
内部で `s001@raq.internal` という合成メアドに変換して Supabase Auth へ。

### 案件コンテキスト
Cookie `rqp_project_id`（HTTPOnly・30日）に現在選択中の案件IDを保持。
- 1案件のみ → 自動セット
- 複数案件 → `/select-project` で選択

---

## 3. 現在の開発フェーズと方向性

### ⚠️ v15 大規模仕様変更（2026-05-16 決定）

以下の変更が決定した。実装はフェーズ別に進める（セクション13参照）。

| # | 変更内容 | フェーズ |
|---|---|---|
| 1 | 打刻メニューを廃止し、現場端末専用打刻ページを新設 | Phase 1 |
| 2 | 出発報告のON/OFFを案件設定で切り替え可能にする | Phase 1 |
| 3 | シフトパターンの必要枠数を日別設定（曜日ごと or 日付ごと）に変更 | Phase 2 |
| 4 | シフト仮組をアプリ内で実行（スプシ不要）・希望休・稼働設定を考慮 | Phase 2 |
| 5 | シフト編集モードの新設（ドラッグ移動・追加・削除・スワップ） | Phase 2 |
| 6 | まとめてシフト依頼をLINEで送信（複数日・変更依頼対応） | Phase 2 |
| 7 | スタッフカードタップ→メンバー設定へジャンプ・離脱処理 | Phase 3 |
| 8 | 案件ごとのスタッフ稼働設定・シフト設定（メンバー設定内） | Phase 3 |
| 9 | 仮組時に稼働設定・シフト設定を反映 | Phase 3 |

---

### 現状（v15時点）
GASからの移行を進めており、**コア機能はほぼ揃った状態**。
実際の案件・スタッフで使い始めている段階。

| カテゴリ | 状態 |
|---|---|
| 認証（社員ID＋パスワード＋LINE連携） | ✅ 完成 |
| 打刻・勤怠実績 | ✅ 完成 |
| シフト表示・希望休申請 | ✅ 完成 |
| 管理者シフト管理（セクションフィルタ含む） | ✅ 完成 |
| 周知・投稿 | ✅ 完成 |
| 問い合わせ（スタッフ↔管理者） | ✅ 完成 |
| LINE通知（イベント系） | ✅ 完成・動作確認済み |
| LINE通知（定時スケジュール） | 🔄 実装済み・本番テスト未 |
| LINEグループ連携 | ✅ 完成 |
| セクション管理（IDOM案件対応） | ✅ 完成（v11新設） |
| CSV一括登録（IDOM形式・重複スキップ） | ✅ 完成（v11更新） |
| **Google Sheets連携** | ✅ 完成（OAuth2認証、本番動作中） |
| 希望休ルール適用（バリデーション） | ✅ 完成 |
| 当日状況 ステータス手動変更 | ✅ 完成（v13新設） |
| 勤怠修正 カードUI・直接編集 | ✅ 完成（v13改善） |
| **打刻専用ページ（現場端末）** | ✅ 完成（v16） |
| **当月初回同意書確認（氏名入力・履歴閲覧）** | ✅ 完成（v16） |
| **出発報告ON/OFF設定** | ✅ 完成（v17） |
| **打刻時刻自動丸め（定時/遅刻/早退/残業）** | ✅ 完成（v18） |
| **シフト編集モード（ドラッグ）** | ✅ 完成（v19） |
| **シフト仮組（アプリ内）** | ⏳ Phase 2 |
| **スタッフ稼働設定・シフト設定** | ⏳ Phase 3 |
| アバターシステム | 🔄 設計済み・パーツ未実装（低優先） |

### 次に優先すべきこと（新しいセッションはここから）

**Phase 1 完了 ✅**（v16〜v18）
- 現場端末専用打刻ページ（同意書・プルダウン・承認者入力）
- 出発報告ON/OFF・ダッシュボードレイアウト分岐
- 打刻時刻自動丸め（定時→シフト時刻、遅刻→15分繰り上げ、早退/残業→15分切り下げ）

**Phase 2 進行中 → セクション13参照**
- ~~P2-3: シフト編集モード~~ ✅ v19完了
- **P2-2: シフト仮組（アプリ内生成）**（次の最優先）
- P2-4: まとめてシフト依頼LINE送信
- P2-1: シフトパターン必要枠数の曜日別設定（仮組の前提）

### 開発スタイルの注意点
- **バイブコーディング**：ユーザーはJS/SQL未経験。実装はAIが担当し、ユーザーは方向性を決める
- **Vercel自動デプロイ**：`git push` → GitHub → Vercel で自動反映
- **テストアカウント**：S001（admin）でP001・P002を確認。O002は運用者（executive）

---

## 4. 開発の再開方法

```powershell
cd C:\dev\raq-portal-app
npm run dev
# → http://localhost:3000
```

新しい Claude セッションで作業する場合の起動メッセージ：
```
合同会社Raqの社内ポータル（GAS→Next.js+Supabase PWA移行）を開発中です。
プロジェクトは C:\dev\raq-portal-app にあります。
HANDOVER.md を先に読んでください。
次にやることはセクション11に書いてあります。
```

---

## 4. データモデル

### マスタ系

```
projects（案件マスタ）
  id, name, spreadsheet_id, line_group_id,
  punch_rule, shift_format, start_date, is_active

staffs（社員マスタ）
  id, auth_user_id, name, display_name,
  global_role (staff/admin/executive),
  default_project_id, line_user_id,
  hire_date, is_active, must_change_password,
  avatar_color text,       ← 廃止予定（avatar_config に移行中）
  avatar_config jsonb      ← ★v9新設（要SQL実行：セクション9参照）

project_members（兼務対応）
  staff_id, project_id, role (staff/project_admin),
  section text,            ← ★v11新設（IDOM案件のセクション管理）
  start_date, end_date, is_main
```

### 機能データ

```
punch_logs（打刻ログ）
  project_id, staff_id,
  punch_type (clock_in/clock_out/break_start/break_end),
  recorded_at (timestamptz), note, approver_name

shifts（シフト）
  project_id, staff_id, shift_date (text YYYY-MM-DD),
  shift_name, shift_start (text HH:MM), shift_end (text HH:MM),
  status, note
  unique(project_id, staff_id, shift_date)

shift_patterns（シフトパターン定義）
  project_id, name, short_name, start_time, end_time,
  required_count (int), sort_order

shift_requests（シフト追加申請）
  project_id, staff_id, request_date, preferred_start,
  preferred_end, reason, status (pending/approved/rejected)

departure_reports（出発報告）
  project_id, staff_id, reported_at, eta_minutes

absence_reports（欠勤報告）
  project_id, staff_id, absence_date (text), reason,
  next_day_available, day_after_available, status

late_reports（遅刻報告）
  project_id, staff_id, late_date (text), reason,
  expected_arrival, status

notices（周知事項）
  project_id, title, body, is_pinned, posted_by,
  created_at, updated_at

notice_reads（既読管理）
  notice_id, staff_id, read_at

holiday_requests（希望休申請）
  project_id, staff_id, request_date,
  status (pending/approved/rejected/cancelled),
  note, reviewed_by, reviewed_at

holiday_rules（希望休ルール）
  project_id, rule_type, value (int), sort_order
  rule_type: deadline_day / monthly_limit_per_person /
             daily_limit_count / consecutive_limit

punch_corrections（勤怠補正申請）
  project_id, staff_id, target_date,
  corrected_in, corrected_out, reason, status,
  reviewed_by, reviewed_at

posts（投稿・スタッフ掲示板）
  project_id, staff_id, body, created_at

project_settings（案件ごとの設定）
  project_id,
  sheet_url,
  notification_settings jsonb  ← ★v9新設（要SQL実行：セクション9参照）

shift_change_logs（シフト変更ログ）
  project_id, staff_id, shift_date, action,
  before_data jsonb, after_data jsonb, changed_by, changed_at

consent_records（同意書確認履歴）← ★v16新設
  staff_id, project_id,
  consent_month (text YYYY-MM),
  confirmed_name (text),   ← 同意時に本人が入力した氏名
  signed_at (timestamptz)
  unique(staff_id, project_id, consent_month)
  ※ 現場端末打刻ページ（/punch/[projectId]）で当月初回打刻時に記録
  ※ スタッフ管理ページ（/admin/staffs）の「同意書」ボタンから閲覧可能
```

---

## 5. ドキュメント

| ファイル | 内容 |
|---|---|
| `HANDOVER.md` | 開発引継ぎ資料（本書） |
| `docs/管理者マニュアル.txt` | 案件管理者向け操作説明書（全8機能・よくある操作フロー含む） |

---

## 6. プロジェクト構成

```
src/
├── app/
│   ├── (portal)/
│   │   ├── layout.tsx              ← AppNav + DevBanner + ロール別メニュー
│   │   ├── dashboard/              ← ホーム（出発報告・欠勤・遅刻・打刻状態）
│   │   ├── punch/                  ← フルスクリーン打刻UI
│   │   ├── shifts/
│   │   │   ├── page.tsx            ← シフト/希望休/追加申請 タブ
│   │   │   ├── manage/             ← 管理者シフト管理（日付タブ・充足バッジ）
│   │   │   └── request/            ← シフト追加申請
│   │   ├── record/                 ← 勤怠実績（月次）
│   │   ├── post/                   ← 投稿（社内掲示板）
│   │   ├── my/                     ← スタッフ マイページ
│   │   ├── notices/                ← 周知事項
│   │   ├── holidays/               ← 希望休申請
│   │   ├── corrections/            ← 勤怠補正申請
│   │   ├── attendance/             ← 当日状況（管理者）
│   │   └── admin/
│   │       ├── page.tsx            ← 案件一覧
│   │       ├── my/                 ← 運用者/管理者 マイページ ★v9新設
│   │       │   ├── page.tsx
│   │       │   ├── AvatarEditor.tsx  ← アバターエディター（UI）
│   │       │   ├── AvatarSvg.tsx     ← SVGアバター描画（パーツ未実装）
│   │       │   ├── AvatarPicker.tsx  ← 旧カラーピッカー（廃止予定）
│   │       │   ├── avatar-types.ts   ← 型・定数定義
│   │       │   └── actions.ts
│   │       ├── staffs/             ← スタッフ管理
│   │       ├── operators/          ← 運用者管理
│   │       ├── notices/            ← 周知一覧（全社）
│   │       ├── posts/              ← 投稿一覧（全社）
│   │       └── [projectId]/
│   │           ├── page.tsx
│   │           └── settings/
│   │               ├── page.tsx
│   │               ├── SettingsClient.tsx  ← タブUI（basic/members/shift/holiday/notify/danger）
│   │               ├── actions.ts
│   │               └── notify-config.ts    ← 通知設定の型・定数・デフォルト値
│   │
│   ├── api/
│   │   ├── auth/line/              ← LINE Login OAuth
│   │   ├── cron/notify/route.ts   ← スケジュール通知 cron ★v9新設
│   │   └── set-project/route.ts
│   │
│   └── (その他: login, change-password, select-project, etc.)
│
├── components/
│   ├── AppNav.tsx
│   ├── DevBanner.tsx
│   └── icons.tsx
│
└── lib/
    ├── notify.ts          ← LINE通知共通ライブラリ ★v9新設
    ├── line.ts            ← pushLine() / multicastLine()
    ├── gsheets.ts         ← Google Sheets 連携
    ├── datetime.ts        ← JST日時ユーティリティ
    ├── attendance.ts      ← 勤怠計算
    ├── project-context.ts ← 案件ID取得
    └── supabase/ (server / client / middleware / admin)
```

---

## 7. LINE通知システム（v9実装済み）

### アーキテクチャ

```
イベント通知（即時）
  各Server Action → sendEventNotify(projectId, type, vars) → LINE送信

スケジュール通知（定時）
  Vercel Cron（5分ごと） → /api/cron/notify → LINE送信
```

### 通知種別

| キー | 種類 | 内容 | デフォルト宛先 |
|---|---|---|---|
| `absence` | イベント | 欠勤申請 | 管理者グループ |
| `absence_confirm` | イベント | 欠勤受付完了 | 申請スタッフ本人 |
| `tardiness` | イベント | 遅刻申請 | 管理者グループ |
| `clock` | イベント | 出退勤打刻 | 管理者グループ |
| `announcement` | イベント | お知らせ投稿 | 全スタッフ |
| `inquiry` | イベント | 問い合わせ受信 ★v10新設 | 管理者グループ |
| `inquiry_reply` | イベント | 問い合わせ返信 ★v10新設 | スタッフ本人 |
| `shift_start_remind` | 定時 | 出勤N分前リマインド | スタッフ本人 |
| `shift_end_remind` | 定時 | 退勤打刻忘れ確認 | スタッフ本人 |
| `rest_day_remind` | 定時 | 翌日出勤アナウンス | スタッフ本人 |
| `daily_summary` | 定時 | 当日出勤状況サマリー | 管理者グループ |
| `holiday_reminder` | 定時 | 希望休締切リマインド | 未実装 |

### 設定
案件設定 → LINE通知タブ でON/OFF・宛先・タイミング・メッセージ文を変更できる。
設定は `project_settings.notification_settings` (jsonb) に保存。

### メッセージ変数

| 変数 | 内容 |
|---|---|
| `{名前}` | スタッフ表示名 |
| `{日付}` | 対象日（YYYY-MM-DD） |
| `{シフト}` | シフト名（時刻）例: Aシフト（09:00〜18:00） |
| `{欠勤理由}` | 欠勤理由テキスト |
| `{翌日出勤可否}` | 「翌日：出勤可」or「翌日：欠勤」 |
| `{翌々日出勤可否}` | 同上（翌々日） |
| `{遅刻理由}` | 遅刻理由テキスト |
| `{到着目安時間}` | 到着予定時刻 |
| `{時刻}` | 打刻時刻（HH:MM） |
| `{種別}` | 出勤 / 退勤 |
| `{タイトル}` | お知らせタイトル |
| `{本文}` | お知らせ本文 |
| `{次回出勤日}` | 次回シフトの日付 |
| `{翌日}` | 翌日の日付 |
| `{出勤数}` | 当日出勤予定人数 |
| `{一覧}` | スタッフ別出退勤一覧 |

### Cronの認証
`Authorization: Bearer <CRON_SECRET>` ヘッダーで保護。
`.env.local` に `CRON_SECRET=（ランダムな文字列）` を追加する。

---

## 8. アバターシステム（v9設計・実装途中）

### 概要
「トモダチコレクション」スタイルのSVGアバター。
案件管理者・運用者が `/admin/my` で自分のアバターを設定できる。

### データ型（`avatar-types.ts`）

```typescript
type AvatarConfig = {
  bg:         string;  // 背景色キー（"sky"/"mint"/"rose" など8種）
  skin:       number;  // 肌色 0-4
  hair_style: number;  // 髪型 0-4
  hair_color: string;  // 髪色キー（12種）
  eyes:       number;  // 目 0-4
  mouth:      number;  // 口 0-3
  cheeks:     boolean; // ほっぺ
};
```

### SVG仕様（`AvatarSvg.tsx` へのパーツ追加が必要）

**キャンバス**: `viewBox="0 0 100 100"`

| パーツ | 位置・サイズ |
|---|---|
| 背景円 | cx=50 cy=50 r=50 |
| 顔の楕円 | cx=50 cy=53 rx=27 ry=29（上端y≈24、下端y≈82） |
| 耳（左） | cx=22 cy=54 rx=5 ry=6 |
| 耳（右） | cx=78 cy=54 rx=5 ry=6 |
| 眉毛 | y≈37〜40 付近 |
| 目 | 左:cx=38 cy=48 / 右:cx=62 cy=48 |
| 鼻 | x=47〜53 y≈59〜63（サブトル） |
| 口 | 中心x=50 y≈65〜68 |
| ほっぺ | 左:cx=32 cy=64 / 右:cx=68 cy=64 rx=8 ry=4.5 |

**レンダリング順（上が奥）:**
1. 背景円
2. HairBack（後ろ髪）
3. 耳
4. 顔楕円
5. 眉毛
6. 目
7. 鼻
8. 口
9. ほっぺ（`config.cheeks===true` のとき）
10. HairFront（前髪）

**髪型スタイル（0〜4）:**
- 0: ショート — 頭頂部キャップのみ、耳より上で止まる
- 1: ミディアム — キャップ＋耳を覆うサイドウィング（y≈54）
- 2: ロング — キャップ＋長いサイドストランド（y≈72）＋後ろ髪（y≈97）
- 3: ポニーテール — 短い前髪＋右側に束
- 4: スパイキー — キャップベース＋4本のトゲ

**目スタイル（0〜4）:**
- 0: ノーマル — 縦長楕円 rx=5 ry=5.5、白ハイライト
- 1: ハッピー — ∪型ストローク（M x,50 Q cx,43 x2,50）
- 2: ビッグ — 大楕円 rx=7 ry=7.5、ハイライト2つ
- 3: ウィンク — 左=ノーマル、右=∩型ストローク
- 4: スター — 5角星ポリゴン（金色 #FFD700）

**口スタイル（0〜3）:**
- 0: スマイル — `M 40,65 Q 50,73 60,65` ストローク
- 1: ビッグスマイル — 広い弧＋赤い口内＋白い歯
- 2: ニュートラル — 水平線 y=68
- 3: びっくり — 二重楕円 cx=50 cy=68

### ⚠️ AvatarSvg.tsx の現状
`AvatarSvg.tsx` はファイルが存在するが、**パーツのSVGパスはユーザーが手書きする予定**。
現在はコンポーネントの骨格と型のみ。`HairBack`/`HairFront`/`Eyes`/`Mouth` 関数が定義されているが、
パスの中身は未完成の可能性がある。新しいAgentは**触らずにそのまま残すこと**。

### 保存アクション
`updateAvatarConfigAction(fd: FormData)` が `admin/my/actions.ts` に実装済み。
`staffs.avatar_config` (jsonb) に保存する。

---

## 9. Google Sheets 連携

### 操作場所
**`/admin/[projectId]`（案件詳細設定画面）のスプシタブ**から行う。
`/shifts/manage` のスプシタブは v8 で削除済み。

### シフト作業フロー
```
① 案件設定 → スプシを自動作成 or URL手動入力
   └─ 保存と同時にメンバーシート自動同期

② 案件設定 →「シフト表生成」
   └─ 年月指定 ＋「仮組あり」オプション（draftAssign=true）
   └─ holiday_requests テーブルから希望休を自動反映
   └─ シフトパターン・メンバー一覧付きのテンプレートをスプシに生成

③ スプシで手入力（シフト名をマスに入力）
   └─ 不足数はスプシの数式が自動計算

④ シフト管理（/shifts/manage）→「スプシから読込」
   └─ importFromSheetAction → shifts テーブルへ反映

⑤ アプリ→スプシへの書き戻しはしない（スプシが正）
```

### 自動同期タイミング
| 操作 | 同期先シート |
|---|---|
| メンバー追加/削除/役割変更 | メンバーシート |
| シフトパターン保存 | シフトパターンシート |
| 希望休ルール保存 | 希望休ルールシート |
| シフト表生成 | 希望休シート ＋ シフト表シート |

### スプシ構成（9シート固定）
| シート名 | 用途 |
|---|---|
| 設定 | 通知ON/OFF等の設定値 |
| メンバー | 社員ID・表示名・本名・役割・会社名 |
| 希望休 | 希望休申請データ |
| シフト表 | 月次入力用テンプレート（target_role で admin/staff 分割） |
| シフト | シフト詳細データ |
| 打刻ログ | 打刻履歴 |
| 日別勤怠 | 日別勤怠実績 |
| 月次集計 | 月次集計 |
| シフト変更ログ | シフト変更履歴 |

### 認証方式（3段階フォールバック・v11）
1. `GOOGLE_SERVICE_ACCOUNT_JSON` （JSON丸ごと）
2. `GOOGLE_CLIENT_EMAIL` ＋ `GOOGLE_PRIVATE_KEY` （個別環境変数）
3. `GOOGLE_CLIENT_ID` ＋ `GOOGLE_CLIENT_SECRET` ＋ `GOOGLE_REFRESH_TOKEN` （OAuth2）

### 関連ファイル
- `lib/gsheets.ts` — シート操作全般（`generateShiftTableSheet` / `syncMembersSheet` 等）
- `admin/[projectId]/settings/actions.ts` — `generateShiftTableAction` / `createSpreadsheetAction` 等
- `shifts/actions.ts` — `importFromSheetAction`（スプシ→DBへの読込）
- `shifts/manage/SheetsSync.tsx` — 現在未使用（孤立ファイル）。必要なら管理画面に再統合可

---

## 10. UI デザイン方針

- **角丸**: `rounded-2xl`（カード・大要素）
- **配色**: `zinc-` グレースケール ＋ `blue-600` アクセント
- **モバイルファースト**: `h-dvh` + `flex flex-col`
- **ダークモード**: `dark:` クラスを必ずペアで指定
- **tabular-nums**: 時刻・件数に必ず使用
- **絵文字禁止**: SVGアイコン（`src/components/icons.tsx`）を使う
- **スクロールなし**: `flex-1 min-h-0 overflow-y-auto`
- Tailwind v4: `@import "tailwindcss"` 形式（`tailwind.config.js` 不使用）

---

## 11. SQL実行状況

### ✅ 実行済み
- `project_settings.notification_settings` jsonb カラム追加
- `project_settings.line_group_id` text カラム追加（LINEグループ連携）
- `inquiries` テーブル作成（RLS設定済み）
- `staffs.avatar_config` jsonb カラム追加（要確認）

### ⏳ 未実行（要実行）

#### ① shift_patterns テーブル更新
```sql
alter table public.shift_patterns
  add column if not exists short_name text not null default '',
  add column if not exists required_count int;
```

#### ② holiday_rules テーブル新規作成
```sql
create table if not exists public.holiday_rules (
  id         uuid        primary key default gen_random_uuid(),
  project_id text        not null references public.projects(id) on delete cascade,
  rule_type  text        not null,
  value      int         not null,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);
alter table public.holiday_rules enable row level security;
create policy "select_member_holiday_rules" on public.holiday_rules
  for select to authenticated
  using (exists (select 1 from public.project_members pm
    where pm.staff_id = public.current_staff_id()
      and pm.project_id = holiday_rules.project_id));
create policy "admin_all_holiday_rules" on public.holiday_rules
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));
```

---

## 12. 環境変数（.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...        # 絶対公開禁止・サーバーのみ
NEXT_PUBLIC_BASE_URL=http://localhost:3000
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
CRON_SECRET=...                            # ★v9新設：openssl rand -hex 32 等で生成

# Google Sheets連携（以下いずれかの方式で設定）
# 方式A: OAuth2
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
# 方式B: サービスアカウントJSON
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# 方式C: 個別環境変数
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

---

## 13. 実装ロードマップ（v15〜）

> 凡例：✅ 完了 / 🔄 進行中 / ⏳ 未着手

---

### 🔴 Phase 1 ─ 打刻・出発報告の基盤変更

#### P1-1. 現場端末専用打刻ページ新設

**仕様**
- URL：`/punch/[projectId]`（案件ごとに別URL・認証不要）
- 操作フロー：スタッフ名選択 → シフト選択 → 打刻種別選択 → 打刻実行
- 打刻種別：定時出勤 / 遅刻出勤 / 早退退勤 / 定時退勤
- 認証不要のため、RLSをバイパスする adminClient を使用
- シンプルなフルスクリーンUI（タブレット想定）

**影響ファイル**
- 新規：`src/app/punch/[projectId]/page.tsx`
- 新規：`src/app/punch/[projectId]/actions.ts`
- 削除：スタッフ・管理者メニューの `/punch` エントリ（layout.tsx の STAFF_ITEMS から削除）
- 現在の `/punch/page.tsx` は残すか要検討（スタッフ打刻の代替があるかどうか）

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P1-1a | `/punch/[projectId]` ページ作成（UI・打刻action） | ✅ |
| P1-1b | スタッフ・管理者メニューから打刻メニューを削除 | ✅ |
| P1-1c | 管理者マニュアル更新 | ⏳ |

---

#### P1-2. 出発報告ON/OFF設定

**仕様**
- `project_settings` に `enable_departure_report boolean default true` カラム追加
- 案件設定 > 基本設定タブ にON/OFFトグルを追加
- OFFの案件では：
  - スタッフの出発報告フォームを非表示
  - 当日状況の「出発済」ステータス・「催促する」ボタンを非表示
  - ナビから「出発報告」メニューを非表示（該当する場合）

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P1-2a | DBカラム追加（enable_departure_report） | ✅ |
| P1-2b | 案件設定UIにトグル追加 | ✅ |
| P1-2c | 当日状況ページに設定を反映 | ✅ |
| P1-2d | スタッフ側の出発報告フォームに設定を反映 | ✅ |

---

### 🟠 Phase 2 ─ シフト管理の抜本刷新

#### P2-1. シフトパターン必要枠数の日別設定

**仕様**
- 現在：`shift_patterns` に `required_count int`（全日一律）
- 変更後：曜日ごと（月〜日）または「一律設定」で入力可能
- DB変更：`shift_patterns` に `required_counts jsonb` カラムを追加
  ```json
  { "default": 3, "mon": 3, "tue": 3, "wed": 2, "thu": 3, "fri": 3, "sat": 2, "sun": 2 }
  ```
- 案件設定 > シフトタブの入力UIを更新（一律入力 ↔ 曜日別入力を切り替えられるようにする）

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-1a | DBカラム追加（required_counts jsonb） | ⏳ |
| P2-1b | 案件設定シフトタブのUI更新 | ⏳ |

---

#### P2-2. シフト仮組（アプリ内生成）

**仕様**
- シフト管理ページに「仮組を生成」ボタンを追加
- 対象月・対象シフトパターンを選択して実行
- 生成ロジック（優先順）：
  1. 希望休（holiday_requests）が承認済みの日は割り当てない
  2. 各スタッフの稼働設定（月/週の稼働日数上限）を超えない
  3. シフト設定（基本パターン・連勤上限）を考慮
  4. 他案件のシフトも考慮して連勤日数を計算
  5. 必要枠数（曜日別）を満たすようにスタッフを割り当て
- 生成後は「編集モード」に自動移行（確定するまでDBには保存しない）
- 確定ボタンで `shifts` テーブルに一括 upsert

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-2a | 仮組生成ロジック実装（Server Action） | ⏳ |
| P2-2b | 仮組プレビューUI（編集モードと統合） | ⏳ |
| P2-2c | 確定処理（shifts テーブルへの一括保存） | ⏳ |

---

#### P2-3. シフト編集モード（ドラッグ対応）

**仕様**
- シフト管理ページに「編集モード」ボタンを追加
- 編集モード中：
  - スタッフのシフトセルをドラッグして別の日付に移動
  - スタッフ同士のセルをドラッグして入れ替え（スワップ）
  - セルをタップして「変更」「削除」
  - 空きセルをタップして「追加」
  - PC・スマホ両対応（mouse events + touch events）
- 編集内容はローカル state で保持
- 「確定」ボタンでDBに一括保存、「キャンセル」で破棄

**技術方針**
- ライブラリ：`@dnd-kit/core`（軽量・スマホ対応）を使用
- 既存の ShiftDayList.tsx を編集モード対応に拡張

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-3a | `@dnd-kit/core` インストール | ⏳ |
| P2-3b | 編集モードUIの実装 | ⏳ |
| P2-3c | ドラッグによる日付移動・スワップ実装 | ⏳ |
| P2-3d | 一括確定・キャンセル処理 | ⏳ |

---

#### P2-4. まとめてシフト依頼（LINE送信強化）

**仕様**
- 現在：「依頼する」= 「出勤可能ですか？」1通
- 変更後：日付・内容を複数指定してまとめて送信
  - 「追加出勤できますか？」（複数日指定）
  - 「○日→△日に変更できますか？」（変更依頼）
  - 「○日と△日を追加できますか？」（複数日追加）
- 送信前に依頼内容をプレビュー確認

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-4a | 依頼モーダルの拡張（日付・種別の複数選択） | ⏳ |
| P2-4b | まとめて送信 Server Action の更新 | ⏳ |

---

### 🟡 Phase 3 ─ スタッフ設定の充実

#### P3-1. 案件ごとのスタッフ稼働設定・シフト設定

**仕様**
- 案件設定 > メンバータブのスタッフ詳細編集に以下を追加
- `project_members` テーブルに設定カラムを追加：
  ```
  work_days_per_month   int       -- 月稼働日数上限（null = 無制限）
  work_days_per_week    int       -- 週稼働日数上限（null = 無制限）
  preferred_shift       text      -- 基本配置するシフトパターン名
  max_consecutive_days  int       -- 連勤上限日数（default: 5）
  ```
- 仮組生成時にこれらを参照する

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P3-1a | DBカラム追加（project_members） | ⏳ |
| P3-1b | メンバー設定UIに入力欄追加 | ⏳ |
| P3-1c | 仮組ロジックに稼働設定を組み込み | ⏳ |

---

#### P3-2. スタッフカードから設定・離脱処理

**仕様**
- シフト管理のスタッフ名をタップ → 「設定」「離脱処理」のメニュー表示
- 「設定」→ 案件設定 > メンバーの該当スタッフ設定へジャンプ
- 「離脱処理」：
  - 離脱日を入力するモーダルを表示
  - 確定すると離脱日以降の shifts を削除
  - project_members.end_date に離脱日を設定

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P3-2a | スタッフカードのタップメニュー追加 | ⏳ |
| P3-2b | 離脱処理モーダル・Server Action実装 | ⏳ |
| P3-2c | 離脱日以降シフト削除 + end_date 設定 | ⏳ |

---

### 🟢 継続タスク（既存）

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| X-1 | スケジュール通知の動作確認 | ⏳ | `curl -H "Authorization: Bearer <CRON_SECRET>" /api/cron/notify` |
| X-2 | 希望休ルールのバリデーション（申請時チェック） | ⏳ | deadline_day / monthly_limit 等 |
| X-3 | 本番投入（GASと並行運用） | ⏳ | 社員100名移行 |
| X-4 | SQL未実行分を Supabase に適用 | ⏳ | shift_patterns.short_name, holiday_rules テーブル |

---

## 14. テストアカウント

| 項目 | 値 |
|---|---|
| メール | `s001@raq.internal` |
| 社員ID | `S001` |
| グローバルロール | `admin` |
| 案件 | P001（管理者）/ P002（スタッフ） |

---

## 15. ホスティングとCron

`vercel.json` が設置済み。Vercelにデプロイすると自動で5分ごとに
`/api/cron/notify` が呼ばれ、スケジュール通知が送信される。

ローカルでのcronテスト：
```powershell
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3000/api/cron/notify
```

---

## 16. 既知の問題・注意点

### Next.js の searchParams は Promise
```tsx
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams; // 必ず await する
```

### "use server" ファイルから非async関数をexportできない
→ 型・定数・ヘルパー関数は別ファイル（例: `notify-config.ts`）に置く。

### adminClient が必要な場面
運用者が自分の所属していない案件のデータを扱う場合は `createAdminClient()` を使う。
`createClient()`（RLS適用）では他案件のデータが取れない。

### Tailwind v4
`tailwind.config.js` は不使用。`@import "tailwindcss"` で設定。

---

## 17. 改訂履歴

| 日付 | バージョン | 内容 |
|---|---|---|
| 2026-04-29 | v1〜v4 | Phase 0〜8 実装 |
| 2026-05-05 | v5 | LINE Login・案件CRUD・GSheets連携・投稿・視点切替 |
| 2026-05-06 | v6 | スプシ連携大改訂、シフト表テンプレート |
| 2026-05-06 | v7 | 希望休ルール柔軟化、holiday_rules テーブル |
| 2026-05-09 | v8 | シフト管理UI全面刷新、adminClient化、ops メニュー追加 |
| 2026-05-10 | v9 | LINE通知システム実装（notify.ts・cron route・各action更新）、アバターシステム設計、運用者マイページ(/admin/my)、vercel.json |
| 2026-05-11 | v10 | 問い合わせシステム新設（/inquiries・/inquiries/manage）、LINE Login magic link修正（/auth/confirm）、LINEグループ連携（project_settings.line_group_id）、inquiry/inquiry_reply通知種別追加、通知カードアコーディオンUI、notify.ts個別try-catch、ops向け問い合わせ管理修正 |
| 2026-05-13 | v11 | セクション機能（project_members.section）、CSVフォーマットをIDOM形式に変更（所属会社,氏名,役割,セクション）、CSV重複スキップ、姓名スペース削除、LINE連携状況の表示、初期PW変更（1234）、問い合わせ返信バグ修正、シフト管理セクションフィルタ、シフト生成エラーハンドリング改善、Google Sheets認証を3段階フォールバック＋OAuth2個別環境変数対応 |
| 2026-05-09 | v12 | シフト管理UI全面刷新（ShiftDayList：日付タブ・充足バッジ・未登録折りたたみ・メンバー外シフト表示・router.refresh）、adminClient化（RLSバイパス）、/api/set-project Route Handler新設、Google Sheets連携セクション追記（セクション8）、運用者メニューへの管理者メニュー追加を残タスクに追記 |
| 2026-05-16 | v13 | UIブラッシュアップ多数：モバイルボトムナビをiOSセグメントコントロール風に刷新・`<a>`→`<Link>`でプリフェッチ有効化・loading.tsxを主要ページに追加・DevBannerをモバイルで非表示・シフト管理タブを2行レイアウトに改善。当日状況：未打刻バッジ追加・勤怠ステータスをバッジタップで手動変更可能に（changeAttendanceStatusAction実装）。勤怠修正：カード形式UIに刷新・異常打刻のみ表示＋修正ボタンで即時編集。補正申請承認時のpunch_logs自動上書き・LINE結果通知（correction_result通知種別追加）。 |
| 2026-05-16 | v14 | 管理者マニュアル作成（docs/管理者マニュアル.txt）。全8機能の詳細手順・よくある操作フロー・権限説明を記載。HANDOVER.mdにdocsセクション追加。 |
| 2026-05-16 | v15 | 大規模仕様変更決定・実装ロードマップ策定。Phase1（打刻専用ページ・出発報告ON/OFF）、Phase2（シフト仮組アプリ内生成・編集モード・ドラッグ操作・まとめて依頼）、Phase3（スタッフ稼働設定・離脱処理）の3フェーズで実装予定。 |
| 2026-05-18 | v16 | Phase 1 P1-1完了：現場端末専用打刻ページ（/punch/[projectId]）新設。認証不要・adminClient。スタッフ選択プルダウン（未打刻者のみ）、SV承認者入力（遅刻/早退）、当月初回同意書確認（7条・氏名入力）、同意書履歴をスタッフ管理ページに追加。ダッシュボードから打刻ボタン廃止。 |
| 2026-05-18 | v17 | Phase 1 P1-2完了：出発報告ON/OFF設定（案件設定 > 基本設定タブのトグル）。OFFの場合ダッシュボードレイアウトをAppleスタイルに刷新（現在時刻ヒーロー・シフトカード・次回出勤カード）。 |
| 2026-05-18 | v18 | Phase 1 追加実装：打刻時刻の自動丸め処理。定時→シフト開始/終了時刻、遅刻→15分繰り上げ、早退/残業→15分切り下げ。残業退勤ボタン追加。種別選択画面に記録予定時刻のヒント表示。 |
| 2026-05-18 | v19 | P2-3完了：シフトグリッド編集モード。`@dnd-kit/core` 導入。ShiftEditGrid（月次横スクロールグリッド・CSS Grid・sticky列/行・ドラッグスワップ・タップモーダル・差分Map・一括保存）。bulkUpsertShiftsAction追加。ShiftManageClientに「グリッド編集」ボタンを追加。 |
