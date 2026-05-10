# 社員データ移行手順

既存のGASスプシ「社員名簿」シートからSupabaseへ100人分の社員データを一括移行する。

## 実行前のチェックリスト

- [ ] `.env.local` に `SUPABASE_SERVICE_ROLE_KEY` が設定されている
- [ ] `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` が設定されている
- [ ] `migration/staffs.csv` が配置されている
- [ ] Supabaseに `projects.P001` が登録されている

## CSVの作り方

1. 既存のGASスプシをブラウザで開く
2. 「社員名簿」シートをクリック
3. メニュー → ファイル → ダウンロード → カンマ区切り形式（.csv）
4. ダウンロードされたファイルを `C:\dev\raq-portal-app\migration\staffs.csv` として保存

CSVの想定構造（既存社員名簿シート）:

| 列 | 内容 | 例 |
| --- | --- | --- |
| A | 社員ID | S001 |
| B | パスワード（移行時は無視） | hogehoge |
| C | 氏名 | 田中太郎 |
| D | 部署 | 管理 / スタッフ |
| E | 任意 | - |
| F | 表示名 | 田中　太郎 |

1行目はヘッダーとして無視されます。

## 実行

```powershell
cd C:\dev\raq-portal-app
node migration/migrate-staffs.mjs
```

## 移行内容

- 各社員に対して Supabase Auth ユーザーを作成
  - メアド: `<社員IDの小文字>@raq.internal`
  - パスワード: `raq-init-2026`
- `staffs` テーブルに登録
  - `must_change_password = true`（初回ログイン時にパスワード変更を強制）
  - 部署が「管理」「管理者」のいずれかなら `global_role = admin`、それ以外は `staff`
- `project_members` テーブルに `P001` 案件で登録
  - 管理者は `project_admin` ロール、それ以外は `staff` ロール

## 再実行可能

スクリプトは冪等（idempotent）なので、何度でも実行できます。
既存ユーザー・既存staffs行は upsert されます。

## 移行後の社員への通知

```
社内ポータル新システムへの移行のお知らせ

URL: https://portal.your-domain.com  (本番投入後に通知)
社員ID: 既存と同じ（例：S001）
初期パスワード: raq-init-2026

初回ログイン時にパスワード変更を求められます。
新しいパスワードは8文字以上にしてください。
```

## トラブルシュート

### `email_exists` エラー
すでにAuthユーザーが居る場合は自動でスキップされます。

### `projects table foreign key violation`
`P001` がprojectsテーブルに無い → 先に案件マスタにP001を登録してください。
