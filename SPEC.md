# Raq Works 全機能仕様書

> 最終更新: 2026-06-02（v80）  
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

### 3-0. My (`/my`) ※更新

**LINE関連の追加項目:**
- **LINE公式アカウントを友達追加** — LINE連携済みの場合、友達追加状況を表示
  - 友達追加済み → 「友達追加済み ●」（緑）
  - 未追加 → タップで公式LINE友達追加ページへ（`NEXT_PUBLIC_LINE_ADD_FRIEND_URL` または LINE API から取得した URL）
  - LINE未連携 → グレーで「先にLINE連携が必要」
- 上部ミニカードのLINE欄にも友達状態（友達追加済み / 友達未追加）を表示

**環境変数:**
`NEXT_PUBLIC_LINE_ADD_FRIEND_URL=https://line.me/R/ti/p/@xxxxxxx` を Vercel に設定すると API 呼び出しなしで確実に表示される。

---

### 3-1. ホーム (`/dashboard`)

**対象:** 全スタッフ（ops モード時は `/admin` へリダイレクト）

**デザイン:** 王道RPG風（2026-06-12〜）。夜空グラデ背景＋DotGothic16フォント＋ドラクエ風ウィンドウ（紺 `#000846`・白二重枠・枠上タイトルラベル）。打刻端末の休憩室と同じ世界観。

**主な表示内容（上から）:**
- ヒーローバナー: AI生成の夜の城下町ドット絵（`public/rpg/home-hero.png`）＋星の瞬き＋日付・ライブ時計＋中央にマイキャラクター（ぴょこぴょこアニメ・タップでキャラ選択モーダル＝RPG風ダーク配色）
- メッセージウィンドウ: ＊「挨拶メッセージ」＋点滅▼カーソル（ランダム24パターンは従来どおり）
- 「きゅうけいちゅう」ウィンドウ（休憩室入室中のみ・▶退室する）
- 「きゅうけいキャンプ」: 打刻端末の休憩室タブと同一スタイル（キャンプ背景＋焚き火＋「なかま N／Mにん」カウント）。**箱は1枠のみ表示**: 空きあり=「ぼしゅうちゅう ▶くわわる」（タップで先頭の空き箱に自動入室・`enterMyBreakRoomAction`・休憩打刻中のみサーバー側で検証）/ 満員=「あきわく なし」/ 自分が入室中=自分のキャラ＋「きゅうけいちゅう」（アンバー枠）/ 閉鎖中=「ヘイサちゅう」。退室は「きゅうけいちゅう」カードから。**管理者は「▶閉鎖する／開放する」ボタンで開閉切替**（`break_room_settings.is_open`・閉鎖中はヘイサちゅう表示＆入室不可・打刻端末側も「とざされている」表示で入室ブロック）
- 打刻端末の休憩室タブには「▶つかいかた」ボタン→RPG風マニュアルモーダル（はいるとき/でるとき/ちゅうい）
- 「きょうのクエスト」= 本日シフト（休日は「きょうは おやすみだ」）/「ステータス」= 勤怠状態＋しゅっきん・たいきん時刻（2カラム）
- 「コマンド」= ▶欠勤報告 ▶遅刻報告（報告済みはグレー・欠勤済は▶経過報告に変化）。出発報告はクエスト窓内「▶しゅっぱつ ほうこく」
- 「おしらせ」= ギルドけいじばん風タイムライン（★＋日時＋タイトル）
- 「こんしゅうの よてい」= 1週間カレンダー（今日を白反転ハイライト・シフト名はアンバー）
- PC版トップヘッダー（AppNav）: 案件名 | 日付 | ライブ時計 | ベル | キャラアイコン+名前

**アクションボタン:**
- 出発報告（`departure_reports` テーブルに挿入）
- 欠勤報告 → 当日欠勤報告済みの場合は **経過報告** ボタンに切り替え（`/absence-followup` へリンク）
- 遅刻報告（ETA選択 → `expected_arrival` を計算してDB・LINE通知に反映）
- ※ 打刻後（`working` / `clocked_out`）は欠勤・遅刻ボタン非表示

