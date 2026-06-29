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
| `/punch/[projectId]` | QRコード打刻端末（認証不要）。タブ: 座席表で打刻 / 名前で打刻 / 休憩室（定員制チェックイン） |

## スタッフメニュー（全スタッフ）

| パス | 機能 |
|------|------|
| `/dashboard` | ホーム（出発/欠勤/遅刻報告） |
| `/shifts` | シフト表示・希望休申請 |
| `/shifts/request` | シフト追加申請 |
| `/record` | 勤怠実績（王道RPG風） |
| `/gacha` | モンスターガチャ（**2026-06-14・一旦 福傳(O002) 限定**。`GACHA_ALLOWED`＋layout の `staffMenu` でゲート） |
| ~~`/post`~~ | 投稿（社内掲示板）＝**2026-06-13 廃止・削除済み**（ナビ・ページとも削除） |
| `/messages` | **統合メッセージ・スタッフ受信箱**（2026-06-29新設）。自分宛の受信＋「管理者へ送る」。`?open=ID`で展開。**管理者(viewMode≠staff)が開くと`/messages/manage`へ自動redirect**＝メニューは1項目で中身が役割で変わる |
| `/notices` | 周知事項（**`/messages`へ移行予定→廃止**・現在は残置） |
| `/inquiries` | 問い合わせ（**`/messages`へ移行予定→廃止**・現在は残置） |
| `/corrections` | 勤怠補正申請 |
| `/holidays` | 希望休申請 |
| `/absence-followup` | 欠勤経過報告 |
| `/my` | マイページ |
| `/help` | ヘルプ・マニュアル |

## 管理メニュー（project_admin / admin）

| パス | 機能 |
|------|------|
| `/attendance` | 当日状況（タブ: 出勤簿 / 確定後変更 / 座席表 / 打刻記録 / **日次報告**(2026-06-20追加・#16・優先セクション販売/査定の一覧＋欠勤チェック＋Excel出力)） |
| `/attendance/edit` | 勤怠管理（4タブ: 勤怠修正・申請一覧・勤怠実績・**欠勤者レポート**）URLパラメータ: `?tab=corrections\|requests\|records\|absentees&month=YYYY-MM&staffId=S001`。※遵守率(compliance)タブは2026-06-20に欠勤者レポート(absentees)へ置換(#14) |
| `/attendance/absentees` | **日毎の欠勤者**（2026-06-28追加・管理者ガード）。欠勤者レポートタブの「📅 日毎の欠勤者」ボタンから遷移。選択月の日毎の表（日付\|人数\|欠勤者）＋月ナビ。`AbsenteeDailyClient`・`?month=YYYY-MM`・同API(byDate)再利用 |
| `/shifts/manage` | シフト管理・インポート |
| `/members` | メンバー管理・番付 |
| `/seating` | 座席配置 |
| `/messages/manage` | **統合メッセージ・管理者専用**（2026-06-29新設）。送信(全員/セクション/個別)＋全受信者スレッド管理。管理者ガード(非管理者は`/messages`へredirect) |
| `/notices/manage` | 周知管理（**`/messages/manage`へ移行予定→廃止**） |
| `/inquiries/manage` | 問合せ管理（**`/messages/manage`へ移行予定→廃止**） |
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

## 廃止済みページ

| パス | 廃止理由 |
|------|---------|
| `/attendance/corrections` | `/attendance/edit?tab=corrections` に統合（2026-06-09）|

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
