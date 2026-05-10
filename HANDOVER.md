# Raq 社内ポータル PWA 移行プロジェクト 引継ぎ資料

最終更新：2026-05-09（v8：シフト管理UI全面刷新・adminClient化・バグ修正）

---

## 1. プロジェクト概要

合同会社Raq の社内ポータルサイトを、既存の **GAS（Google Apps Script）Webアプリ** から
**Next.js + Supabase 製の PWA（モバイルアプリ風 Web アプリ）** へ全面移行するプロジェクト。

### 規模・要件
| 項目 | 値 |
|---|---|
| 利用人数 | 約100人 |
| 案件数 | 10〜20案件（マルチテナント） |
| 兼務 | あり（1人が複数案件に所属） |
| 横断ビュー | 必要（経営・人事が全案件横断で見る） |
| LINE通知 | 案件ごとに別グループへ通知 |
| 配布方法 | PWA（ホーム画面追加・iOS/Android両対応） |
| 月額予算 | できるだけ安く（最終的に $0/月で構築中） |
| 開発体制 | 1人（バイブコーディング・JS/SQL未経験） |

---

## 2. 採用した技術スタック

```
Next.js 15+ (App Router) + TypeScript
Tailwind CSS v4 (@import "tailwindcss", class-based dark mode)
Supabase (PostgreSQL + Auth + RLS)
Cloudflare Pages（ホスティング予定）
```

### 認証方式：合成メール方式
ユーザーは **社員ID（例：S001）＋パスワード** でログイン。
内部で `s001@raq.internal` という合成メアドに変換して Supabase Auth へ。

### 案件コンテキスト
Cookie `rqp_project_id`（HTTPOnly・30日）に現在選択中の案件IDを保持。
- 1案件のみ → 自動セット
- 複数案件 → `/select-project` で選択

---

## 3. データモデル

### マスタ系（既存）
```
projects（案件マスタ）
  id, name, spreadsheet_id, line_group_id,
  punch_rule, shift_format, start_date, is_active

staffs（社員マスタ）
  id, auth_user_id, name, display_name,
  global_role (staff/admin/executive),
  default_project_id, line_user_id,
  hire_date, is_active, must_change_password

project_members（兼務対応）
  staff_id, project_id, role (staff/project_admin),
  start_date, end_date, is_main
```

### 機能データ（実装済み）
```
punch_logs（打刻LOG）
  project_id, staff_id, punch_type
  (clock_in/clock_out/break_start/break_end),
  recorded_at, area, report, approver_name, note

shifts（シフト）
  project_id, staff_id, shift_date, shift_name,
  shift_start, shift_end, status, note,
  unique(project_id, staff_id, shift_date)

shift_requests（シフト追加申請）
  project_id, staff_id, request_date,
  preferred_start, preferred_end, reason,
  status (pending/approved/rejected)

departure_reports（出発報告）
  project_id, staff_id, reported_at, eta_minutes

absence_reports（欠勤報告）
  project_id, staff_id, reported_at, reason,
  next_day_available, day_after_available, status

late_reports（遅刻報告）
  project_id, staff_id, reported_at, reason,
  expected_arrival, eta_minutes, status

notices（周知事項）
  project_id, title, body, is_pinned,
  created_by, created_at, updated_at

notice_reads（周知事項の既読管理）
  notice_id, staff_id, read_at

holiday_requests（希望休申請）
  project_id, staff_id, request_date, status
  (pending/approved/rejected/cancelled),
  note, reviewed_by, reviewed_at

punch_corrections（勤怠補正申請）
  project_id, staff_id, target_date,
  corrected_in, corrected_out, reason, status,
  reviewed_by, reviewed_at, review_note

posts（投稿・スタッフ掲示板）
  id, project_id, staff_id, body, created_at

shift_patterns（案件ごとのシフトパターン定義）★v6で列追加
  project_id, name, short_name, start_time, end_time,
  required_count(int), sort_order

project_settings（案件ごとの設定）
  project_id, sheet_url
  ※ v7以降 holiday_deadline_day・holiday_max_days は削除済み（holiday_rules テーブルへ移行）

holiday_rules（希望休ルール）★v7新設
  id, project_id, rule_type, value(int), sort_order, created_at
  ※ rule_type は "deadline_day" / "monthly_limit_per_person" /
               "daily_limit_count" / "consecutive_limit" の4種
```