**管理者追加表示（`isAdmin = true` 時）:**
- 今日のタスクウィジェット（`group_tasks` テーブル・期限当日分）をカレンダー下部に常時表示
- 「すべて見る →」で `/tasks` へ遷移（タブ切り替えなし）

**関連テーブル:**
`punch_logs`, `shifts`, `departure_reports`, `absence_reports`, `late_reports`, `notices`, `notice_reads`, `group_tasks`, `project_settings`

---

### 3-2. シフト (`/shifts`)

**対象:** 全スタッフ

**タブなし・カレンダー常時表示:**
- 月カレンダー形式でシフト表示（前後3ヶ月）
- カレンダー日付に希望休申請済みバッジを表示（申請=紫・承認=濃紫・却下=赤）
- 右上「希望休申請」ボタン → オーバーレイで `StaffOffRequestCalendar` を表示

#### 希望休申請オーバーレイ（`StaffOffRequestCalendar`）
- `shift_off_requests` テーブルを使用（優先度付き）
- 対象月カレンダーで日付をタップ → **優先度モーダル**（第1〜第4希望ボタン）
- 申請済み日付を色分け表示（第1=青・第2=藍・第3=紫・第4=グレー）
- 申請済み日をタップ → **取り下げモーダル**
- 期日（`deadlineDay`）を過ぎると取り下げ不可（バナー表示）
- 申請枠（`maxDaysPerMonth`）の残数を表示

**追加申請タブは廃止**

**関連テーブル:**
`shifts`, `shift_change_logs`, `shift_off_requests`, `holiday_rules`

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
- **日付ナビゲーション**（`?date=YYYY-MM-DD`）: 前日・翌日ボタンで任意の日付の状況を閲覧可能。各タブ内にナビバーを配置。
- セクション別グループ表示: `shift_patterns.section` + `project_members.section` の全セクションを表示（スタッフが配置されていない空セクションも表示）
- ステータス別表示:

| ステータス | 説明 |
|-----------|------|
| `absent` | 欠勤報告あり |
| `late` | 遅刻報告あり |
| `working` | 出勤打刻済み |
| `departed` | 出発報告済み（未打刻） |
| `clocked_out` | 退勤打刻済み |
| `not_departed` | 未出発 |

**■ 打刻状態と勤怠ステータスの2軸分離（重要な設計方針）**

「打刻状態（実際に打刻したか）」と「勤怠ステータス（現場の状態）」は別軸として扱う。

- **勤怠ステータス**: 現場の状態（勤務中/休憩中/離席中など）。管理者が当日状況で手動変更できる。
- **打刻状態**: スタッフ本人の実打刻の有無（打刻済/打刻未）。出勤簿の名前カードに別バッジで表示。

管理者が出勤簿でステータスを手動「勤務中」に変更すると、`note="admin_manual"` 付きの `clock_in` が作成される。

- 出勤簿の**勤怠ステータス**: この補正打刻を含めて「勤務中」を永続表示（更新後も維持）。
- 出勤簿の**打刻バッジ**・スタッフ向け打刻画面（座席表/打刻端末）: `note="admin_manual"` を**実打刻から除外**。よって打刻状態は「打刻未」のままで、スタッフ本人がいつでも出勤打刻できる。
- スタッフが実打刻すると通常の `clock_in`（note なし）が記録され、以降は実打刻ベースで勤務中/休憩などが反映される。
- `admin_manual` 除外が必要な箇所: `seating/punch-actions.ts getStaffPunchSummaryAction` / `attendance/page.tsx realClockIn` / `punch/[projectId]/page.tsx clockedIn` / `api/punch/[projectId]/statuses/route.ts clockedIn`（端末ポーリングの上書き注意）。

