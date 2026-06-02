# API Routes・Cron仕様

## API Routes（src/app/api/）

| パス | メソッド | 用途 |
|------|---------|------|
| `/api/auth/line` | GET | LINE OAuthログイン開始 |
| `/api/auth/line/callback` | GET | LINE OAuthコールバック → `staffs.line_user_id` セット |
| `/api/line/webhook` | POST | LINE Webhook（follow→line_friend=true / unfollow→line_blocked=true） |
| `/api/set-project` | POST | 案件IDをCookieにセット |
| `/api/punch/[projectId]/statuses` | GET | 打刻状態取得（QRコード端末用） |
| `/api/push/subscribe` | POST | Web Push購読登録 |
| `/api/cron/notify` | POST | スケジュール通知Cron（時刻指定・1日3回） |
| `/api/cron/extract-tasks` | POST | AIタスク自動抽出Cron（17:00 JST） |
| `/api/test-push` | POST | Web Pushテスト送信 |
| `/api/debug/line-push` | POST | LINEテスト送信（デバッグ用） |
| `/api/admin/import-shift-off-requests` | POST | 希望休リクエストインポート |
| `/api/admin/send-group-line` | POST | グループLINE送信 |
| `/api/admin/work-records/export` | GET | 勤怠レコードエクスポート |
| `/api/admin/work-records/compliance` | GET | コンプライアンス集計 |
| `/api/rankings/template` | GET | ランキング画像テンプレート |

全Cronエンドポイントは `Authorization: Bearer <CRON_SECRET>` ヘッダー必須。

## Cron Jobs（vercel.json）

**注意: Vercel Hobby プランは最小間隔24h。`*/5 * * * *` は無効（毎日00:00 UTCの1回のみ動く）。UTCで時刻指定すること。**

| パス | スケジュール（UTC） | JST換算 | 対象通知 |
|------|---------------------|---------|---------|
| `/api/cron/notify` | `0 0 * * *` | 09:00 | `holiday_open_notify` |
| `/api/cron/notify` | `0 8 * * *` | 17:00 | `absence_followup_remind` |
| `/api/cron/notify` | `0 10 * * *` | 19:00 | `rest_day_remind` |
| `/api/cron/extract-tasks` | `0 8 * * *` | 17:00 | タスク自動抽出 |

## cron/notify の処理内容

| 通知キー | 発火時刻（JST） | 処理内容 |
|---------|----------------|---------|
| `rest_day_remind` | 19:00 | 翌日出勤者へ個人リマインド＋グループへ1通まとめレポート |
| `absence_followup_remind` | 17:00 | 当日欠勤者へ経過報告ボタン通知（翌日シフトありのみ）＋グループへ1通サマリー |
| `holiday_open_notify` | 09:00 | 希望休受付開始通知（`holiday_rules.open_day` の日のみ） |

**重要:**
- `holiday_open_notify` は毎月1日ではなく案件ごとの `open_day` 設定日に発火。未設定なら発火しない。
- `absence_followup_remind` はグループに個別メッセージをスパムしない。ループ後に1通サマリーのみ送信。
- 重複防止は `notification_logs` の当日送信済みチェック（`rest_day_remind` のみ）。

**廃止済みCronキー:** `shift_start_remind`, `shift_end_remind`, `daily_summary`, `holiday_reminder`, `daily_task_remind`

## cron/extract-tasks の処理内容

LINE チャット・投稿テキストから `@名前` や「してください」等のキーワードでタスクを自動検出。  
`@anthropic-ai/sdk`（Claude API）を使用してAI解析。  
期限は「今日」「明日」「M月D日」等の複数形式に対応。

## ローカルテスト

```powershell
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3000/api/cron/notify
```
