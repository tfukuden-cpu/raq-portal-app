# 開発ルール・設計パターン

## ページ配置

```
src/app/(portal)/new-feature/
  ├── page.tsx        # サーバーコンポーネント（デフォルト）
  ├── actions.ts      # "use server" — Server Actions
  └── ClientUI.tsx    # "use client" — インタラクティブ部分（必要な場合のみ）
```

## 認証・権限パターン

```typescript
// ロールチェック（サーバーコンポーネント）
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");

const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

// 案件管理者確認
const { data: member } = await supabase
  .from("project_members")
  .select("role")
  .eq("staff_id", staffId)
  .eq("project_id", projectId)
  .single();
const isAdmin = member?.role === "project_admin";
```

## "use server" ファイルの制約

```typescript
// NG: 非async関数はexportできない
export const MY_CONST = "foo"; // ビルドエラー

// OK: 別ファイルに分離する
// types.ts や config.ts に定数・型を置く
```

## RLS バイパスが必要な場面

- 運用者が自案件外のデータを操作する
- LINE OAuth コールバック（magic link発行）
- 打刻端末 `/punch/[projectId]`（認証不要ページ）

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
const admin = createAdminClient();
// ↑ 絶対にクライアントコンポーネントからimportしない
```

## Next.js 15+ の変更点

```typescript
// searchParams・params は Promise になった
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { projectId } = await params;
  const { tab } = await searchParams;
}
```

## UIスタイル方針

| 要素 | スタイル |
|------|---------|
| 大カード | `rounded-2xl` |
| カラー基調 | `zinc-` グレースケール |
| アクセント | `blue-600` |
| サイドバー | `#0d1b35`（ダークネイビー）|
| コンテンツ背景 | `#f4f6fa` |
| コンテナ幅 | `max-w-6xl mx-auto` |
| 時刻・件数 | `tabular-nums` |
| モバイル | モバイルファースト |
| ダークモード | `dark:` を必ずペアで指定 |

## セクション順（出勤ボード・通知レポート共通）

```
["SV", "査定", "販売", "MOTA", "ローン", "未アポ", "インフォ", "研修関連", "その他"]
```

## シフト名による振り分けルール

- 「研修」を含む → セクションに関係なく「その他」
- 休み扱い（ボード非表示）: `公休 / 有休 / 休暇 / 振替休日 / 特別休暇 / 代休 / 欠勤 / 希望休`
- 早番判定: `shift_start < 11:00`、遅番: `>= 11:00`

## 触らないファイル

`src/app/(portal)/admin/my/AvatarSvg.tsx` — SVGパスが未実装。骨格だけ。