### デモデータ（S001 / P001 / 2026年5月）
セクション9のSQL参照。

---

## 4. フェーズ進捗

| Phase | 内容 | 状態 |
|---|---|---|
| **0** | 開発環境構築 | ✅ 完了 |
| **1** | 認証・社員マスタ・パスワード変更・RLS | ✅ 完了 |
| **1.x** | 既存社員100名の一括移行 | ⏳ CSV出力待ち |
| **2** | 案件マスタ・所属管理・案件選択・切替 | ✅ 完了 |
| **3** | 打刻機能（出勤・退勤・休憩・履歴） | ✅ 完了 |
| **4** | シフト機能（閲覧・管理者CRUD） | ✅ 完了 |
| **4.x** | スタッフ画面UI大幅刷新 | ✅ 完了 |
| **4.y** | シフト管理UI全面刷新（日付タブ・充足バッジ・運用者全案件対応） | ✅ 完了 |
| **5** | 周知事項 | ✅ 完了 |
| **6** | 希望休・勤怠補正申請 | ✅ 完了 |
| **6.x** | 案件ごとの希望休ルール設定 | 🔄 設定UI完了・申請画面への適用が残り |
| **7** | 横断ビュー（経営・人事画面） | ✅ 完了 |
| **8** | PWA化（manifest・SW） | ✅ 完了 |
| **8.x** | LINE Login／投稿機能／勤怠実績／視点切替UI／案件設定／GSheets連携 | ✅ 完了 |
| **9** | 案件A本番投入（GAS並行運用→切替） | ⏳ 未着手 |
| **10** | 案件B・C段階展開 | ⏳ 未着手 |
| **11** | LINE Webhook移植（Edge Functions化）／pg_cron 自動通知 | ⏳ 一部着手（Login先行・Webhook未） |

---

## 5. プロジェクト構成（最新）

```
src/app/
├── (portal)/
│   ├── layout.tsx              ← AppNav + DevBanner + ロール別メニュー
│   │
│   ├── dashboard/              ← ホーム（打刻ステートマシン）
│   ├── punch/                  ← フルスクリーン打刻UI
│   │
│   ├── shifts/
│   │   ├── page.tsx            ← シフト/希望休/追加申請 タブ切り替え
│   │   ├── ShiftCalendar.tsx
│   │   ├── actions.ts          ← シフトCRUD・CSVインポート・GSheets連携
│   │   ├── request/            ← シフト追加申請
│   │   └── manage/             ← 管理者用シフト管理（v8大改訂）
│   │       ├── page.tsx        ← 月ナビ・案件タブ（運用者）・adminClient
│   │       └── ShiftDayList.tsx← 日付タブ・充足バッジ・staff一覧・モーダル
│   │
│   ├── record/                 ← 勤怠実績（月次一覧）
│   ├── post/                   ← 投稿（社内掲示板）
│   ├── my/                     ← プロフィール・案件切替・LINEリンク
│   ├── notices/                ← 周知事項
│   ├── holidays/               ← 希望休申請
│   ├── corrections/            ← 勤怠補正申請
│   ├── attendance/             ← 当日状況（管理者）
│   ├── dev/                    ← DevBanner用アクション
│   │
│   └── admin/                  ← 全社管理者専用
│       ├── page.tsx            ← 案件一覧
│       ├── NewProjectModal.tsx ← 新規案件作成（3ステップ：案件名→シフトパターン→希望休ルール）
│       ├── holiday-rule-config.ts ← 希望休ルール種別の共有設定（v7新設）
│       └── [projectId]/settings/
│           ├── page.tsx        ← 案件設定
│           ├── SettingsClient.tsx ← 設定UI（シフトパターン・希望休ルール等）
│           └── actions.ts      ← 各種設定保存アクション
│
├── api/
│   ├── auth/line/              ← LINE Login OAuth
│   └── set-project/route.ts   ← プロジェクトID cookie セット用 Route Handler
│
├── components/
│   ├── AppNav.tsx
│   ├── DevBanner.tsx
│   └── icons.tsx
│
└── lib/
    ├── datetime.ts
    ├── project-context.ts
    ├── attendance.ts
    ├── line.ts
    ├── gsheets.ts
    └── supabase/ (server / client / middleware / admin)
```

