<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Raq Portal 開発ルール（AI向け）

このプロジェクトは **バイブコーディング**（JS/SQL未経験のユーザーがAIに指示して進める）で開発されています。
AIが新規ページや機能を実装するときは以下のルールを守ってください。

## 必読ドキュメント

作業を始める前に必ず読むもの：

1. **`HANDOVER.md`** — 全体設計・進捗・残タスク
2. **`README.md`** — クイックスタート・ディレクトリ概要

## ルール

### 1. ログイン後の画面は `(portal)/` 配下に作る

`src/app/(portal)/` は **Route Group**。`AppNav`（PCサイドバー＋モバイルボトムナビ）に
自動で包まれる。新しい機能ページはここに追加する。

```
src/app/(portal)/
  └── new-feature/
      ├── page.tsx        # サーバーコンポーネント（デフォルト）
      ├── actions.ts      # サーバーアクション
      └── ClientUI.tsx    # 必要ならクライアントコンポーネント
```

### 2. ナビゲーション項目を増やすときは layout.tsx を編集

`src/app/(portal)/layout.tsx` 内の以下を編集：

- `STAFF_ITEMS` — 全スタッフ向けメニュー
- `PROJECT_ADMIN_ITEMS` — 案件管理者（`project_admin`）向け
- `GLOBAL_ADMIN_ITEMS` — 全社管理者（`admin`/`executive`）向け

アイコンは `src/components/icons.tsx` に追加し、`IconKey` と `ICON_MAP` も更新。

### 3. 新しいテーブルを作るときは必ずRLSをセット

最低限以下を含める：

```sql
alter table public.<table> enable row level security;

-- 自分のデータは見える
create policy "select_own_<table>" on public.<table>
  for select to authenticated
  using (staff_id = public.current_staff_id());

-- 案件管理者は案件内すべて見える
create policy "admin_select_<table>" on public.<table>
  for select to authenticated
  using (public.is_project_admin(project_id));

-- 自分のデータのみ追加可能
create policy "insert_own_<table>" on public.<table>
  for insert to authenticated
  with check (
    staff_id = public.current_staff_id()
    and exists (
      select 1 from public.project_members pm
      where pm.staff_id = <table>.staff_id
      and pm.project_id = <table>.project_id
    )
  );
```

ヘルパー関数 `public.current_staff_id()` と `public.is_project_admin(project_id)` は
既に作成済み。使うこと。

### 4. 案件コンテキストを必ず尊重する

すべての機能データは `project_id` を持ち、現在選択中の案件で絞り込む：

```typescript
import { getCurrentProjectId } from "@/lib/project-context";

const projectId = await getCurrentProjectId();
if (!projectId) redirect("/select-project");

const { data } = await supabase
  .from("xxx")
  .select("*")
  .eq("project_id", projectId);
```

### 5. 認証ユーザーから社員IDへの変換

Supabase Auth は合成メール方式（`s001@raq.internal`）。
社員IDを取得するには：

```typescript
const { data: { user } } = await supabase.auth.getUser();
const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
// "s001@raq.internal" → "S001"
```

### 6. 日時は東京タイムゾーンで扱う

`src/lib/datetime.ts` の以下を使う：

- `formatDateJP(d)` — `2026/04/29`
- `formatTimeJP(d)` — `14:30`
- `formatDateTimeJP(d)` — `2026/04/29 14:30`
- `startOfTodayJST()` — 当日0時のISO（東京）
- `isSameDayJP(a, b)` — 同日判定（東京）

ブラウザロケール依存の `toLocaleDateString()` などは使わない。

### 7. アイコンは `src/components/icons.tsx` のもの

絵文字は使わず、SVGアイコンを使う（既存スタイルとの統一性のため）。
新しいアイコンが必要なら `icons.tsx` に追加してください。

### 8. UI スタイルの方針

- **角丸 `rounded-2xl`** が基本（カードなどの大きな要素）
- **配色**：`zinc-` グレースケール + `blue-600` をアクセント
- **モバイルファースト**：小さい画面でちゃんと使えることを最優先
- **`tabular-nums`** を時刻・件数表示に使う
- **ダークモード対応**：`dark:` クラスを必ずペアで指定

### 9. テストデータ

既存の動作確認用：

- 社員ID: `S001` / メアド: `s001@raq.internal`
- 案件: `P001` テスト案件A / `P002` テスト案件B
- S001 は P001 の `project_admin`、P002 の `staff`
- 全社ロール: `global_role = 'admin'`

`global_role` を切り替えると画面が変わるので、テストの際は意識する。

### 10. SQL を書いたら破壊的でも警告は無視可（理由を言う）

Supabase SQL Editor は DROP / DELETE などに警告を出す。
正当な理由があれば「実行」して問題ない（HANDOVER.md に記録すること）。

### 11. .env.local は触るな・コミットするな

以下は **絶対にブラウザ側コード（NEXT_PUBLIC_*）に置かない**：
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINE_LOGIN_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_SERVICE_ACCOUNT_JSON`

サーバー側（API Routes、Server Actions、移行スクリプト）でのみ使う。
新しい秘密情報を追加するときは `.env.local` と `.env.local.example` 両方を更新する。

### 13. Service Role が必要な処理は `lib/supabase/admin.ts` 経由で

RLS をバイパスする必要がある場合（admin系の操作・LINE OAuth callback の magic link 発行など）：

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
const admin = createAdminClient();
// 注意：このクライアントは絶対にクライアントコンポーネントから import しないこと
```

### 14. LINE / Google Sheets 連携の処理は `lib/line.ts` `lib/gsheets.ts`

- LINE通知を出すなら `pushLine()` / `multicastLine()`
- スプシ操作なら `lib/gsheets.ts` のヘルパー
- 新規にAPIを叩くときは既存のラッパーに合わせて追加

### 15. 視点モード（DevBanner）対応

`/post` のように **管理者ビューが画面UIに影響する** ページは、Cookie `rqp-view-mode` を読んで
`staff` モード時は管理機能を出さない、という分岐を入れる：

```typescript
const viewMode = (await cookies()).get("rqp-view-mode")?.value ?? "staff";
const isAdmin = viewMode !== "staff" && /* 通常のロールチェック */;
```

### 12. 既存GASコードは仕様書として読む

`C:\Users\fukud\OneDrive\デスクトップ\Rap\Raq portal APP\社内ポータルサイト_GAS\` にある
GASコードは **仕様の参考資料**。直接コピーせず、ロジックを読み解いて TypeScript で書き直す。

---

## 作業の進め方

1. `HANDOVER.md` で現在のフェーズ・残タスクを把握
2. ユーザーと「次に何を作るか」を合意
3. 実装する
4. ユーザーに動作確認してもらう
5. 完了したら `HANDOVER.md` の進捗表を更新