- 離席タイマー表示（名前リスト・座席カード）
- 欠勤スタッフの翌日・翌々日出勤予定チェック
- 離職リスクアラート（`churn_risk = true` スタッフ）
- **XLSX出力ボタン**（出勤簿タブ）: 早番シート・遅番シートの2シート構成。欠勤者除外・アカウント番号数値昇順。シフト開始時刻 < 11:00 を早番、≥ 11:00 を遅番として振り分け。
- **セクションヘッダー充足数表示**: 配置数 / 必要枠数（充足 ±N）を表示。必要枠数は `shift_slot_requirements` テーブルから取得（日付別オーバーライド対応）。販売・査定セクションのみ早番/遅番別内訳を表示。全セクションのカードをアカウント番号数値昇順で表示。
- **「本日休み（補填調整）」欄は廃止**
- **確定後変更タブ（比較ビュー）**: セクション別×アカウント番号順で全スタッフを一覧表示し、確定版と当日版を並列表示。差分行はアンバー強調。
- 座席表インライン表示（`/seating` 統合）
- **打刻記録タブ**（旧「休憩管理」）: 出勤者全員の打刻タイムライン（横棒ガント）を表示。査定・販売スタッフ行に休憩スロット変更ドロップダウン＋小休憩分数セレクタ（0/10/15/20/30分、`break_short_settings` に保存）。スロット別割り当て一覧は座席表の「休憩一覧」ボタンに移設。
- 出勤ボードのスタッフカードに休憩スロットバッジ（①②③）を表示

**セクション順（固定優先 + 動的追加）:**
`["SV", "査定", "販売", "MOTA", "ローン", "リメイク"]` → `shift_patterns.section` から取得した追加セクション → "その他"

**シフト名によるセクション振り分けルール:**
- シフト名に「研修」を含む → セクションに関係なく「その他」へ
- 休み扱いシフト（ボード非表示・休暇者リストに表示）: `公休 / 有休 / 休暇 / 振替休日 / 特別休暇 / 代休 / 欠勤 / 希望休`

**H MOTA スロット配置パネル（出勤ボード内）:**

`H MOTA` セクション（シフト名が "H MOTA" で始まる）のカラム内に専用パネルを表示。

| 列 | 内容 |
|---|---|
| 番号 | アカウント番号（ポジションキー） |
| 12:00-13:00 | ドロップゾーン |
| 18:00-19:00 | ドロップゾーン |

**行の種類:**
- **MOTA非出勤**：`project_members.section = "MOTA"` または `"H MOTA"` で当日シフトなしのメンバー
- **空き**：固定ポジション番号（ASS 130〜134, ASS 196〜200）

**操作:**
- メインボードの任意のセクションのスタッフカードをドラッグ → スロット枠にドロップ → 名前が複製される
- × ボタンで削除
- 座席表でも配置済みスタッフのカードに紫バーと時間帯が表示される（`assigned_account` で連携）

**関連テーブル:**
`punch_logs`, `shifts`, `departure_reports`, `absence_reports`, `late_reports`, `project_members`, `staffs`, `shift_patterns`, `shift_change_logs`, `shift_month_status`, `seats`, `seat_assignments`, `seat_walls`, `mota_slot_assignments`, `break_slot_settings`, `break_slot_assignments`

---

### 4-2. シフト管理 (`/shifts/manage`)

**機能:**
- 全スタッフのシフト一括管理
- Google スプレッドシートからシフトインポート
- シフト変更ログ記録（`shift_change_logs`）
- シフト募集（`shift_openings`）の作成・管理
- 追加申請（`shift_requests`）の承認・却下
- 希望休申請（`holiday_requests`）の一覧・承認

**編集グリッドのスタッフ行:**
- 固定列: アカウント番号列（68px）+ 氏名列（88px）の2列構成
- ▲▼ボタンで全スタッフの並び替えが可能
- 並び順は `localStorage` に `shift-row-order-{projectId}-{YYYY-MM}` で保存・復元
- シフト管理画面（`ShiftDayList`）でも同じ並び順を反映