---

## 5.x. 主要機能詳細

### シフト管理（v8：全面刷新）

#### 画面構成（`/shifts/manage`）

| ロール | 表示 |
|---|---|
| 案件管理者（`project_admin`） | 自分の案件のシフトのみ管理可 |
| 運用者（`global_role = admin/executive`） | 全案件タブ切り替え＋全案件シフト管理可 |

#### データ取得
**全クエリを `createAdminClient()` 経由**（RLSをバイパス）。
通常の `createClient()` では、運用者が所属していない案件の `project_members` / `shifts` を取得できない。

#### ShiftDayList の主な仕様
- **日付タブ**：月の全日を横スクロール。シフト登録済み日に青ドット
- **充足バッジ**：`shift_patterns.required_count` と実登録数を比較。緑=充足・赤=不足
- **スタッフ一覧**：シフトあり → 上部表示。シフトなし → 折りたたみ（未登録 N名）
- **メンバー外シフト**：`project_members` に存在しない `staff_id` のシフトも「（メンバー外）」ラベルで表示
- **登録/削除後の更新**：`router.refresh()` でサーバーコンポーネントを再取得

#### 変更ログ
シフトのCUD操作はすべて `shift_change_logs` テーブルに記録。
（テーブルは既存・確認済み）

---

### 視点切替（DevBanner）

Cookie `rqp-view-mode` で `staff` / `admin` / `ops` を切り替え。

| モード | 条件 | メニュー |
|---|---|---|
| `staff` | 全員 | スタッフメニュー |
| `admin` | `project_admin` ロール保有時 | スタッフ + 管理者メニュー |
| `ops` | `global_role = admin/executive` 時 | 運用者メニュー |

**現状の課題（次のAIへ）：**
- `ops` モードでは `GLOBAL_ADMIN_ITEMS` しか表示されない
- 運用者が案件管理者メニュー（出勤状況・休暇審査・補正審査・周知管理）も使えるようにしたい
- **対応方法**：`layout.tsx` の `sections` 分岐で `ops` の場合も `PROJECT_ADMIN_ITEMS` を追加する

```typescript
// 現在
if (viewMode === "ops") {
  sections = [{ items: GLOBAL_ADMIN_ITEMS }];
}

// 変更後（希望）
if (viewMode === "ops") {
  sections = [
    { items: GLOBAL_ADMIN_ITEMS },
    { title: "案件管理", items: PROJECT_ADMIN_ITEMS },
  ];
}
```

---

### 希望休ルール（v7：柔軟化）

`src/app/(portal)/admin/holiday-rule-config.ts` に4種のルール種別を定義：

| rule_type | ラベル | 単位 |
|---|---|---|
| `deadline_day` | 申請期限日 | 日 |
| `monthly_limit_per_person` | 月上限（1人あたり） | 日 |
| `daily_limit_count` | 日上限（同時申請） | 人 |
| `consecutive_limit` | 連続申請上限 | 日 |

- **管理画面**（新規案件モーダル Step3 / 案件設定）でルールをリスト形式で設定
  - ドロップダウンで種別を選択 → 数値を入力（重複種別は選択不可）
  - `+ ルールを追加` で最大4種まで追加可能
- **保存先**：`holiday_rules` テーブル（削除→再挿入方式）
- **申請画面での適用**：⏳ 未実装（セクション10参照）

### Google Sheets 連携（v6大改訂）

#### スプシ構成（9シート固定）
| シート名 | 用途 |
|---|---|
| 設定 | 通知ON/OFF等の設定値 |
| メンバー | 社員ID・表示名・本名・役割・基本勤務日数・メモ |
| 希望休 | 希望休申請データ |
| **シフト表** | **月次入力用テンプレート（v6新設）** |
| シフト | シフト詳細データ |
| 打刻ログ | 打刻履歴 |
| 日別勤怠 | 日別勤怠実績 |
| 月次集計 | 月次集計 |
| シフト変更ログ | シフト変更履歴 |

