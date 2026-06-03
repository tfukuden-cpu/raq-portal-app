# ルーティング・ページ一覧

> ナビゲーション項目の追加 → `src/app/(portal)/layout.tsx` を編集

## 認証フロー（portal外）

| パス | 用途 |
|------|------|
| `/login` | ログイン |
| `/select-project` | 案件選択（複数所属時） |
| `/link-line` | LINE連携（未連携時にリダイレクト） |
| `/change-password` | パスワード変更 |
| `/auth/confirm` | メール確認 |
| `/punch/[projectId]` | QRコード打刻端末（認証不要） |

## スタッフメニュー（全スタッフ）

| パス | 機能 |
|------|------|
| `/dashboard` | ホーム（出発/欠勤/遅刻報告） |
| `/shifts` | シフト表示・希望休申請 |
| `/shifts/request` | シフト追加申請 |
| `/record` | 勤怠実績 |
| `/post` | 投稿（社内掲示板） |
| `/notices` | 周知事項 |
| `/inquiries` | 問い合わせ |
| `/corrections` | 勤怠補正申請 |
| `/holidays` | 希望休申請 |
| `/absence-followup` | 欠勤経過報告 |
| `/my` | マイページ |
| `/help` | ヘルプ・マニュアル |

## 管理メニュー（project_admin / admin）

| パス | 機能 |
|------|------|
| `/attendance` | 当日状況（タブ: 出勤簿 / 確定後変更 / 座席表 / 打刻記録） |
| `/attendance/edit` | 勤怠管理（打刻ログ編集） |
| `/shifts/manage` | シフト管理・インポート |
| `/members` | メンバー管理・番付 |
| `/seating` | 座席配置 |
| `/notices/manage` | 周知管理 |
| `/inquiries/manage` | 問合せ管理 |
| `/holidays/manage` | 希望休承認 |
| `/line-settings` | LINE設定・通知設定 |
| `/tasks` | タスク一覧 |
| `/rankings` | ランキング |
| `/admin/[projectId]` | 案件詳細 |
| `/admin/[projectId]/settings` | 案件設定（シフトパターン・座席・休憩・希望休ルール等） |

## 運営メニュー（executive のみ）

| パス | 機能 |
|------|------|
| `/admin` | 案件管理ダッシュボード |
| `/admin/operators` | 運用者管理 |
| `/admin/staffs` | スタッフ一覧（全社） |
| `/admin/gsheet-oauth` | Google Sheets OAuth設定 |
| `/admin/work-records` | 勤怠レコード管理 |

## ナビゲーション構造

```typescript
// layout.tsx で管理
STAFF_ITEMS       // 全スタッフ向け
ADMIN_MENU_ITEMS  // project_admin / admin
OPS_MENU_ITEMS    // executive
```

新メニュー追加時: `src/app/(portal)/layout.tsx` の該当配列を編集。
アイコン追加が必要なら `src/components/icons.tsx` も更新。

## 表示モード（Cookie: rqp-view-mode）

| 値 | 表示 |
|----|------|
| `"staff"` | スタッフメニューのみ（管理機能を非表示） |
| `"admin"` | 管理メニュー表示 |
| `"ops"` | 運営メニュー（executive のみ） |
