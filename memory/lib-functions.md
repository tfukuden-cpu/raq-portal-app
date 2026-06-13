# ライブラリ関数一覧

> 詳細実装 → 各 `src/lib/*.ts` を直接参照

## src/lib/line.ts — LINE Messaging API

| 関数 | 用途 |
|------|------|
| `pushLine(lineUserId, text)` | テキスト送信（1人） |
| `pushLineWithButton(lineUserId, text, label, url, color?)` | Flex Message：テキスト＋ボタン1通 |
| `multicastLine(lineUserIds, text)` | マルチキャスト（最大500人）※ボタン非対応 |
| `pushLineTestButton(lineUserId, staffName, projectId)` | テスト受信確認ボタン送信 |
| `getLineAuthUrl(state)` | LINE OAuth認可URL生成 |
| `fetchLineProfile(code)` | OAuthコード→プロフィール取得 |
| `checkLineFriendship(accessToken)` | 友達追加状態確認 |

**注意:** `LINE_CHANNEL_ACCESS_TOKEN` 未設定時は静かに失敗（エラーなし）

## src/lib/notify.ts — 通知共通ライブラリ

```typescript
sendEventNotify(
  projectId: string,
  type: keyof NotificationSettings,  // 有効キー → notification-settings-types.md 参照
  vars: Record<string, string>,       // メッセージ内の {変数名} を置換
  targetStaffId?: string,             // 省略 or null → 全スタッフ
  button?: { label: string; url: string },
  groupPrefix?: string,               // グループ通知に前置きテキストを付ける
  staffMessageOverride?: string,      // 個人向けメッセージを完全上書き
)
```

その他:
- `logNotify(entry)` — 通知ログをDBに記録
- `resolveMessage(template, vars)` — `{変数名}` プレースホルダー置換
- `getAdminLineIds(projectId)` — 案件管理者のLINE ID取得

## src/lib/datetime.ts — 日時ユーティリティ（JST固定）

| 関数 | 出力例 |
|------|-------|
| `formatDateJP(d)` | `2026/04/29` |
| `formatTimeJP(d)` | `14:30` |
| `formatDateTimeJP(d)` | `2026/04/29 14:30` |
| `startOfTodayJST()` | 当日0時のISO文字列（東京） |
| `isSameDayJP(a, b)` | boolean（東京時刻で同日判定） |

**`toLocaleDateString()` は使わない。**

## src/lib/project-context.ts — Cookie管理

| 関数 | 用途 |
|------|------|
| `getCurrentProjectId()` | Cookie から現在の案件ID取得 |
| `setCurrentProjectId(projectId)` | Cookie に案件ID保存 |
| `clearCurrentProjectId()` | Cookie 削除 |

Cookie名: `rqp_project_id`、30日有効

## src/lib/supabase/

| ファイル | 用途 |
|---------|------|
| `client.ts` | クライアントコンポーネント用 |
| `server.ts` | サーバーコンポーネント・Server Actions用 |
| `admin.ts` | `createAdminClient()` — RLS完全バイパス（サーバーのみ） |
| `middleware.ts` | 認証ミドルウェア |

## src/lib/gsheets.ts — Google Sheets

| 関数 | 用途 |
|------|------|
| `readSheet(id, sheet, range)` | シート読み取り |
| `writeSheet(id, sheet, values, range)` | シート上書き |
| `appendSheetRow(id, sheet, row)` | 末尾に1行追記 |
| `patchSheetCell(id, sheet, range, value)` | 特定セル更新 |
| `generateShiftTableSheet(...)` | シフト表自動生成（確認ビュー＋入力ビュー2段構成） |
| `createSpreadsheet(projectName)` | 新規スプレッドシート作成（9シート自動セットアップ） |
| `isGSheetsConfigured()` | Google認証の設定確認 |
| `extractSpreadsheetId(urlOrId)` | URL or ID からID抽出 |

認証フォールバック順: `GOOGLE_SERVICE_ACCOUNT_JSON` → `GOOGLE_CLIENT_EMAIL+PRIVATE_KEY` → OAuth2

## src/lib/attendance.ts

型: `DailyRecord`, `StaffMonthlySummary`（勤怠計算ロジック）

## src/lib/rpg-chars.ts — RPGキャラクター定義

旧シグネチャ（互換維持・中身は新100体システムに差し替え済）: `RPG_CHARS`(=100体・label="種族の職業")／`rpgCharImg(id)`(=`/rpg/char-${id}.png`)／`rpgCharFor(staffId, overrideId?)`(→1-100の`{id,label}`)。My・AppNav・ホーム・打刻端末・休憩室はこの旧シグネチャ経由で新アバターを表示中。