#### シフト作業フロー（確定）
1. スプシ管理画面 →「シフト表テンプレート作成」→ 空のひな形を生成
2. スプシ上でシフト名を手入力 → 不足数スプシ数式が自動更新
3. アプリ →「シフト表を読み込む」→ shifts テーブルへ反映
4. アプリ上での変更 → シフト（詳細行）シートへ自動反映
5. **アプリ→スプシのシフト表への反映はしない（スプシが正）**

### 新規案件作成モーダル（3ステップ）
1. **Step 1** 案件名入力
2. **Step 2** シフトパターン設定（名前・略称・時刻・必要人数/日）
3. **Step 3** 希望休ルール設定（ルールリストUI）
- 完了時：ID自動採番（P001形式）・shift_patterns保存・holiday_rules保存・スプシ自動発行

---

## 6. 画面仕様（スタッフ向け主要画面）

### ホーム（`/dashboard`）
**ステートマシン：**
```
pre_departure  → [出発報告] → pre_clock_in
pre_clock_in   → [出勤打刻] → working
working        → [退勤打刻] → clocked_out
```

### シフト（`/shifts`）
3タブ：シフトカレンダー / 希望休 / 追加申請

### ナビゲーション（モバイルボトムナビ 5項目）
| アイコン | ラベル | パス |
|---|---|---|
| Home | ホーム | `/dashboard` |
| Calendar | シフト | `/shifts` |
| BarChart2 | 勤怠実績 | `/record` |
| PenSquare | 投稿 | `/post` |
| UserCircle | My | `/my` |

---

## 7. DevBanner（視点切替バナー）

複数ロールを持つアカウントが画面の見た目を切り替えるUI。
条件：`availableModes.length > 1`（2種以上のモードを持つ場合のみ表示）。

| Cookie | 値 | 説明 |
|---|---|---|
| `rqp-view-mode` | `staff` / `admin` / `ops` | 現在の視点モード |

- `staff` モード → スタッフ向けメニュー
- `admin` モード → スタッフ ＋ 案件管理者メニュー（`project_admin` 保有時のみ）
- `ops` モード → 運用者メニュー（`global_role = admin/executive` 時のみ）

**S001** は全モード強制利用可（テスト用）。

⚠️ 本番リリース時は、DevBanner自体は残してOK（一般スタッフには表示されない）。
ただし F-3（DevBanner本番無効化）で環境変数制御に変更することを推奨。

---

## 8. UIデザイン方針

- **スクロールなし**：`h-dvh` + `flex flex-col` + `flex-1 min-h-0`
- **カード**：`rounded-2xl` + `border border-zinc-200 dark:border-zinc-800`
- **アクセント色**：`blue-600`（出勤）、`emerald-600`（希望休）、`amber-500`（遅刻）
- **ダークモード**：`dark:` クラスを常にペアで指定
- **tabular-nums**：時刻・件数の表示に必ず使用
- **絵文字禁止**：SVGアイコン（`src/components/icons.tsx`）を使う
- **フォーム行のカードレイアウト**：時刻inputは `flex-1` で幅確保（`type="time"` は短すぎるとカットされる）

---

## 9. ⚠️ 未実行のSQL（確認・実行が必要）

**以下を Supabase SQL Editor で実行すること。**

### ⓪ shift_patterns テーブル更新（最優先）
```sql
alter table public.shift_patterns
  add column if not exists short_name text not null default '',
  add column if not exists required_count int;
```

新規作成の場合：
```sql
create table if not exists public.shift_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  short_name text not null default '',
  start_time time,
  end_time time,
  required_count int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.shift_patterns enable row level security;
create policy "select_member_shift_patterns" on public.shift_patterns
  for select to authenticated using (
    exists (select 1 from public.project_members pm
      where pm.staff_id = public.current_staff_id()
      and pm.project_id = shift_patterns.project_id)
  );
create policy "admin_all_shift_patterns" on public.shift_patterns
  for all to authenticated using (public.is_project_admin(project_id));
```

### ① holiday_rules テーブル新規作成（v7・最優先）
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