**シフト変更通知（`notifyShiftChangesAction`）:**
- 確定後に変更対象スタッフへ個別LINE通知を送信
- 送信内容は `notification_logs` に記録される（LINE設定 → 通知履歴で確認可）
- 日付フォーマットは `new Date(d)` + UTC メソッドで処理（サーバーが UTC でも正しく JST 日付を表示）

**関連テーブル:**
`shifts`, `shift_change_logs`, `shift_openings`, `shift_requests`, `holiday_requests`, `shift_patterns`, `notification_logs`

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
- **番付タブ**: ASS査定・ASS販売の番付データをExcelインポート。セクション別（査定/販売）に順位表示。休憩スロット割り当てのランク付けに使用。
- **管理メニューに「番付管理」独立メニューは廃止**（メンバー管理の番付タブに統合）

**関連テーブル:**
`project_members`, `staffs`, `shift_patterns`, `rankings`

---

### 4-3b. 座席表 (`/seating`)

**機能:**
- 当日の着席状況をリアルタイム表示（座席カードにステータス色）
- 休憩開始/終了トグル（座席タップ）
- 席替えモード: 座席にスタッフをドラッグ・アサイン→保存時に休憩スロットも自動割り振り
- **休憩スロットバッジ（①②③）**: 査定・販売スタッフの座席右下に表示
- **「休憩割り振り」ボタン**: 番付順に基づき Bresenham 分配でスロットを自動割り当て
- **「休憩一覧」ボタン**: スロット × 査定/販売 × 早番/遅番 の人数・名前一覧をトグルパネルで表示（`breakAssignmentMap` + `seats.shiftName` から計算）
- 同時編集セッション管理（ハートビート・ロック機能）

**関連テーブル:**
`seats`, `seat_assignments`, `seat_walls`, `punch_logs`, `shifts`, `absence_reports`, `break_slot_settings`, `break_slot_assignments`

---

### 4-4. 周知管理 (`/notices/manage`)

**機能:**
- 周知事項の作成・送信（過去日時投稿も可）
- ピン留め設定（`is_pinned`）
- 宛先指定（全体 / 特定スタッフ個人）
- 送信履歴アコーディオン表示（送信済みは編集・削除不可）
- 投稿と同時に LINE 通知送信
- **ファイル添付（2026-06-10追加）**: 画像・PDF等を1周知につき1ファイル添付可能
  - Supabase Storage バケット `notice-attachments`（public）にアップロードし、`notices.attachment_url` / `attachment_name` に保存
  - クライアント側で最大 **10MB** を検証（Server Actions の `bodySizeLimit: "10mb"`＝next.config.ts と整合）
  - スタッフ側 `/notices` では画像はインライン表示、その他ファイルはダウンロードリンク表示
  - 周知削除時にストレージの添付ファイルも削除

**関連テーブル:**
`notices`, `project_members`, `staffs`、Storage: `notice-attachments`

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

**ナビラベル:** 「勤怠管理」  
**URLパラメータ:** `?tab=corrections|requests|records|compliance&month=YYYY-MM&staffId=S001`

**4タブ構成:**

| タブ | 機能 |
|------|------|
| 勤怠修正 | `punch_corrections`（staff申請の打刻補正）一覧。フィルタ: 審査中/すべて/承認済/却下。承認/却下モーダル（承認時は punch_logs を正しい時刻で上書き＋LINE通知）。承認済みに「再適用」ボタン（タイムスタンプバグ救済用）。SV承認者列（work_exception_requests とクロス参照） |
| 申請一覧 | `work_exception_requests`（早退・残業申請）一覧。フィルタ: すべて/早退/残業。SV署名・ステータス表示（現状 view-only） |
| 勤怠実績 | 月ナビ＋名前検索 → スタッフ一覧（月次サマリー）→ クリックで当月全日カレンダー詳細。公休・希望休含む全シフトを表示。打刻修正モーダル・確定ボタン・月計フッター。管理者修正は備考欄に修正者名を表示。出力ボタン（ExportModal）。詳細ビューでも月移動可（URLにstaffId保持） |
| 遵守率 | WorkRecordsClient（fixedTab="compliance"）既存の遵守率ビュー |

