# Raq 社内ポータル PWA — 引継ぎ資料

最終更新：2026-05-10（v9：LINE通知システム実装・アバター設計・デプロイ準備）

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

## 3. 開発の再開方法

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
```

---

## 5. プロジェクト構成

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

## 6. LINE通知システム（v9実装済み）

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

## 7. アバターシステム（v9設計・実装途中）

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

## 8. UIデザイン方針

- **角丸**: `rounded-2xl`（カード・大要素）
- **配色**: `zinc-` グレースケール ＋ `blue-600` アクセント
- **モバイルファースト**: `h-dvh` + `flex flex-col`
- **ダークモード**: `dark:` クラスを必ずペアで指定
- **tabular-nums**: 時刻・件数に必ず使用
- **絵文字禁止**: SVGアイコン（`src/components/icons.tsx`）を使う
- **スクロールなし**: `flex-1 min-h-0 overflow-y-auto`
- Tailwind v4: `@import "tailwindcss"` 形式（`tailwind.config.js` 不使用）

---

## 9. ⚠️ 未実行のSQL（要実行）

Supabase SQL Editor で実行すること。

### ① notification_settings カラム追加（v9・必須）
```sql
alter table public.project_settings
  add column if not exists notification_settings jsonb default '{}';
```

### ② avatar_config カラム追加（v9・必須）
```sql
alter table public.staffs
  add column if not exists avatar_config jsonb;
```

### ③ shift_patterns テーブル更新
```sql
alter table public.shift_patterns
  add column if not exists short_name text not null default '',
  add column if not exists required_count int;
```

### ④ holiday_rules テーブル新規作成
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

## 10. 環境変数（.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...        # 絶対公開禁止・サーバーのみ
NEXT_PUBLIC_BASE_URL=http://localhost:3000
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
CRON_SECRET=...                            # ★v9新設：openssl rand -hex 32 等で生成
```

---

## 11. 残タスク一覧

> 凡例：✅ 完了 / 🔄 進行中 / ⏳ 未着手

### 🔴 最優先（これがないと動かない）

| # | タスク | 状態 |
|---|---|---|
| A-1 | SQL①② を Supabase に実行（notification_settings・avatar_config） | ⏳ |
| A-2 | `.env.local` に `CRON_SECRET` を追加 | ⏳ |
| A-3 | SQL③④ を Supabase に実行（shift_patterns・holiday_rules） | ⏳ |

---

### 🟠 LINE通知（v9で基盤実装済み、残りは細部）

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| B-1 | イベント通知の動作確認 | ⏳ | 欠勤・遅刻・打刻・お知らせ投稿でLINEが飛ぶかテスト |
| B-2 | スケジュール通知の動作確認 | ⏳ | `curl -H "Authorization: Bearer <CRON_SECRET>" localhost:3000/api/cron/notify` |
| B-3 | holiday_reminder の実装 | ⏳ | 締切日（毎月何日）を `project_settings` に追加してから実装 |

---

### 🟠 アバターシステム（v9で設計済み、パーツは未実装）

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| C-1 | SVGパーツの描画（HairBack/HairFront/Eyes/Mouth） | 🔄 | ユーザーが手書き予定。セクション7の仕様書を参照 |
| C-2 | AvatarSvg を他の画面でも使う | ⏳ | スタッフ一覧・管理画面のアイコン表示に使う |
| C-3 | スタッフ用マイページ（/my）にも同様のアバター設定を追加 | ⏳ | 現状は管理者/運用者のみ |

---

### 🟡 希望休ルール適用

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| D-1 | 申請期限日チェック | ⏳ | `deadline_day` ルールを読み、締切後は翌月分に切替 |
| D-2 | 月上限チェック | ⏳ | `monthly_limit_per_person` ルール |
| D-3 | 日上限チェック | ⏳ | `daily_limit_count` ルール |
| D-4 | 連続申請上限チェック | ⏳ | `consecutive_limit` ルール |
| D-5 | 申請画面でルール内容を表示 | ⏳ | 「月3日まで申請可能です」等のヒント |

---

### 🟡 シフト管理

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| E-1 | シフト追加申請の管理者審査画面 | ⏳ | `/shifts/manage` に申請一覧。承認→shifts 反映 |
| E-2 | 勤怠実績のシフト突き合わせ | ⏳ | punch_logs × shifts で遅刻/早退時間を計算 |

---

### 🟢 本番化

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| F-1 | GitHub リポジトリ作成 & push | ⏳ | git init → commit → push |
| F-2 | Vercel デプロイ | ⏳ | GitHub連携 → 環境変数設定 → Deploy |
| F-3 | Supabase URL に本番ドメインを追加 | ⏳ | Auth → URL Configuration |
| F-4 | LINE Developers に本番 Callback URL を追加 | ⏳ | `https://本番ドメイン/api/auth/line/callback` |
| F-5 | 案件A 本番投入（GASと2週間並行運用） | ⏳ | |
| F-6 | 社員100名の一括移行 | ⏳ | `migration/migrate-staffs.mjs` を使う |

---

## 12. テストアカウント

| 項目 | 値 |
|---|---|
| メール | `s001@raq.internal` |
| 社員ID | `S001` |
| グローバルロール | `admin` |
| 案件 | P001（管理者）/ P002（スタッフ） |

---

## 13. ホスティングとCron

`vercel.json` が設置済み。Vercelにデプロイすると自動で5分ごとに
`/api/cron/notify` が呼ばれ、スケジュール通知が送信される。

ローカルでのcronテスト：
```powershell
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3000/api/cron/notify
```

---

## 14. 既知の問題・注意点

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

## 15. 改訂履歴

| 日付 | バージョン | 内容 |
|---|---|---|
| 2026-04-29 | v1〜v4 | Phase 0〜8 実装 |
| 2026-05-05 | v5 | LINE Login・案件CRUD・GSheets連携・投稿・視点切替 |
| 2026-05-06 | v6 | スプシ連携大改訂、シフト表テンプレート |
| 2026-05-06 | v7 | 希望休ルール柔軟化、holiday_rules テーブル |
| 2026-05-09 | v8 | シフト管理UI全面刷新、adminClient化、ops メニュー追加 |
| 2026-05-10 | v9 | LINE通知システム実装（notify.ts・cron route・各action更新）、アバターシステム設計（AvatarSvg/AvatarEditor/avatar-types）、運用者マイページ(/admin/my)、vercel.json、CRON_SECRET |