-- メンバーは参照可
create policy "select_member_holiday_rules" on public.holiday_rules
  for select to authenticated
  using (
    exists (select 1 from public.project_members pm
      where pm.staff_id = public.current_staff_id()
        and pm.project_id = holiday_rules.project_id)
  );

-- 案件管理者は全操作可
create policy "admin_all_holiday_rules" on public.holiday_rules
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));
```

### ② shifts テーブル
```sql
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staffs(id),
  project_id text not null references public.projects(id),
  shift_date date not null,
  shift_name text,
  shift_start time,
  shift_end time,
  note text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (staff_id, project_id, shift_date)
);
alter table public.shifts enable row level security;
create policy "select_own_shifts" on public.shifts
  for select to authenticated using (staff_id = public.current_staff_id());
create policy "admin_all_shifts" on public.shifts
  for all to authenticated using (public.is_project_admin(project_id));
```

### ③ shift_requests テーブル
```sql
create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staffs(id),
  project_id text not null references public.projects(id),
  request_date date not null,
  preferred_start time,
  preferred_end time,
  reason text,
  status text not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
alter table public.shift_requests enable row level security;
create policy "select_own_shift_requests" on public.shift_requests
  for select to authenticated using (staff_id = public.current_staff_id());
create policy "admin_select_shift_requests" on public.shift_requests
  for select to authenticated using (public.is_project_admin(project_id));
create policy "insert_own_shift_requests" on public.shift_requests
  for insert to authenticated with check (staff_id = public.current_staff_id());
```

### ④ departure_reports テーブル
```sql
create table if not exists public.departure_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staffs(id),
  project_id text not null references public.projects(id),
  reported_at timestamptz not null default now(),
  eta_minutes int
);
alter table public.departure_reports enable row level security;
create policy "own_departure" on public.departure_reports
  for all to authenticated using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());
create policy "admin_departure" on public.departure_reports
  for select to authenticated using (public.is_project_admin(project_id));
```

### ⑤ absence_reports テーブル
```sql
create table if not exists public.absence_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staffs(id),
  project_id text not null references public.projects(id),
  reported_at timestamptz not null default now(),
  reason text,
  next_day_available boolean not null default true,
  day_after_available boolean not null default true,
  status text not null default 'pending'
);
alter table public.absence_reports enable row level security;
create policy "own_absence" on public.absence_reports
  for all to authenticated using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());
create policy "admin_absence" on public.absence_reports
  for select to authenticated using (public.is_project_admin(project_id));
```

### ⑥ late_reports テーブル
```sql
create table if not exists public.late_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staffs(id),
  project_id text not null references public.projects(id),
  reported_at timestamptz not null default now(),
  reason text,
  expected_arrival time,
  eta_minutes int,
  status text not null default 'pending'
);
alter table public.late_reports enable row level security;
create policy "own_late" on public.late_reports
  for all to authenticated using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());
create policy "admin_late" on public.late_reports
  for select to authenticated using (public.is_project_admin(project_id));
```

### ⑦ デモシフトデータ（任意・テスト用）
```sql
insert into public.shifts
  (staff_id, project_id, shift_date, shift_name, shift_start, shift_end, status)
values
  ('S001','P001','2026-05-01','公休',null,null,'published'),
  ('S001','P001','2026-05-02','Aシフト','09:00','18:00','published'),
  ('S001','P001','2026-05-03','Aシフト','09:00','18:00','published'),
  ('S001','P001','2026-05-06','Aシフト','09:00','18:00','published')