**関連テーブル:**
`punch_logs`, `shifts`, `punch_corrections`, `work_exception_requests`, `absence_reports`, `late_reports`, `attendance_confirmations`, `staff_break_overrides`, `shift_patterns`

**重要な注意事項:**
- `punch_corrections.corrected_in/out` は DB の time 型なので `"HH:MM:SS"` で返る。ISO生成時は `.slice(0,5)` で `"HH:MM"` に正規化してから `:00+09:00` を付ける（二重付加で insert が無音失敗するバグあり、修正済み）
- `punch_corrections` に staffs FK が未定義のため join 禁止。名前は `memberMap`（project_members 起源）で解決
- 管理者による直接修正は `punch_logs.note = "管理者修正:staffId"` を記録し、備考欄に修正者名として表示

**廃止:** `/attendance/corrections`（別ページ）は廃止。`/attendance/edit?tab=corrections` に統合済み（2026-06-09）

---

### 4-6b. 周知管理 LINE通知仕様（更新）

周知事項投稿時に「LINE通知する」にチェックを入れると以下が送信される：

**個人宛メッセージ（スタッフ）— Flex Message 1通:**
```
【お知らせ】
宛先：〇〇さん / 全スタッフ
送信者：〇〇
─────────────────
タイトル

本文（全文・文字切れなし）
─────────────────
[内容を見る]  ← ボタン（同一メッセージ内）
```

**深リンク（2026-06-10追加）:**
- ボタンURLは `/notices?open={noticeId}`。開くと該当周知を自動展開し、その位置までスクロール
- 投稿時のID取得は **insert と select を分離**（`.single()` はRLSのSELECTポリシーで失敗するため使用禁止）。IDが取れない場合は `/notices` にフォールバック

**管理グループメッセージ（追加プレフィックス）:**
```
📢 周知事項送信
送信者：〇〇
送信先：全スタッフ / 〇〇さん

（以下、通常のお知らせ内容）
```

**実装詳細:**
- `notices/actions.ts` で送信者名・宛先を取得してメッセージを組み立て
- `sendEventNotify()` に `staffMessageOverride`（個人向け書式）と `groupPrefix`（グループ向け前置き）を渡す
- `pushLineWithButton()` は Flex Message 1通でテキスト全文＋ボタンを同梱
- 全員送信時はボタン付き個別 push（multicast はボタン非対応のため）

**文字数制限:** 投稿・周知の文字数制限は廃止済み

---

### 4-7. LINE連携 (`/line-settings`)

**機能:**
- LINEグループIDの設定（通知送信先グループ）
- **通知設定**（`notification_settings` JSONB）— 有効なイベント通知のみ:

| キー | 説明 |
|------|------|
| `absence` | 欠勤申請 → 管理者グループ |
| `tardiness` | 遅刻申請 → 管理者グループ |
| `announcement` | お知らせ → スタッフ |
| `inquiry` / `inquiry_reply` | 問い合わせ往復 |
| `shift_changed` | シフト変更 → 対象スタッフ（常時有効） |
| `shift_request` / `shift_request_result` | 追加申請往復 |
| `correction_result` | 勤怠補正結果 → スタッフ |
| `rest_day_remind` | 翌日出勤リマインド → スタッフ個人 + **グループへ1通レポート** |
| `holiday_open_notify` | 希望休受付開始 → スタッフ |
| `absence_followup_remind` | 欠勤経過報告リマインド → 対象スタッフ |
| `shift_published` | シフト展開 → スタッフ（UI非表示・展開ボタン制御） |
| `task_assigned` | タスク割当 → 担当スタッフ（UI非表示） |

