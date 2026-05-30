# Raq Portal アプリ 全機能仕様書

> 最終更新: 2026-05-31（v59）  
> 対象: 全メニュー（スタッフ / 管理 / 運営）

---

## 目次

1. [システム概要](#1-システム概要)
2. [ロール・権限](#2-ロール権限)
3. [スタッフメニュー](#3-スタッフメニュー)
4. [管理メニュー](#4-管理メニュー)
5. [運営メニュー](#5-運営メニュー)
6. [共通機能・インフラ](#6-共通機能インフラ)
7. [DBテーブル一覧](#7-dbテーブル一覧)

---

## 1. システム概要

| 項目 | 内容 |
|------|------|
| フレームワーク | Next.js 15 App Router (TypeScript) |
| スタイル | Tailwind CSS v4 |
| DB / Auth | Supabase (PostgreSQL + Row Level Security) |
| 通知 | LINE Messaging API（Push / Multicast / ボタンテンプレート） |
| デプロイ | Vercel（Cron Jobs 対応） |
| タイムゾーン | Asia/Tokyo 固定 |
| 認証方式 | 合成メールアドレス（`s001@raq.internal`）+ Supabase Auth |

### 社員ID変換ルール
```
user.email = "s001@raq.internal" → staffId = "S001"
```

### 案件コンテキスト
すべての機能データは `project_id` で絞り込む。現在選択中の案件は Cookie `rqp-project-id` に保存。

---

## 2. ロール・権限

| ロール | `global_role` 値 | 説明 |
|--------|-----------------|------|
| スタッフ | なし（null） | 一般スタッフ。自案件のスタッフメニューのみ |
| 案件管理者 | null（`project_members.role = "project_admin"`） | 担当案件の管理メニューにアクセス可 |
| グローバル管理者 | `"admin"` | 全案件の管理メニューにアクセス可 |
| 運用者 | `"executive"` | 全機能 + 運営メニューにアクセス可 |

### 表示モード（Cookie: `rqp-view-mode`）
- `"staff"` — 管理機能を非表示（案件管理者がスタッフ視点で確認する際に使用）
- `"admin"` — 管理メニュー表示
- `"ops"` — 運営メニュー表示（運用者のみ）

### LINE友達ゲート
LINEアカウント未連携（`line_user_id = null`）→ ログイン後に `/link-line` へリダイレクト  
LINE公式アカウント未友達（`line_friend = false`）→ 全画面に友達追加バナーを表示

---

## 3. スタッフメニュー

### 3-1. ホーム (`/dashboard`)

**対象:** 全スタッフ（ops モード時は `/admin` へリダイレクト）

**主な表示内容:**
- 今日の日付・案件名・スタッフ名
- 今日のシフト情報（シフト名・開始・終了時刻）
- 出発報告ボタン（案件設定で有効化時のみ）
- 出勤打刻状態（出勤・退勤時刻）
- 未読お知らせバッジ
- 今後7日間の出勤予定（公休・有休・欠勤・振替休日・特別休暇・代休は除外）

**アクションボタン（`pre_departure` または `pre_clock_in` 状態のみ表示）:**
- 出発報告（`departure_reports` テーブルに挿入）
- 欠勤報告 → 当日欠勤報告済みの場合は **経過報告** ボタンに切り替え（`/absence-followup` へリンク）
- 遅刻報告（ETA選択 → `expected_arrival` を計算してDB・LINE通知に反映）
- 補正申請（`/corrections` へ遷移）
- ※ 打刻後（`working` / `clocked_out`）は欠勤・遅刻ボタン非表示

**管理者追加表示（`isAdmin = true` 時）:**
- タスク管理タブ（`group_tasks` テーブル）
- LINEグループ抽出タスクの管理・担当者割当・完了マーク

**関連テーブル:**
`punch_logs`, `shifts`, `departure_reports`, `absence_reports`, `late_reports`, `notices`, `notice_reads`, `group_tasks`, `task_extraction_groups`, `project_settings`

---

### 3-2. シフト (`/shifts`)

**対象:** 全スタッフ

**3タブ構成:**

#### シフトタブ
- 月カレンダー形式でシフト表示（前後3ヶ月）
- 月ナビゲーション（← 年月 →）
- 各日のシフト名・開始・終了時刻
- シフト変更ログの表示（変更者・変更前後）

#### 希望休タブ
- **申請フォーム:** カレンダーUI（`HolidayCalendar`）で日付選択 → 申請
- **申請ルール（`holiday_rules` テーブル）:**

| `rule_type` | 説明 |
|-------------|------|
| `open_day` | 申請受付開始日（毎月X日から翌月分受付開始） |
| `deadline_day` | 申請終了期日（毎月X日まで） |
| `monthly_limit_per_person` | 月上限日数（1人あたり） |
| `weekend_limit` | 土日申請可能日数（月上限のうち土日に使える上限） |
| `daily_limit_count` | 1日あたりの同時申請上限（プロジェクト全体） |
| `consecutive_limit` | 連続申請上限日数 |

- **一覧表示:** 今月以降の申請済み希望休（ステータス: 申請中 / 承認済 / 却下）
- **取り下げ:** 締切前の申請を取り下げ可能（確認モーダル）
- **提出済み希望休カード:** Googleフォーム経由でインポートされたデータ表示

#### 追加申請タブ
- シフト募集（`shift_openings`）に対して追加勤務を申請
- 既存申請一覧表示（ステータス管理）

**関連テーブル:**
`shifts`, `shift_change_logs`, `holiday_requests`, `holiday_rules`, `shift_requests`, `shift_openings`

---

### 3-3. 勤怠実績 (`/record`)

**対象:** 全スタッフ

**表示内容:**
- 月次の勤怠実績カレンダー
- 出勤・退勤時刻（打刻ログ）
- シフトとの差異（早出・残業・遅刻など）
- 月切り替え（`?month=YYYY-MM` クエリパラメータ）

**関連テーブル:**
`punch_logs`, `shifts`

---

### 3-4. 投稿 (`/post`)

**対象:** 全スタッフ（管理者は削除権限あり）

**機能:**
- スタッフ掲示板（プロジェクト内全メンバーが投稿・閲覧）
- テキスト投稿（最新100件表示）
- 管理者は任意の投稿を削除可能
- 表示モード `"staff"` 時は削除機能を非表示

**関連テーブル:**
`posts`（推定）、`project_members`, `staffs`

---

### 3-5. お知らせ (`/notices`)

**対象:** 全スタッフ

**機能:**
- 管理者から配信された周知事項の一覧
- ピン留めお知らせは常に上部に表示
- 個人宛お知らせにも対応（`target_staff_id`）
- 既読管理（`notice_reads` テーブル）
- 未読数はホーム画面のバッジに反映

**関連テーブル:**
`notices`, `notice_reads`

---

### 3-6. 問い合わせ (`/inquiries`)

**対象:** 全スタッフ

**機能:**
- スタッフが管理者へ問い合わせを送信
- 返信スレッド形式
- 未読返信バッジ

**関連テーブル:**
`inquiries`（推定）

---

### 3-7. ヘルプ (`/help`)

**対象:** 全スタッフ

**機能:**
- スタッフ向けマニュアル（`/help/manual-staff`）
- 管理者向けマニュアル（`/help/manual-admin`）
- よくある質問・操作説明

---

### 3-8. My (`/my`)

**対象:** 全ロール共通

**機能:**
- 自分のプロフィール表示（名前・社員ID）
- アバター設定（`AvatarEditor` コンポーネント、`avatar_config` JSONB）
- LINE連携状態表示・解除
- プッシュ通知 ON/OFF トグル（`PushNotifyToggle`）
- ログアウト
- 視点モード切り替え（案件管理者のみ: スタッフ ↔ 管理者）
- 案件切り替え（複数案件所属時）

**関連テーブル:**
`staffs`, `project_members`

---

### 3-9. 経過報告 (`/absence-followup`)

**対象:** 当日欠勤報告を行ったスタッフ（17:00 cron 通知からのリンク）

**機能:**
- 当日の欠勤理由を自動表示（`absence_reports.reason`）
- フォーム送信内容:

| 項目 | 詳細 |
|------|------|
| 症状等 | 発熱（体温）・頭痛・咳・倦怠感・吐き気・その他（自由記入）のチェックボックス |
| 軽快状況 | 改善 / 横ばい / 悪化 の3択 |
| 当日受診状況 | 受診あり / 受診なし の2択 |
| 翌日出勤予定 | シフトDBから自動取得（有 / 無） |
| 翌日出勤可否 | 出勤可能 / 出勤困難 の2択 |
| 次回出勤可否報告予定 | 出勤困難選択時のみ：日時入力 |

- 送信後 LINE に通知（管理者全員 + グループ）
- 送信済みの場合は再送信不可（完了画面表示）

**LINE通知フォーマット:**
```
【経過報告フォーマット_◯/◯】
※当日「17:00」までに必ずご報告お願いたします※
-------------------------------
□報告日：◯/◯（曜日）
□報告者：氏名
□報告区分：体調経過
□症状等：
  ・発熱：あり（XX度）
  ・頭痛：なし ... 
□軽快状況：改善
□当日受診状況：受診あり
□翌日出勤予定：有
□翌日出勤可否：出勤可能
（□次回出勤可否報告予定：出勤困難時のみ）
```

**Cronトリガー:** `/api/cron/notify` の17:00ジョブが当日欠勤スタッフに LINEボタン通知送信

**関連テーブル:**
`absence_reports`（`followup_symptoms`, `followup_recovery_status`, `followup_consultation_status`, `followup_next_report_date`, `followup_next_report_time` カラム）

---

## 4. 管理メニュー

> **アクセス権:** `project_admin` / `global_role = "admin"` / `global_role = "executive"`

### 4-1. 当日状況 (`/attendance`)

**機能:**
- 案件内全スタッフの当日出勤状況をリアルタイム表示
- セクション別グループ表示（SV / 査定 / 販売 / MOTA / ローン / リメイク / その他）
- ステータス別表示:

| ステータス | 説明 |
|-----------|------|
| `absent` | 欠勤報告あり |
| `late` | 遅刻報告あり |
| `working` | 出勤打刻済み |
| `departed` | 出発報告済み（未打刻） |
| `clocked_out` | 退勤打刻済み |
| `not_departed` | 未出発 |

- 離席タイマー表示（名前リスト・座席カード）
- 欠勤スタッフの翌日・翌々日出勤予定チェック
- 離職リスクアラート（`churn_risk = true` スタッフ）
- シフト変更ログ表示
- 座席表インライン表示（`/seating` 統合）

**関連テーブル:**
`punch_logs`, `shifts`, `departure_reports`, `absence_reports`, `late_reports`, `project_members`, `staffs`, `seat_layouts`（推定）

---

### 4-2. シフト管理 (`/shifts/manage`)

**機能:**
- 全スタッフのシフト一括管理
- Google スプレッドシートからシフトインポート
- シフト変更ログ記録（`shift_change_logs`）
- シフト募集（`shift_openings`）の作成・管理
- 追加申請（`shift_requests`）の承認・却下
- 希望休申請（`holiday_requests`）の一覧・承認

**関連テーブル:**
`shifts`, `shift_change_logs`, `shift_openings`, `shift_requests`, `holiday_requests`, `shift_patterns`

---

### 4-3. メンバー管理 (`/members`)

**機能:**
- 案件内メンバー一覧表示
- メンバー情報編集:
  - 表示名・所属セクション（複数可）
  - 役割（`staff` / `project_admin`）
  - 勤務形態（`work_days_type`）・勤務日数（`work_days_count`）
  - 希望シフト（`preferred_shift`）・希望セクション
  - 連続勤務上限日数（`max_consecutive_days`）
  - 在籍期間（`start_date` / `end_date`）
  - 離職リスクフラグ（`churn_risk`）
  - 銀行口座番号（`account_number`）
- LINE連携状態・友達追加状態の確認
- 研修日程管理

**関連テーブル:**
`project_members`, `staffs`, `shift_patterns`

---

### 4-4. 周知管理 (`/notices/manage`)

**機能:**
- 周知事項の作成・送信（過去日時投稿も可）
- ピン留め設定（`is_pinned`）
- 宛先指定（全体 / 特定スタッフ個人）
- 送信履歴アコーディオン表示（送信済みは編集・削除不可）
- 投稿と同時に LINE 通知送信

**関連テーブル:**
`notices`, `project_members`, `staffs`

---

### 4-5. 問合せ管理 (`/inquiries/manage`)

**機能:**
- スタッフからの問い合わせ一覧
- 返信・既読管理
- 未対応バッジ表示

**関連テーブル:**
`inquiries`（推定）

---

### 4-6. 勤怠管理 (`/attendance/edit`)

**3タブ構成:**

| タブ | 機能 |
|------|------|
| 勤怠異常 | シフトと打刻のズレ検出（早出・残業・遅刻・未打刻） |
| 補正申請 | スタッフからの打刻補正申請一覧・承認 |
| 実績出力 | 月次勤怠データの集計・出力 |

**関連テーブル:**
`punch_logs`, `shifts`, `corrections`（推定）

---

### 4-7. LINE連携 (`/line-settings`)

**機能:**
- LINEグループIDの設定（通知送信先グループ）
- 通知設定（`notification_settings` JSONB）:
  - 欠勤通知・遅刻通知・出発通知のON/OFF
  - 通知タイミング設定
- メンバーのLINE連携状態確認
- スタッフへのLINE通知テスト送信

**関連テーブル:**
`project_settings`（`line_group_id`, `notification_settings`）

---

### 4-8. 案件設定 (`/admin/[projectId]`)

**アクセス:** `project_admin` / `admin` / `executive` のみ

**設定項目（タブ構成）:**

#### 基本設定
- 案件名・有効/無効切り替え
- 出発報告機能の有効化（`enable_departure_report`）

#### メンバー設定
- `MemberList` コンポーネントを流用（`/members` と共通）

#### シフトパターン
- シフト区分（シフト名・セクション・開始・終了時刻）の登録・編集
- ソート順管理

#### 座席レイアウト
- 座席・壁の配置をドラッグ操作で設定（`SeatLayoutEditor`）
- `SeatItem`, `WallItem` の配置情報をJSONで保存

#### 希望休ルール設定
- 6種類のルール設定（`holiday_rules` テーブル）:
  - `open_day`: 申請受付開始日
  - `deadline_day`: 申請終了期日
  - `monthly_limit_per_person`: 月上限（1人あたり）
  - `weekend_limit`: 土日申請可能日数
  - `daily_limit_count`: 日上限（同時申請人数）
  - `consecutive_limit`: 連続申請上限

#### スプレッドシート連携
- Google スプレッドシートとの連携設定（OAuth）
- シフトインポート元スプシ URL の設定

**関連テーブル:**
`projects`, `project_settings`, `project_members`, `shift_patterns`, `holiday_rules`

---

## 5. 運営メニュー

> **アクセス権:** `global_role = "executive"` のみ

### 5-1. 案件管理 (`/admin`)

**機能:**
- 全案件の一覧表示（アクティブ / アーカイブ）
- 新規案件作成（`NewProjectModal`）
- 各案件への切り替え（案件タブ）
- 案件の詳細設定へのリンク（`/admin/[projectId]`）
- 案件アーカイブ（`archiveProjectAction`）

**関連テーブル:**
`projects`, `project_settings`

---

### 5-2. 運用者管理 (`/admin/operators`)

**機能:**
- 運用者（`global_role = "executive"`）アカウントの一覧
- 新規運用者追加（Supabase Auth にユーザー作成）
- 初回ログイン時パスワード変更フラグ（`must_change_password`）
- 有効/無効切り替え（`is_active`）

**関連テーブル:**
`staffs`（`global_role = "executive"`）

---

### 5-3. スタッフ一覧 (`/admin/staffs`)

**機能:**
- 全スタッフアカウントの一覧（全案件横断）
- スタッフ新規作成（Supabase Auth に合成メールでユーザー追加）
- 表示名・会社名の編集
- グローバルロールの変更
- LINE連携状態の確認

**関連テーブル:**
`staffs`

---

## 6. 共通機能・インフラ

### 6-1. 認証フロー
1. `/login` でメールアドレス（`s001@raq.internal`）＋パスワード入力
2. Supabase Auth でセッション発行
3. LINEアカウント未連携 → `/link-line` へリダイレクト
4. LINE友達未追加 → `LineFriendGate` バナー表示（全画面オーバーレイ）

### 6-2. LINE連携
- `src/lib/line.ts` のヘルパー関数使用:
  - `pushLine(userId, message)` — 個人宛テキスト
  - `multicastLine(userIds, message)` — 複数人宛テキスト
  - `pushLineWithButton(userId, message, label, url)` — ボタン付きメッセージ

### 6-3. Cron Jobs（Vercel）

`/api/cron/notify` を5分ごとに実行。内部で現在時刻を確認し、設定時刻に合致した処理のみ発火する。

| 通知キー | デフォルト時刻 | 処理内容 |
|---------|--------------|---------|
| `shift_start_remind` | シフト開始N分前 | 出勤リマインド（スタッフ個人） |
| `shift_end_remind` | シフト終了N分後 | 退勤打刻忘れリマインド（スタッフ個人） |
| `rest_day_remind` | 20:00 | 翌日出勤アナウンス（スタッフ個人） |
| `daily_summary` | 08:00 | 当日出勤状況サマリー（管理者） |
| `absence_followup_remind` | 17:00 | 当日欠勤スタッフへ経過報告ボタン通知（翌日シフトありのみ） |
| `holiday_open_notify` | 09:00 | `holiday_rules.open_day` の日に希望休受付開始通知。締切日は今月の `deadline_day` を表示 |
| `holiday_reminder` | 09:00 | 希望休締切3日前リマインド（全スタッフ） |
| `daily_task_remind` | 08:00 | 当日期限タスクのリマインド（担当スタッフ個人） |

**注意:** `holiday_open_notify` は毎月1日ではなく `holiday_rules.open_day`（案件ごとに設定）の日に発火する。`open_day` が未設定の場合は発火しない。

### 6-4. プッシュ通知（Web Push）
- `PushPermissionRequest` コンポーネントでブラウザの通知許可を要求
- 端末トークンを保存し、サーバーサイドから Web Push 送信可能

### 6-5. 打刻（打刻端末）
- `/punch` — QRコード読み取り or 端末タップで出勤・退勤打刻
- `punch_logs` テーブルに `punch_type: "clock_in" | "clock_out"` で記録

### 6-6. Google スプレッドシート連携
- `src/lib/gsheets.ts` のヘルパー関数
- OAuth認証（`/admin/gsheet-oauth`）
- シフトデータのインポートに使用

---

## 7. DBテーブル一覧

| テーブル名 | 主な用途 |
|-----------|---------|
| `staffs` | スタッフマスタ（name, display_name, global_role, line_user_id, avatar_config） |
| `projects` | 案件マスタ（name, is_active） |
| `project_members` | 案件所属（staff_id, project_id, role, section, work_days_type など） |
| `project_settings` | 案件設定（line_group_id, notification_settings, enable_departure_report） |
| `shifts` | シフトデータ（staff_id, project_id, shift_date, shift_name, shift_start, shift_end） |
| `shift_change_logs` | シフト変更履歴（before_data, after_data, changed_by） |
| `shift_patterns` | シフト区分マスタ（name, section, sort_order） |
| `shift_openings` | シフト募集（opening_date, capacity） |
| `shift_requests` | 追加申請（opening_id, preferred_start, preferred_end, status） |
| `holiday_requests` | 希望休申請（request_date, status, note） |
| `holiday_rules` | 希望休ルール（rule_type, value） |
| `punch_logs` | 打刻ログ（punch_type: clock_in/clock_out, recorded_at） |
| `departure_reports` | 出発報告（reported_at, eta_minutes） |
| `absence_reports` | 欠勤報告（absence_date, reason, status, followup_* カラム） |
| `late_reports` | 遅刻報告（late_date, reason, status） |
| `notices` | 周知事項（title, body, is_pinned, target_staff_id） |
| `notice_reads` | お知らせ既読（staff_id, notice_id） |
| `inquiries` | 問い合わせ |
| `group_tasks` | LINEグループ抽出タスク（title, assignee_staff_id, status, group_id） |
| `task_extraction_groups` | タスク抽出グループ設定（group_id, group_label, enabled） |
| `line_groups` | LINEグループ情報（group_id, joined_at） |
| `line_name_mappings` | LINEユーザー名 → 社員ID マッピング |

---

## 8. 開発環境・再開手順

### 起動

```powershell
cd C:\dev\raq-portal-app
npm run dev
# → http://localhost:3000
```

### テストアカウント

| 項目 | 値 |
|------|-----|
| メール | `s001@raq.internal` |
| 社員ID | `S001` |
| グローバルロール | `admin` |
| 案件 | P001（管理者）/ P002（スタッフ） |
| 別アカウント | O002 — `global_role = "executive"`（運用者） |

### 案件コンテキスト（Cookie）

| 属性 | 値 |
|------|-----|
| Cookie名 | `rqp-project-id` |
| 有効期間 | 30日 |
| フラグ | HTTPOnly |
| セット場所 | `/api/set-project`（Route Handler） |

1案件のみ所属 → ログイン後に自動セット  
複数案件所属 → `/select-project` で選択

### Cron ローカルテスト

```powershell
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3000/api/cron/notify
```

---

## 9. 環境変数（.env.local）

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...   # 絶対公開禁止・サーバーのみ

# アプリURL
NEXT_PUBLIC_BASE_URL=http://localhost:3000   # 本番は https://...

# LINE Messaging API（プッシュ通知・Webhook）
LINE_CHANNEL_ACCESS_TOKEN=...

# LINE Login（OAuth 認証）
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...

# Cron 認証（openssl rand -hex 32 等で生成）
CRON_SECRET=...

# Google Sheets 連携（以下いずれかの方式で設定）
# 方式A: OAuth2（推奨）
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
# 方式B: サービスアカウントJSON（丸ごと）
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# 方式C: サービスアカウント個別変数
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY=...

# Web Push（VAPID）
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

> **注意:** `SUPABASE_SERVICE_ROLE_KEY` / `LINE_LOGIN_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / Google 認証情報は **絶対にブラウザ側コード（NEXT_PUBLIC_*）に置かない**。サーバーコンポーネント・Server Actions・API Routes のみで使用する。

---

## 10. 外部サービス連携

### LINE Messaging API

| 関数 | 用途 |
|------|------|
| `pushLine(userId, message)` | 個人宛テキスト送信 |
| `multicastLine(userIds, message)` | 複数人宛テキスト送信 |
| `pushLineWithButton(userId, message, label, url)` | ボタン付きメッセージ送信 |

ソース: `src/lib/line.ts`

Webhook エンドポイント: `POST /api/line/webhook`
- `follow` イベント → `staffs.line_friend = true`
- `unfollow` イベント → `staffs.line_blocked = true`, `line_friend = false`

LINE Login OAuth コールバック: `GET /api/auth/line/callback`  
- 連携完了時 → `staffs.line_user_id` をセット + `line_friend = true`

### Google Sheets

ソース: `src/lib/gsheets.ts`

認証フォールバック順:
1. `GOOGLE_SERVICE_ACCOUNT_JSON`（JSON丸ごと）
2. `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`
3. `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN`（OAuth2）

主な操作:
- 案件設定 → スプシ自動生成 / URL手動入力 → メンバーシート自動同期
- 案件設定 → 「シフト表生成」→ 希望休を自動反映したテンプレートをスプシに作成
- シフト管理 → 「スプシから読込」→ `shifts` テーブルへ反映

スプシ構成（9シート固定）: 設定 / メンバー / 希望休 / シフト表 / シフト / 打刻ログ / 日別勤怠 / 月次集計 / シフト変更ログ

### Supabase Admin Client

RLSをバイパスする必要がある場合は `createAdminClient()`（`src/lib/supabase/admin.ts`）を使用。  
**クライアントコンポーネントから絶対にインポートしないこと。**

### Vercel Cron

`vercel.json` に設定済み。`/api/cron/notify` を5分ごとに実行。  
`Authorization: Bearer CRON_SECRET` ヘッダーで保護。

---

## 11. アーキテクチャメモ・注意事項

### Next.js 15 の変更点（要注意）

```tsx
// searchParams は Promise — 必ず await する
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
```

### "use server" ファイルの制約

`"use server"` を宣言したファイルから非 async 関数をエクスポートできない。  
型・定数・ヘルパーは別ファイル（例: `notify-config.ts`）に分離する。

### adminClient が必要な場面

- 運用者が自分の所属していない案件のデータを扱う場合
- LINE OAuth コールバック（magic link 発行）
- 打刻端末 `/punch/[projectId]`（認証不要ページ）

### Avatar システム（未完成・触らないこと）

`src/app/(portal)/admin/my/AvatarSvg.tsx` はパーツのSVGパスが未実装。  
コンポーネントの骨格と型定義のみ存在する。新しいエージェントは触らずそのまま残すこと。

---

*このドキュメントはソースコードから自動生成ではなく、実装を読み解いて作成したものです。実装変更時は本ドキュメントも更新してください。*