on conflict (staff_id, project_id, shift_date) do nothing;
```

---

## 10. 残タスク一覧（進捗管理）

> 凡例：✅ 完了 / 🔄 進行中 / ⏳ 未着手 / 🚫 ブロック中

### 🔴 A. DB・インフラ（最優先・これがないと動かない）

| # | タスク | 状態 |
|---|---|---|
| A-1 | `shift_patterns` テーブルに `short_name` / `required_count` 列追加（SQL⓪） | ⏳ |
| A-2 | `holiday_rules` テーブル新規作成（SQL①） | ⏳ |
| A-3 | `shifts` テーブル作成（SQL②） | ⏳ |
| A-4 | `shift_requests` / `departure_reports` / `absence_reports` / `late_reports` テーブル作成（SQL③〜⑥） | ⏳ |

---

### 🟠 B. 希望休ルール適用（Phase 6.x の残り）

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| B-1 | holiday_rules 設定UI（新規案件モーダル Step3） | ✅ | |
| B-2 | holiday_rules 設定UI（案件設定ページ） | ✅ | |
| B-3 | saveHolidayRulesAction を holiday_rules テーブルへ | ✅ | |
| B-4 | holiday_rules SQL を Supabase に適用 | ⏳ | →A-2と同じ |
| B-5 | 申請期限日チェック（/holidays の submitHolidayAction） | ⏳ | `deadline_day` ルールを読み、当月XX日以降は翌月分の申請を締め切る |
| B-6 | 月上限チェック（同上） | ⏳ | `monthly_limit_per_person` ルール：既申請数 + 今回 ≤ 上限 |
| B-7 | 日上限チェック（同上） | ⏳ | `daily_limit_count` ルール：同一日の申請数 ≥ 上限なら拒否 |
| B-8 | 連続申請上限チェック（同上） | ⏳ | `consecutive_limit` ルール：連続する日程が上限超えなら拒否 |
| B-9 | 申請画面でルール内容をユーザーに表示 | ⏳ | 「このプロジェクトの上限は月3日です」等のヒント表示 |

---

### 🟡 C. 打刻・勤怠フロー

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| C-1 | 打刻ステータスのDB保存 | ⏳ | `punch_logs` に `punch_status` カラム追加（早出/定時/遅刻/早退/残業） |
| C-2 | 残業承認フロー（管理者UI） | ⏳ | `/attendance` または `/shifts/manage` に残業申請キューを追加 |
| C-3 | 欠勤・遅刻報告を `/attendance` に表示 | ⏳ | 現状は打刻ログのみ。`absence_reports` / `late_reports` も当日一覧に表示 |
| C-4 | 勤怠補正申請の管理者審査画面 | ⏳ | `punch_corrections` のステータスを管理者が承認/却下できるUI |

---

### 🟡 D. シフト管理

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| D-0 | 運用者（ops）モードに管理者メニューも追加 | ⏳ | `layout.tsx` の ops 分岐に `PROJECT_ADMIN_ITEMS` を追加。詳細は5.xのViewMode節参照 |
| D-1 | シフト追加申請（shift_requests）の管理者審査画面 | ⏳ | `/shifts/manage` に申請一覧を追加。承認→shifts に反映、却下→理由通知 |
| D-2 | 勤怠実績（/record）のシフト突き合わせ集計 | ⏳ | punch_logs × shifts で遅刻/早退/残業時間を計算して表示 |

---

### 🟡 E. データ管理

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| E-1 | 基本勤務日数のDB保存 | ⏳ | `project_members` に `default_work_days int` カラム追加。`importMembersFromSheetAction` で読み込み |
| E-2 | 社員データ一括移行（Phase 1.x） | ⏳ | 既存GASスプシの「社員名簿」CSV → `migration/staffs.csv` → `node migration/migrate-staffs.mjs` |

---

### 🟢 F. インフラ・本番化

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| F-1 | GitHub リポジトリ作成 | ⏳ | `.env.local` は `.gitignore` 済み。強く推奨 |
| F-2 | Cloudflare Pages デプロイ設定 | ⏳ | `npm run build` が通ることを確認してから |
| F-3 | DevBanner 本番無効化 | ⏳ | 環境変数 `NEXT_PUBLIC_DEV_MODE=false` 等で制御 |
| F-4 | 案件A 本番投入（Phase 9） | ⏳ | GASと2週間並行運用 → 切替 |
| F-5 | 案件B・C 段階展開（Phase 10） | ⏳ | F-4完了後 |
| F-6 | LINE Webhook 移植（Supabase Edge Functions） | ⏳ | 打刻通知・シフト通知等 |
| F-7 | pg_cron 自動通知設定 | ⏳ | 毎朝シフトリマインダー / 締切前希望休リマインダー等 |

---

## 11. 直近の Next Action（今すぐやること）

**1番目（最優先）：** 運用者モードに管理者メニューを追加（D-0）

```
src/app/(portal)/layout.tsx を編集：
viewMode === "ops" の sections に PROJECT_ADMIN_ITEMS を追加する。
詳細は セクション5.x「視点切替（DevBanner）」の「現状の課題」参照。
```

**2番目：** SQLをSupabaseに適用する（未適用のものが残っている場合）

```
セクション9の ⓪〜⑥ を Supabase SQL Editor で確認・実行
（既に適用済みのものは skip してOK）
```

**3番目：** 希望休申請画面でルールを適用する（B-5〜B-9）

```
/holidays/actions.ts の submitHolidayAction を修正：
1. holiday_rules テーブルからルールを取得
2. ルール種別ごとに申請内容をバリデーション
3. エラー時はユーザーにわかりやすいメッセージを返す
```

**4番目：** シフト追加申請の管理者審査画面（D-1）

```
/shifts/manage/page.tsx に shift_requests 一覧セクションを追加
承認アクション → shifts テーブルに反映
```

---

## 12. 既知の問題・注意点

### Tailwind v4 の注意
- `@import "tailwindcss"` 形式（`tailwind.config.js` は不使用）
- ダークモードは `@custom-variant dark (&:where(.dark, .dark *));`

### Next.js の searchParams
```tsx
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
```

### テストアカウント
| 項目 | 値 |
|---|---|
| メール | `s001@raq.internal` |
| 社員ID | `S001` |
| グローバルロール | `admin` |
| 案件 | P001（管理者）/ P002（スタッフ） |

---

## 13. 環境変数（.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...        # 絶対公開禁止・サーバーのみ
NEXT_PUBLIC_BASE_URL=http://localhost:3000
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
# GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

---

## 14. 開発の再開方法

```powershell
cd C:\dev\raq-portal-app; npm run dev
# → http://localhost:3000
```

新しいClaudeセッションで作業する場合：
```
合同会社Raqの社内ポータル（GAS→Next.js+Supabase PWA移行）を開発中です。
プロジェクトは C:\dev\raq-portal-app にあります。
HANDOVER.md を先に読んでください。
次にやることはセクション11に書いてあります。
```

---

## 15. 参考：既存GASコードの場所

```
C:\Users\fukud\OneDrive\デスクトップ\Rap\Raq portal APP\社内ポータルサイト_GAS\
  コード.gs.txt / LineWebhook.gs.txt / login.html.txt / admin.html.txt 等