- **翌日出勤リマインドレポート（手動送信）**: 通知設定タブに「今すぐ送信」ボタン。翌日出勤者への個人リマインド + グループへ1通のまとめレポートを即時送信。レポート形式:
  ```
  【 翌日（M/D）出勤リマインドレポート】
  合計 N名 / セクションA N名 ...
  ⚠️ 送信失敗 N名（LINE未登録 or 送信エラー）
  ----------
  【セクション名】
  ・ASS 03 氏名  ※前日欠勤 / ✗未送信
  ```
- 研修・導入研修シフトは `shift_off_requests`の shift_name で自動判定し「研修関連」グループとして集計
- セクション表示順: SV → 査定 → 販売 → MOTA → ローン → 未アポ → インフォ → 研修関連
- メンバーのLINE連携状態確認
- **廃止した通知キー**: `daily_summary`, `shift_start_remind`, `shift_end_remind`, `holiday_reminder`, `daily_task_remind`, `absence_followup_notify`
- **未確認者への再送ボタン**: 連携管理タブに「未確認者に再送（N名）」ボタン追加。LINE連携済みでテスト通知をまだ確認していないスタッフのみに再送できる
- **友達追加状況**: 各スタッフ行に「友達✓ / 未追加」バッジを表示。サマリーに友達追加済み人数を表示

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

#### 休憩設定
- 休憩スロット（①②③）の時間帯・対象シフト・割合を編集
- `break_slot_settings` テーブルに保存（設定なし時はデフォルト値を使用）
- デフォルト: ①12:00-13:00 早番20% / ②13:15-14:15 両方40% / ③14:30-15:30 遅番40%

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

### 6-2b. LINE通知共通関数（更新）

`src/lib/notify.ts` の `sendEventNotify` シグネチャ：

```typescript
sendEventNotify(
  projectId: string,
  type: keyof NotificationSettings,
  vars: Record<string, string>,
  targetStaffId?: string,           // null → 全スタッフ
  button?: { label: string; url: string },  // ボタン付き送信
  groupPrefix?: string,             // グループ通知の前置きテキスト
  staffMessageOverride?: string,    // 個人向けメッセージを完全上書き
)
```

`pushLineWithButton()` は **Flex Message 1通** にテキスト＋ボタンを同梱して送信。

---

### 6-3. Cron Jobs（Vercel）

`/api/cron/notify` を5分ごとに実行。内部で現在時刻を確認し、設定時刻に合致した処理のみ発火する。

| 通知キー | デフォルト時刻 | 処理内容 |
|---------|--------------|---------|
| `rest_day_remind` | 20:00 | 翌日出勤スタッフ個人リマインド + グループへ1通まとめレポート |
| `absence_followup_remind` | 17:00 | 当日欠勤スタッフへ経過報告ボタン通知（翌日シフトありのみ） |
| `holiday_open_notify` | 09:00 | `holiday_rules.open_day` の日に希望休受付開始通知 |

**`rest_day_remind` レポート仕様:**
- 必要枠数は `shift_slot_requirements` テーブルから取得
- shift_name に「研修」を含むシフトは `shift_start` が null でも対象に含める
- 昨日欠勤したスタッフに ★ マーク、LINE未登録・送信エラーは失敗理由を記載
- セクション表示順: SV → 査定 → 販売 → MOTA → ローン → 未アポ → インフォ → 研修関連

**廃止したCronキー:** `shift_start_remind`, `shift_end_remind`, `daily_summary`, `holiday_reminder`, `daily_task_remind`

**注意:** `holiday_open_notify` は毎月1日ではなく `holiday_rules.open_day`（案件ごとに設定）の日に発火する。`open_day` が未設定の場合は発火しない。

