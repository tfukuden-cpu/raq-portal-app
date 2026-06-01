# Raq 社内ポータル PWA

合同会社Raq の社内ポータルサイト（既存：GAS Webアプリ）を、
**Next.js + Supabase 製の PWA** に全面移行するプロジェクト。

詳細な進捗・設計・残タスクは **[SPEC.md](./SPEC.md)** を参照。

## クイックスタート

```powershell
# 依存パッケージのインストール
npm install

# 開発サーバー起動
npm run dev
# → http://localhost:3000
```

## 必要な環境変数

`.env.local` に以下を設定：

```env
# Supabase（必須）
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# アプリのベースURL（LINE Login のredirect_uri 構築に使用）
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# LINE Login（オプション）
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...

# LINE Messaging API（オプション）
LINE_CHANNEL_ACCESS_TOKEN=...

# Google Sheets API（オプション・OAuth または Service Account）
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

`.env.local.example` をコピーして使うのが楽。詳細は SPEC.md セクション9。

## 技術スタック

| 層 | 採用 |
|---|---|
| フロント | Next.js 15 (App Router) + TypeScript + Tailwind CSS |
| 認証 | Supabase Auth（合成メール方式） |
| DB | Supabase PostgreSQL（RLS有効） |
| ホスティング | Cloudflare Pages（予定） |
| 配布 | PWA（ホーム画面追加・iOS/Android両対応） |

## ディレクトリ構成（要点）

```
src/app/
├── login, change-password, select-project    公開・認証フロー
├── api/auth/line, api/auth/line/callback     LINE Login（OAuth）
└── (portal)/                                 ログイン後の共通レイアウト + DevBanner
    ├── dashboard                             ホーム（打刻ステートマシン）
    ├── punch                                 打刻
    ├── shifts (+ /manage, /request)          シフト・希望シフト
    ├── record                                勤怠実績
    ├── post                                  投稿（社内掲示板）
    ├── my                                    プロフィール・LINE連携
    ├── notices (+ /manage)                   周知事項
    ├── holidays (+ /manage)                  希望休申請・審査
    ├── corrections (+ /manage)               勤怠補正申請・審査
    ├── attendance                            当日状況（案件管理者）
    ├── dev                                   DevBanner用 server actions
    └── admin/                                全社横断（global_role=admin/executive）
        ├── /[projectId]                      案件詳細
        ├── /[projectId]/settings             案件設定（メンバー・スプシURL等）
        └── /gsheet-oauth                     Google Sheets OAuth設定
```

## 実装済みフェーズ

- ✅ Phase 0: 開発環境構築
- ✅ Phase 1: 認証・社員マスタ
- ✅ Phase 2: 案件マスタ・所属管理（マルチテナント）
- ✅ Phase 3: 打刻機能
- ✅ Phase 4: シフト機能 + Phase 4.x スタッフ画面UI大幅刷新
- ✅ Phase 5: 周知事項
- ✅ Phase 6: 休暇申請・勤怠補正申請
- ✅ Phase 7: 横断ビュー（当日状況・案件一覧）
- ✅ Phase 8: PWA化（manifest・SW）
- ✅ Phase 8.x: LINE Login／投稿（posts）／勤怠実績（/record）／視点切替UI／案件CRUD・設定／Google Sheets 連携

## 残タスク

- ⏳ Phase 1.x: 社員データ一括移行（CSV出力後に実行）
- ⏳ Phase 6.x: 案件ごとの希望休ルール設定（期日・定員・休館日）
- ⏳ Phase 9: 打刻ステータス・残業承認フローのDB保存
- ⏳ Phase 10: 案件A本番投入（既存GASとの並行運用→切替）
- ⏳ Phase 11: 案件B・C 段階展開
- ⏳ Phase 12: LINE Webhook 移植・pg_cron 自動通知

## 移行スクリプト（未実行）

既存GASスプシの社員名簿を Supabase に一括登録：

```powershell
# 1. 既存スプシの「社員名簿」シートをCSVダウンロード
# 2. migration/staffs.csv に配置
# 3. 実行
node migration/migrate-staffs.mjs
```

詳細は [migration/README.md](./migration/README.md)。

## 補足ドキュメント

- [SPEC.md](./SPEC.md) — 全体仕様・DB設計・環境変数・外部連携情報
- [AGENTS.md](./AGENTS.md) — AI（Claude等）に作業させるときのルール
- [migration/README.md](./migration/README.md) — 社員データ移行手順