```

---

## 改訂履歴

| 日付 | バージョン | 内容 |
|---|---|---|
| 2026-04-29 | v1 | Phase 0-4 完了（初版） |
| 2026-04-29 | v2 | Phase 5-7 完了、Phase番号を再編 |
| 2026-05-03 | v3 | Phase 4.x 完了（スタッフUI大幅刷新）、未実行SQL一覧、Next Action更新 |
| 2026-05-03 | v4 | Phase 7完了（横断ビュー）、Phase 8完了（PWA化）、DevBanner実装 |
| 2026-05-05 | v5 | Phase 8.x 完了。LINE Login、案件CRUD、GSheets連携、投稿機能、視点切替UI |
| 2026-05-05 | v6 | スプシ連携大改訂。シフト表テンプレート生成、不足数スプシ数式、新規案件モーダル2ステップ化、shift_patterns列追加 |
| 2026-05-06 | v7 | 希望休ルール柔軟化。holiday-rule-config.ts新設、NewProjectModal 3ステップ化、HolidayRulesList（ルール種別選択UI）、holiday_rules テーブル対応。残タスクをA〜Fカテゴリで整理 |
| 2026-05-09 | v8.1 | ops モードのナビゲーションに案件管理セクション（PROJECT_ADMIN_ITEMS）を追加。運用者が当日状況・シフト管理・休暇審査・補正審査・周知管理も使えるように |
| 2026-05-09 | v8 | シフト管理UI全面刷新。ShiftDayList（日付タブ・充足バッジ・折りたたみ未登録）新規作成、adminClientでRLSバイパス、router.refresh()でリアルタイム更新、/api/set-project Route Handler新設（Server ComponentのcookieSetバグ修正）、upsertShiftActionにprojectId対応、DevBanner説明を更新、運用者メニュー追加をNext Actionに追記 |
