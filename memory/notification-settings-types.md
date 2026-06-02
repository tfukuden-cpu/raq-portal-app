# 通知設定型定義

> 定義ファイル: `src/app/(portal)/admin/[projectId]/settings/notify-config.ts`

## NotifyItemConfig 型

```typescript
type NotifyItemConfig = {
  enabled: boolean;
  recipient: "admin" | "staff";
  time?: string;     // Cron発火時刻（HH:MM）
  message?: string;  // カスタムメッセージテンプレート
};
```

## 有効な通知キー（NotificationSettings）

| キー | 説明 | recipient |
|------|------|-----------|
| `absence` | 欠勤申請 | admin |
| `tardiness` | 遅刻申請 | admin |
| `announcement` | お知らせ | staff |
| `inquiry` | 問い合わせ（スタッフ→管理） | admin |
| `inquiry_reply` | 問い合わせ返信（管理→スタッフ） | staff |
| `shift_changed` | シフト変更（常時有効） | staff |
| `shift_request` | 追加申請 | admin |
| `shift_request_result` | 追加申請結果 | staff |
| `correction_result` | 勤怠補正結果 | staff |
| `rest_day_remind` | 翌日出勤リマインド＋グループレポート | staff |
| `holiday_open_notify` | 希望休受付開始通知 | staff |
| `absence_followup_remind` | 欠勤経過報告リマインド | staff |
| `shift_published` | シフト展開（UI非表示） | staff |
| `task_assigned` | タスク割当（UI非表示） | staff |

## 廃止済みキー（使用禁止）

`daily_summary`, `shift_start_remind`, `shift_end_remind`, `holiday_reminder`, `daily_task_remind`, `absence_followup_notify`

DBやコードにこれらのキーが残っていても参照・更新しない。