新API（SPEC.md §6-7・基本職100体＋パートナー72体）:
| 関数/定数 | 用途 |
|------|------|
| `RPG_JOBS`(20)/`RPG_RACES`(5) | 職業・種族ラベル配列 |
| `jobCharId(jobIndex,raceIndex)` | 職(1-20)×種族(1-5) → charId(1-100) |
| `jobCharInfo(id)` | charId → `{jobIndex,raceIndex,jobLabel,raceLabel,label}` |
| `jobCharImg(id)` | `/rpg/char-${id}.png` |
| `jobCharIdFor(staffId,overrideId?)` | 本人選択優先・未選択はハッシュで1-100 |
| `RPG_MONSTERS`(72・`{id,label,rarity}`)/`monsterImg(id)`/`monsterById(id)` | パートナー。`/rpg/mon-${id}.png` |

## src/lib/gacha.ts — モンスターガチャ抽選（plain・"use server"なし）

定数: `GACHA_COST_SINGLE`(100)/`GACHA_COST_TEN`(1000)/`GACHA_TEN_COUNT`(10)/`GACHA_TEN_GUARANTEE`(3)/`RARITY_RATES`(★1=.5/★2=.35/★3=.12/★4=.03)/`RARITY_INFO`(色・★文字)
| 関数 | 用途 |
|------|------|
| `rarityFromRoll(roll)` | 0〜1 → レアリティ |
| `pickMonster(rarity,pickRoll)` | レアリティ内から1体 |
| `drawOne(roll)` / `drawGacha(count,rolls)` | 抽選（10連は★3以上1体確定） |
| `gachaPlan(mode)` | "single"/"ten" → `{cost,count}` |

## src/app/(portal)/gacha/actions.ts — ガチャ サーバーアクション（UI未接続）

`drawGachaAction(mode)` 残高チェック→減算→`staff_partners` insert（重複OK・失敗時コイン返却） / `getGachaStateAction()` 残高・所持・連れ歩き / `setActivePartnerAction(monsterId|null)` 連れ歩き設定（所持確認あり）

## src/app/(portal)/seating/punch-actions.ts — 打刻サーバーアクション

| 関数 | シグネチャ | 用途 |
|------|-----------|------|
| `clockInAction` | `(projectId, staffId, shiftStartHHMM)` | 出勤打刻。シフト前→開始時刻補正、後→遅刻+15分切り上げ。note に `出勤打刻: HH:MM` 記録 |
| `clockOutAction` | `(projectId, staffId, shiftEndHHMM, mode, signerName?, reason?)` | 退勤打刻。mode: `"early_leave"` (15分切り下げ+承認者必須) / `"on_time"` (シフト終了時刻) / `"overtime"` (実打刻+承認者必須)。note に `退勤打刻: HH:MM  早退/残業承認者: XX` 記録 |
| `seatLeaveAction` | `(projectId, staffId)` | 離席打刻 |
| `seatReturnAction` | `(projectId, staffId)` | 着席打刻 |
| `breakStartAction` | `(projectId, staffId, slotNumber?, breakType?)` | 休憩開始 |
| `breakEndAction` | `(projectId, staffId)` | 休憩終了 |
| `breakResetAction` | `(projectId, staffId)` | 休憩リセット |
| `getStaffPunchSummaryAction` | `(projectId, staffId)` | 当日の打刻サマリー取得 |

**注意:** `earlyLeaveAction` は廃止済み。`clockOutAction(mode="early_leave")` を使う

## src/app/punch/[projectId]/actions.ts — 打刻端末サーバーアクション

| 関数 | 用途 |
|------|------|
| `terminalPunchAction(projectId, staffId, punchType, punchKind, approverName?, shiftStart?, shiftEnd?)` | 端末からの打刻。punchKind: `normal/late/early/overtime`。note に実打刻時刻・承認者を記録 |
| `terminalBreakAction(projectId, staffId, breakNote?)` | 端末からの休憩トグル |

## src/app/(portal)/attendance/edit/actions.ts — 勤怠管理サーバーアクション

| 関数 | 用途 |
|------|------|
| `savePunchCorrectionAction(projectId, staffId, date, clockIn, clockOut, isAbsent, absenceReason, isLate, lateReason)` | 管理者による直接打刻修正。punch_logs を削除→再挿入。note に `"管理者修正:staffId"` を記録 |
| `confirmAttendanceAction(projectId, staffId, date)` | 勤怠確定（attendance_confirmations に upsert） |
| `unconfirmAttendanceAction(projectId, staffId, date)` | 勤怠確定取消 |
| `reviewCorrectionAction(formData)` | staff申請の打刻修正を承認/却下。承認時は punch_logs を正しい時刻で上書き＋LINE通知 |
| `reapplyCorrectionAction(id)` | 承認済み申請を punch_logs に再適用（タイムスタンプバグで未反映だった分の救済用） |

**注意:** `corrected_in/out` は DB から `"HH:MM:SS"` で返る → `.slice(0,5)` で正規化してから `:00+09:00` を付ける（`applyPunchCorrection()` ヘルパーで共通化）

## src/components/icons.tsx

使えるアイコン → [icons.md](icons.md) 参照

```typescript
import { ICON_MAP, type IconKey } from "@/components/icons";
```