### 6-4. プッシュ通知（Web Push）
- `PushPermissionRequest` コンポーネントでブラウザの通知許可を要求
- 端末トークンを保存し、サーバーサイドから Web Push 送信可能

### 6-5. 打刻（打刻端末）
- `/punch` — QRコード読み取り or 端末タップで出勤・退勤打刻
- `punch_logs` テーブルに `punch_type: "clock_in" | "clock_out"` で記録

### 6-5-2. 休憩室（定員制チェックイン）
打刻端末 `/punch/[projectId]` に「休憩室」タブ（座席表で打刻・名前で打刻に続く3つ目）。

- **箱方式**: 定員数分の番号付き箱（No.1〜N）。空き箱をタップ → 休憩中スタッフの一覧から自分の名前を選択して入室。使用中の箱をタップ → 退室確認 → 退室（本人のみ操作する運用）
- **入室条件**: ステータスが休憩中（`break_start` 進行中・未退勤）のスタッフのみ。事前予約は不可
- **自動退室**: 休憩戻り（break_end）・退勤（clock_out）・休憩リセットの**全経路**で `releaseBreakRoomBox()`（`src/lib/break-room.ts`）により箱を自動解放
- **競合防止**: `break_room_uses` の UNIQUE(project_id, use_date, box_number) で同じ箱の二重取りをDBレベルで防止。UNIQUE(project_id, use_date, staff_id) で1人1箱
- **タブバッジ**: 「休憩室 3/6」形式で使用数/定員を常時表示（満室時は赤）。箱には入室からの経過時間タイマー表示
- **同期**: `/api/punch/[projectId]/statuses` のポーリング（30秒）に占有状況を同梱。レスポンス形式は `{ statuses: [...], breakRoom: { capacity, uses } }`
- **管理者ビュー**: 座席表 `/seating` ツールバーの「休憩室」ボタン → パネルで占有状況閲覧・**強制解放**・**定員変更**（1〜50・`break_room_settings.capacity`）。定員を減らすとはみ出した箱は自動解放
- **本人のスマホから退室**: ダッシュボード（`/dashboard`）に入室中のみアンバーのカードを表示。「退室する」ボタンで自分の枠を解放（`leaveMyBreakRoomAction`・staffId はセッションから導出するため他人の枠は外せない）
- **設備情報の表示**: 端末の休憩室タブに「【せつび】○トイレ ○Wi-Fi ×冷蔵庫 ×電子レンジ」のように○×で表示。`break_room_settings.amenities`（jsonb・`[{label, ok}]` 最大12件）。管理者は `/seating` 休憩室パネルで追加・削除・あり/なし切替・保存ができる。デフォルトはトイレ○/Wi-Fi○/冷蔵庫×/電子レンジ×
- **キャラクター108体・本人選択**: キャラ定義は `src/lib/rpg-chars.ts`（職業・モンスター・ドラゴン・魔人・妖精・アンデッド等108体、`public/rpg/char-1..108.png`）。スタッフは Myページ（`/my`）のプロフィールアイコンをタップ、またはホーム（`/dashboard`）の「マイキャラクター」カード →「変更する」で全キャラ一覧から自分のキャラを選択（`staffs.rpg_character` に保存・未選択は社員IDハッシュで自動割当）。選んだキャラは Myページのプロフィールアイコン・サイドバー/PCヘッダーのユーザーアイコン・打刻端末の名前選択リスト・休憩室の表示・入退室モーダルすべてに反映（旧 AvatarEditor の顔アバターは /my から廃止）
- **開放/閉鎖**: `break_room_settings.is_open boolean default true`（マイグレーション add_break_room_is_open 実行済み）。管理者がホームの「きゅうけいしつ」ウィンドウから切替。閉鎖中は `enterBreakRoomAction` がサーバー側で拒否（「休憩室は閉鎖中です」）。statuses API の breakRoom に `isOpen` 同梱・端末は30秒ポーリングで反映
- **ホームからの入退室**: `enterMyBreakRoomAction(boxNumber)`（セッションからstaffId導出）で本人入室。`getBreakRoomStateAction` は占有者の `name`・`rpgCharId` も解決して返す
- サーバーアクション: `src/app/(portal)/seating/break-room-actions.ts`

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
| `shift_off_requests` | 希望休申請・優先度付き（project_id, staff_id, request_date, priority: 第一〜第四希望休, source） |
| `staffs.line_friend` | LINE公式アカウントを友達追加済みか（follow WebHookで true、unfollow で false） |
| `shift_slot_requirements` | シフト別必要枠数（project_id, section, pattern_name, shift_date, required_count） |
| `holiday_requests` | 希望休申請・承認制（request_date, status, note） |
| `holiday_rules` | 希望休ルール（rule_type, value） |
| `punch_logs` | 打刻ログ（punch_type: clock_in/clock_out, recorded_at） |
| `departure_reports` | 出発報告（reported_at, eta_minutes） |
| `absence_reports` | 欠勤報告（absence_date, reason, status, followup_* カラム） |
| `late_reports` | 遅刻報告（late_date, reason, status） |
| `notices` | 周知事項（title, body, is_pinned, target_staff_id, attachment_url, attachment_name） |
| `notice_reads` | お知らせ既読（staff_id, notice_id） |
| `inquiries` | 問い合わせ |
| `group_tasks` | LINEグループ抽出タスク（title, assignee_staff_id, status, group_id） |
| `task_extraction_groups` | タスク抽出グループ設定（group_id, group_label, enabled） |
| `line_groups` | LINEグループ情報（group_id, joined_at） |
| `line_name_mappings` | LINEユーザー名 → 社員ID マッピング |
| `mota_slot_assignments` | H MOTAスロット配置（account_number=ポジションキー, slot, staff_name, assigned_account, is_fixed） |
| `break_slot_settings` | 休憩スロット設定（slot_number, label, start_time, end_time, target_shift: early/late/both, ratio, sort_order） |
| `break_slot_assignments` | 休憩スロット割り当て（project_id, assignment_date, staff_id, slot_number, UNIQUE(project_id,assignment_date,staff_id)） |
| `rankings` | 番付データ（project_id, staff_name, account_number=ASS査定/ASS販売, rank, period） |
| `break_room_settings` | 休憩室の定員（project_id PK, capacity 1〜50 デフォルト6） |
| `break_room_uses` | 休憩室の占有状況（入室中のみ行が存在。UNIQUE(project_id,use_date,box_number) / UNIQUE(project_id,use_date,staff_id)） |

---

## 8. 開発環境・再開手順

### デプロイ（本番環境）

Vercel に接続済み。コードを push すると自動デプロイされる。

```powershell
git push
# → GitHub → Vercel が自動ビルド・デプロイ
```

ローカル開発サーバーは使用しない。動作確認は本番 URL で行う。

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

### デザインシステム（v70〜）

- **カラー:** サイドバー `#0d1b35`（ダークネイビー）、コンテンツ背景 `#f4f6fa`、アクセント `blue-600`
- **レイアウト:** PCサイドバー `w-60`（240px）、トップヘッダー `h-14`（日付・時計・ベル・アバター）
- **コンテナ幅:** `max-w-6xl mx-auto` に統一
- **アクティブナビ:** 左ライン → `bg-white/10 rounded-xl` の全幅ハイライト

### Avatar システム（未完成・触らないこと）

`src/app/(portal)/admin/my/AvatarSvg.tsx` はパーツのSVGパスが未実装。  
コンポーネントの骨格と型定義のみ存在する。新しいエージェントは触らずそのまま残すこと。

---

*このドキュメントはソースコードから自動生成ではなく、実装を読み解いて作成したものです。実装変更時は本ドキュメントも更新してください。*
