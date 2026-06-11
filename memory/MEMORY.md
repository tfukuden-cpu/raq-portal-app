# Raq Works 開発メモリ

> AIが作業を始める前に必ず読む。SPEC.md と合わせて使う。

---

## システム概要

合同会社Raqの社内ポータルPWA。Next.js 16 + Supabase + LINE通知。  
スタッフの勤怠・シフト・座席・通知を一元管理する多テナントシステム。

**開発スタイル:** バイブコーディング（JS/SQL未経験ユーザーがAIに指示して進める）

---

## 現在の開発状態（2026-06-10更新）

### 直近の作業（周知のファイル添付・LINE深リンク）

#### 周知管理 `/notices/manage` にファイル添付機能
- 1周知につき1ファイル（画像・PDF等）。Storage バケット `notice-attachments`（public）にアップロード
- `notices.attachment_url` / `attachment_name` カラムに保存。削除時はストレージからも除去
- **サイズ制限**: クライアント検証 10MB ＋ next.config.ts `serverActions.bodySizeLimit: "10mb"`（Vercelデフォルト1MBだと大きいPDFで「通信エラー」になる）
- スタッフ側 `/notices`: 画像はインライン表示・他ファイルはDLリンク
- **LINE通知ボタン**: 「周知事項を見る」→「内容を見る」に変更。URL `/notices?open={noticeId}` で該当周知を自動展開＋スクロール
- **投稿のID取得**: insert と select を分離（`.single()` はRLSで失敗）。ID取得失敗時は `/notices` にフォールバック
- 投稿アクション全体を try/catch で保護（未補足例外でクライアントが「This page couldn't load」になるのを防止）

### 前の作業（休憩室：定員制チェックイン機能）

#### 打刻端末 `/punch/[projectId]` に「休憩室」タブ追加
- **箱方式**: 定員数分の番号付き箱。空き箱タップ→休憩中スタッフから自分の名前を選択して入室。使用中の箱タップ→退室確認→退室
- **入室条件**: ステータスが休憩中（break_start進行中・未退勤）のみ。`enterBreakRoomAction` がサーバー側でも検証
- **自動退室（全break_end経路に実装済み）**:
  - `seating/punch-actions.ts`: breakEndAction / clockOutAction / earlyLeaveAction / breakResetAction
  - `seating/actions.ts`: toggleBreakAction
  - `punch/[projectId]/actions.ts`: terminalBreakAction（終了時）/ terminalPunchAction（clock_out時）
  - `(portal)/punch/actions.ts`: recordPunchAction（break_end / clock_out時）
  - 共通ヘルパー: `src/lib/break-room.ts` の `releaseBreakRoomBox(admin, projectId, staffId, date)`
- **タブバッジ**: 「休憩室 3/6」で使用数/定員表示（満室=赤）。占有箱に経過時間タイマー
- **ポーリング**: `/api/punch/[projectId]/statuses` のレスポンスを `{ statuses: [...], breakRoom: { capacity, uses } }` に変更（休憩室同梱）
- **管理者ビュー**: `/seating` ツールバー「休憩室」ボタン → パネルで占有状況・強制解放・定員変更（SeatingClient、isAdminのみ）
- **本人スマホ退室**: `/dashboard` に入室中のみカード表示＋「退室する」ボタン（`leaveMyBreakRoomAction`＝セッションからstaffId導出）
- **設備情報**: `break_room_settings.amenities`（jsonb `[{label, ok}]`・最大12件）。端末休憩室タブに○×表示、管理者は/seatingパネルで編集。statuses APIの breakRoom にも同梱
- **キャラクター108体**: 定義は `src/lib/rpg-chars.ts`（id=char-{id}.png と一致）。職業・モンスター・魔人など。`staffs.rpg_character` で本人選択（null=ハッシュ自動割当）。myページ（/dashboard）の「マイキャラクター」カードから変更可（`setMyRpgCharacterAction`）。新キャラ追加手順: ChatGPTで4列×3行シート生成 → `scripts/split-rpg-sheet.ps1`（$env:SHEET/STARTIDX/COLS/ROWS）で分割 → rpg-chars.ts にラベル追記
- サーバーアクション: `seating/break-room-actions.ts`（get/enter/leave/leaveMy/forceRelease/setCapacity/setAmenities）
- **ワールドマップ**: 端末休憩室タブ「▶ちずをみる」→ モーダルで休憩室への道のり表示。画像は `public/rpg/world-map.png`（ChatGPT生成のドラクエ風・1086×1448）にRPGウィンドウのラベルを%指定でオーバーレイ（`WorldMap` in TerminalPunchClient.tsx。旧SVG版は `WorldMapSvgLegacy` として未使用で残置）
- **操作マニュアルPDF**: `docs/休憩室操作マニュアル.pdf`（A4・1枚・スタッフ向け）。生成元は `docs/manual-build/manual.html` → Edge headless `--headless=new --print-to-pdf` で再生成可。マップ画像・キャラ画像は同フォルダにコピー済み

#### 新規DBテーブル（Supabaseマイグレーション実行済み: create_break_room_tables）
- `break_room_settings(project_id PK, capacity default 6)` — 定員（管理者が可変）
- `break_room_uses(project_id, staff_id, use_date, box_number, entered_at)` — 入室中のみ行が存在
  - UNIQUE(project_id, use_date, box_number)・UNIQUE(project_id, use_date, staff_id)

### 前の作業（打刻ルール・シフト管理スクロール・UI改修）

#### 打刻ルール全面実装（端末・座席打刻 両対応）
- **出勤**: シフト開始前→シフト開始時刻に補正 / シフト開始後→遅刻＋15分切り上げ
- **退勤**: 常に「早退 / 定時 / 残業」の3択選択式（自動判定廃止）
  - 早退: 打刻時刻を15分切り下げ、承認SV名必須
  - 定時: シフト終了時刻
  - 残業: 実打刻時刻そのまま、承認SV名必須
- **note記録**: 全打刻で `punch_logs.note` に `出勤打刻: HH:MM` / `退勤打刻: HH:MM  早退承認者: XX` 形式で記録
- **勤怠実績備考列**: `AttendanceEditClient` が `clockInNote`/`clockOutNote` を表示するよう対応
- **`earlyLeaveAction` 廃止**: `clockOutAction(mode="early_leave")` に統合
- **残業記録時刻修正**: 残業は実打刻時刻（以前は15分切り下げで誤り）

#### シフト管理ページのスクロール改修
- **AppNav**: `isNoScrollPage` のコンテンツdivを `overflow-hidden` → `overflow-y-auto` に変更してページスクロールを有効化
- **ツールバー sticky化**: ShiftManageClient のツールバーを `sticky z-40` に変更し月ナビ・ボタンが常時表示
- **z-index階層**: データ左固定列z-20 < ShiftDayList内ヘッダーz-30 < ツールバーz-40 < ページヘッダーz-50
- **ShiftDayList split container**: `height: calc(100dvh-...)` 固定値を廃止し縦は全件表示 (`overflow-x-auto` のみに変更)
- **CSS変数 `--toolbar-h`**: ツールバー高さをShiftDayList内ヘッダーの `top` 位置計算に使用

#### シフト編集の日付ソート・フィルターポップオーバー（新機能）
- 日付ヘッダーをクリック → ポップオーバー表示
- **ソート**: セクション順 / シフト順（開始時刻）
- **フィルター（複数選択）**: セクション × シフト名
- アンバーハイライト（▼）でフィルター有効を表示
- 充足テーブルのヘッダーからも操作可能

#### 問い合わせページ改修
- **履歴モバイル表示**: `hidden lg:flex` だった履歴パネルをモバイルではフォームの下に追加表示
- **LINE返信全文表示**: `inquiry_reply` 通知の80文字制限を撤廃し全文送信

### 前の作業（出勤簿・シフト管理の多機能改修）

#### 出勤簿（`/attendance`）
- **人数カウント変更**: `totalAssigned`（配置数）→ `totalClockedIn`（出勤中）をメインカウントに変更。充足も出勤中ベースで計算
- **退勤済スタッフ非表示**: `clocked_out` ステータスのカードをボードから非表示
- **スクロール修正**: 内部スクロールコンテナに `touch-action: pan-y` 追加
- **お休みスタッフパネル追加**: 公休・有休スタッフを横スクロール末尾に表示。「打診」ボタン（LINE送信）と「不可」トグルボタン付き
- **打診不可マーク**: `work_request_declines` テーブル新設。管理者が手動で不可マーク → 赤バッジ表示

#### シフト管理（`/shifts/manage`）
- **非編集モードスクロール修正**: `overflow-y-auto flex-1 min-h-0` 追加でデスクトップでもスクロール可能に
- **個別スタッフシフト公開/非公開**: 各スタッフ行に「公開/非公」トグルボタン追加。`project_members.shift_published` カラム（DBマイグレーション済）で管理。`publishShiftsAction` が `shift_published=false` のスタッフを除外
- **シフト編集モードの日付ソート**: 日付列ヘッダーをクリック → その日のシフト開始時刻順にスタッフ行をソート（再クリックで解除・アンバーハイライト）

#### メンバー管理
- **稼働日数「スポット」追加**: `StaffInfoPanel`・`SettingsClient` に「未設定/月/週/スポット」の選択肢追加。スポットは仮組み対象外（`draft-actions.ts` で除外）

#### 新規DBテーブル・カラム（Supabase実行済み）
- `work_request_declines(project_id, staff_id, date, marked_by, marked_at)` - 打診不可マーク
- `project_members.shift_published boolean default true` - 個別シフト公開フラグ

### 前の作業（勤怠管理メニュー全面改修）

#### `/attendance/edit` を「勤怠管理」に4タブ改修
- **ナビラベル変更**: 「勤怠実績」→「勤怠管理」
- **`/attendance/corrections` 廃止**: 管理者向け補正申請審査を `/attendance/edit` に統合
- **スタッフ側 `/corrections` の管理ボタン**: `/corrections/manage` → `/attendance/edit?tab=corrections` に変更

**タブ構成:**

| タブ | 内容 |
|------|------|
| 勤怠修正 | `punch_corrections`（staff申請の打刻修正）一覧。承認/却下モーダル。承認済みに「再適用」ボタン |
| 申請一覧 | `work_exception_requests`（早退・残業申請）一覧。早退/残業フィルタ |
| 勤怠実績 | スタッフ一覧→クリックで当月全日カレンダー詳細（公休・希望休含む）。月移動・出力・打刻修正モーダル・確定ボタン |
| 遵守率 | 既存のWorkRecordsClient |

**バグ修正（重要）:**
- `punch_corrections` の `staffs` FK join がDB未定義の場合に全件 null になっていた → memberMap による名前解決に変更
- 打刻修正申請の承認時に `corrected_in/out` が `"HH:MM:SS"` で返るのに `:00` を追加 → `"HH:MM:SS:00+09:00"` という不正タイムスタンプになり insert が無音で失敗していた → `.slice(0,5)` で正規化
- `corrections/actions.ts` にも同じタイムスタンプバグがあり修正済み

**新機能:**
- 管理者が打刻を直接修正すると `punch_logs.note = "管理者修正:staffId"` を記録 → 備考欄に修正者名を表示
- `work_exception_requests.signer_name` を `punch_corrections` とクロス参照して SV承認者列に表示
- `reapplyCorrectionAction`: 承認済み申請を再適用（タイムスタンプバグで未反映だったデータを修正できる）
- 勤怠実績詳細: `allShiftMap` で公休・希望休含む全シフトを表示、当月全日付カレンダー生成
- 勤怠実績詳細: `staffId` を URL に保持し月移動してもスタッフ選択を維持

### 前の作業（バグ修正）

#### シフト管理 充足テーブル日付ずれ修正
- **ShiftDayList（シフトタブ）**: 充足テーブルの左固定列が90pxでヘッダー（番号72+氏名88=160px）と不一致 → `w-[160px]` に修正。日付列幅も `w-[50px]`→`w-11`(44px) に統一
- **ShiftEditGrid（編集モード）**: 充足行ラベル`<td>`に `colSpan={2}` が無くNAME_W(88px)列がprevDate[0]に吸収→全日付列が1列ずれていた。ラベルセルに `colSpan={2}` 追加（3箇所：通常行・SV合計行・全体合計行）
- **ShiftEditGrid スクロール同期**: `showSummaryRows` ON時にstaffPaneのscrollLeftを同期するuseEffect追加

#### シフト編集モード 稼働日数合計バグ修正
- `monthTotal` が `patternNameSet`（登録済みパターンのみ）でカウントしていたため研修等の特殊シフトが未計上
- 「公休・希望休・有休・特別休暇」以外を全て稼働日としてカウントするよう変更（ShiftEditGrid.tsx）

#### LINE連携エラーハンドリング改善
- `getRedirectUri()` のフォールバックを `http://localhost:3000` → `https://raq-portal-app.vercel.app` に修正
- mode=link のエラー時は `/login` ではなく `/link-line?error=...` にリダイレクトするよう変更
- セッション切れの場合は `/login?next=/link-line` に誘導
- `/link-line` ページにエラーメッセージ表示を追加（searchParams対応）

#### LINE連携 未解決事項（川島さん S069）
- `line_user_id=null, line_friend=null` → IDPW ログイン → LINE連携ボタン押下 → line_failed エラー
- URL設定は正常（NEXT_PUBLIC_BASE_URL = LINE Developer ConsoleのCallback URL と一致）
- **要確認**: LINE Login チャネルが「Developing」ステータスのままで未公開の可能性。Developingの場合はチャネルメンバー以外はOAuth不可

### 前の作業（UI/UXリファクタリング）

#### 当日状況 `/attendance` タブ構成変更
- **タブ名変更**: 「休憩管理」→「打刻記録」
- **DateNav をstickyヘッダーに統合**: 全タブで日付ナビが常時表示。出力ボタンも同行（出勤簿タブのみ）
- **ページスクロール廃止**: `h-dvh flex flex-col overflow-hidden` 構造に変更。ヘッダーは `shrink-0`、コンテンツは `flex-1 min-h-0`
  - 出勤簿: `overflow-hidden`（列カードが内部スクロール）
  - 座席表: 専用 `flex-1 min-h-0 overflow-hidden` コンテナ（SeatingClient が h-full で充填）
  - 確定後変更・打刻記録: `overflow-y-auto`（コンテンツ長に応じてスクロール）
- **打刻タイムライン行に小休憩分数セレクタ追加**: 査定・販売セクションのスタッフ行に「小休憩なし/10分/15分/20分/30分」ドロップダウン（`break_short_settings` に保存）

#### 座席表 `/seating` 改善
- **「休憩一覧」ボタン追加**: ツールバーに追加。押すとスロット×査定/販売×早番/遅番 の人数・名前一覧パネルをトグル表示
  - データは `seats`（shiftName含む）＋ `breakAssignmentMap` から `useMemo` で計算
  - embedded / standalone 両方のツールバーに存在
- **未配置パネル高さ修正**: `maxHeight` を `embedded ? calc(100dvh-320px) : calc(100dvh-270px)` に
- **ページスクロール廃止**: SeatingClient も `h-dvh flex flex-col overflow-hidden`（standalone）/ `h-full flex flex-col overflow-hidden`（embedded）に変更

#### 以前の作業（座席表・打刻機能の大幅実装）
- 出勤簿セクションヘッダーを「配置/規定（充足）出 遅 欠 未」形式に改訂
- 名前カードを2列グリッドレイアウトに再設計（AccNum自動整列）
- 複数セクションバッジ表示（project_members.sections[]対応）
- Excel出力フォーマット変更：セクション横並び1シート＋色分け（exceljs使用）
- サマリーカード（出勤/遅刻/欠勤）削除
- 打刻タイムライン（PunchTimelineSection.tsx）：出勤〜休憩〜離席〜退勤を横棒ガントで表示
  - スタッフ行に休憩スロット変更ドロップダウン（査定・販売のみ）＋小休憩分数セレクタ

#### 座席表の全面改修
- **打刻モーダル**（PunchModal.tsx 新規）: 全状態遷移対応
  - 出勤/退勤/離席/着席/休憩/小休憩/休憩リセット
  - 退勤: 早退判定（11分前以上）→ SV署名 → work_exception_requests送信
  - 退勤: 残業判定（終了後）→ 定時補正 or 残業申請
  - 休憩タイマー・残り時間・超過アラート表示
  - 管理者のみ: 休憩パターン(スロット)変更▼・休憩時間変更▼
- **未配置スタッフ右パネル**: 常時表示、編集モードでドラッグ配置
- **ドラッグパン**: マウス・タッチでキャンバス移動（PointerEvents API）
- **座席カード再設計**: ヘッダー（セクション色）＋ボディ（ステータス色）
  - 勤務=緑, 休憩=橙, 超過=赤, 離席=グレー, 退勤=濃グレー
  - 休憩中/離席中はカード上に経過時間タイマー表示
- **seat_leaveステータス追加**: punch_logs に seat_leave/seat_return タイプ

#### 新規DBテーブル（Supabase実行済み）
- `work_exception_requests`: 早退・残業申請（request_type: early_leave/overtime）
- `staff_break_overrides`: スタッフ別当日休憩時間設定（project_id/staff_id/date/regular_minutes/short_minutes）

#### 新規サーバーアクション（seating/punch-actions.ts）
- clockInAction, clockOutAction, earlyLeaveAction
- seatLeaveAction, seatReturnAction
- breakStartAction, breakEndAction, breakResetAction
- getBreakDurationAction（スロット時間幅からも自動計算）
- setBreakDurationAction, setBreakSlotAction
- getBreakSlotAssignmentAction（`.limit(1)`使用・重複対策）
- getStaffPunchSummaryAction

#### 動作確認済み（バグ修正完了）
- 休憩パターン未割当バグ修正：`.maybeSingle()`→`.limit(1)`、AttendanceClient→SeatingClientへbreakSlots伝達
- 非出勤スタッフが座席配置時にオレンジ破線＋「!」バッジで警告
- 座席カードのヘッダー高さ・シフト表示を調整
- `break_slot_assignments` にUNIQUE制約(project_id,staff_id,assignment_date)追加済
- 出勤簿の欠勤/遅刻手動設定が更新後に消える問題修正（upsert失敗→存在チェック+insert、reasonにNOT NULL対応値）
- 座席表をネイティブ横スクロール+ドラッグパン併用に変更

### 次に着手できるタスク
- 勤怠管理「申請一覧」タブに承認/却下フロー追加（work_exception_requests は現状 view-only）
- 勤怠実績出力（個人・会社・期間別 Excel/PDF 出力）の実装
- 承認済み補正申請の再適用ボタン: タイムスタンプバグで未反映のデータは手動で「再適用」を押す必要がある

---

## 開発前チェックリスト

新しいページ・機能を実装するとき、必ずこれを確認する：

- [ ] ページは `src/app/(portal)/` 配下に作っているか
- [ ] `getCurrentProjectId()` で projectId を取得し、全クエリに `.eq("project_id", projectId)` しているか
- [ ] `searchParams` を `await` しているか（Next.js 15+ の破壊的変更）
- [ ] 日時処理は `src/lib/datetime.ts` のJST関数を使っているか（`toLocaleDateString()` 禁止）
- [ ] LINE通知は `sendEventNotify()` 経由か（直接 `pushLine()` を呼ばない）
- [ ] Service Role が必要な処理は `createAdminClient()` を使っているか
- [ ] `createAdminClient()` をクライアントコンポーネントからimportしていないか
- [ ] 新テーブルにRLSを設定したか（`current_staff_id()` / `is_project_admin()` ヘルパー使用）
- [ ] `"use server"` ファイルから非async関数をexportしていないか
- [ ] 管理者ビューがUIに影響するページで `rqp-view-mode` Cookie を読んでいるか
- [ ] ダークモード `dark:` クラスをペアで指定しているか

---

## よく使うコードパターン

### 案件コンテキスト取得（全ページ必須）
```typescript
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

const projectId = await getCurrentProjectId();
if (!projectId) redirect("/select-project");
```

### ログインユーザーの社員ID取得
```typescript
const { data: { user } } = await supabase.auth.getUser();
const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
// "s001@raq.internal" → "S001"
```

### searchParams の受け取り（Next.js 15+）
```typescript
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
}
```

### LINE通知送信
```typescript
import { sendEventNotify } from "@/lib/notify";

// スタッフ個人へ
await sendEventNotify(projectId, "absence", { name: "山田" }, staffId);

// 全スタッフへ
await sendEventNotify(projectId, "announcement", { title: "..." });

// ボタン付き
await sendEventNotify(projectId, "absence_followup_remind", vars, staffId, {
  label: "経過報告する",
  url: `${process.env.NEXT_PUBLIC_BASE_URL}/absence-followup`,
});
```

### RLSバイパス（サーバーサイドのみ）
```typescript
import { createAdminClient } from "@/lib/supabase/admin";
const admin = createAdminClient(); // クライアントコンポーネントからimport禁止
```

### 視点モード分岐
```typescript
import { cookies } from "next/headers";
const viewMode = (await cookies()).get("rqp-view-mode")?.value ?? "staff";
const isAdmin = viewMode !== "staff" && /* ロールチェック */;
```

---

## 地雷・バグ注意事項

| 注意点 | 理由 |
|--------|------|
| `searchParams` を await しないと型エラー | Next.js 15+ で Promise に変更された |
| `"use server"` ファイルから非async関数をexport禁止 | ビルドエラーになる。型・定数は別ファイルに分離 |
| `toLocaleDateString()` 禁止 | ブラウザロケール依存でJSTにならない |
| `multicastLine()` はボタン非対応 | ボタン付きは個別 `pushLineWithButton()` を使う |
| `createAdminClient()` はサーバーのみ | クライアントコンポーネントにimportするとSecretが露出 |
| AvatarSvg.tsx は触らない | SVGパスが未実装。骨格だけ存在する |
| シフト日付はUTC生成でもJST表示 | `new Date(d)` + UTCメソッドで処理（サーバーがUTCでも正しく表示） |
| `holiday_open_notify` は毎月1日ではない | `holiday_rules.open_day` の日に発火。未設定なら発火しない |
| `punch_logs.punch_type` の追加タイプ | `seat_leave`/`seat_return`（離席追跡）。CHECK制約を更新済み |
| `"use server"` ファイルに同期関数エクスポート禁止 | `judgeClockOut` をpunch-actions.tsから分離した経緯あり |
| 休憩時間はスロット時間幅から自動計算 | `getBreakDurationAction`: オーバーライド→スロット幅→デフォルト(60/15)の優先順 |
| `break_slot_assignments` は `.maybeSingle()` 禁止 | 複数行ヒット時にnullを返す。`.limit(1)` を使う。UNIQUE(project_id,staff_id,assignment_date) 制約済 |
| 埋め込みSeatingClientには `breakSlots` を必ず渡す | AttendanceClient→SeatingClientで渡し忘れると休憩パターンの選択肢が空になる |
| `absence_reports`/`late_reports` の `reason` はNOT NULL | 手動欠勤/遅刻設定時は `reason: "管理者設定"` を入れる。`null` で制約違反 |
| `upsert` の `onConflict` 指定は制約が必要 | DBにUNIQUE制約が無いと失敗。errorチェック無しだと成功扱いになり保存されない。存在チェック→insert方式が安全 |
| 座席表キャンバスはネイティブスクロール+ドラッグパン併用 | `overflow-auto`コンテナ+`scrollRef`でドラッグ時に`scrollLeft/scrollTop`を操作（transform方式から変更） |
| ページ固定レイアウトは `h-dvh flex flex-col overflow-hidden` | `min-h-screen` + `sticky` の組み合わせは全体スクロールが発生する。固定ページは main を `h-dvh flex flex-col`、ヘッダーは `shrink-0`、コンテンツは `flex-1 min-h-0` にする |
| embedded SeatingClient は `h-full flex flex-col` が必須 | 親コンテナが `flex-1 min-h-0` でも SeatingClient が `min-h-screen` だと突き破ってスクロールが発生する |
| 打刻状態と勤怠ステータスは別軸（`note="admin_manual"`方式） | 出勤簿で手動「勤務中」にすると `clock_in` を `note="admin_manual"` 付きで作成。出勤簿は勤怠ステータス導出にこれを含めて「勤務中」を永続表示するが、打刻バッジ(realClockIn)とスタッフ用判定はadmin_manualを除外＝打刻状態は「打刻未」のままスタッフ本人が出勤打刻できる。**admin_manual除外が必要な箇所**: `seating/punch-actions.ts getStaffPunchSummaryAction`・`attendance/page.tsx realClockIn`・`punch/[projectId]/page.tsx clockedIn`・`api/punch/[projectId]/statuses/route.ts clockedIn`(打刻端末のポーリング上書き注意) |
| ShiftEditGrid 充足行は `colSpan={2}` 必須 | 充足tbody各行の左ラベル`<td>`はACCT_W+NAME_Wを合わせて `colSpan={2}` でスパンしないと、prevDate列がNAME_W(88px)列に入り全日付が1列ずれる |
| ShiftDayList 充足テーブルの左固定幅はヘッダーと合わせる | 充足テーブル左固定=番号(72)+氏名(88)=160px、日付列幅=w-11(44px) でなければscrollLeft同期しても列がずれる |
| ShiftEditGrid monthTotalはpatternNameSetで絞らない | `patternNameSet` でフィルタすると研修等の特殊シフトが稼働日数にカウントされない。「公休・希望休・有休・特別休暇」以外を全て稼働日とする |
| `punch_corrections` の staffs join は FK 未定義のため使用禁止 | FK が無いと query 全体が null を返す。`memberMap`（project_members から構築）で名前解決する |
| `punch_corrections.corrected_in/out` は `"HH:MM:SS"` 形式 | DB の time 型は秒付きで返る。`slice(0,5)` で `"HH:MM"` に正規化してから `:00+09:00` を付けること。二重付加すると無音 insert 失敗 |
| 管理者直接修正は `punch_logs.note = "管理者修正:staffId"` で記録 | `savePunchCorrectionAction` で note 付き insert。勤怠実績詳細の備考欄に修正者名として表示。staffId は memberMap で名前変換 |
| LINE連携 mode=link のエラーは `/link-line` に戻す | `/login?error=line_failed` に戻すと「LINEログイン失敗」と表示されてユーザーが混乱する。mode=link のエラーは `/link-line?error=...` にリダイレクト |
| `getRedirectUri()` のフォールバックは本番URL | `http://localhost:3000` がフォールバックだとVercelで `NEXT_PUBLIC_BASE_URL` 未設定時にLINEトークン交換失敗。`https://raq-portal-app.vercel.app` に修正済み |
| LINE Login チャネルが Developing だと一般スタッフはOAuth不可 | チャネルメンバー以外は認証できない。LINE Login を全スタッフに使わせるには Publish 必要 |
| 出勤簿カウントは `totalClockedIn`（出勤中のみ）| `totalAssigned`（配置数）から変更済み。充足表示も `出勤中 - 規定数` で計算 |
| `work_request_declines` テーブルで打診不可管理 | RLS: `is_project_admin` のみ操作可。UNIQUE(project_id, staff_id, date) |
| `project_members.shift_published` フラグ | デフォルト true。false のスタッフは `publishShiftsAction` で LINE 送信をスキップ |
| `work_days_type = "spot"` は仮組み対象外 | `draft-actions.ts` で `wdType === "spot"` の場合 `return false` で候補から除外 |
| `earlyLeaveAction` は廃止済み | `clockOutAction(mode="early_leave")` に統合。`PunchModal.tsx` も更新済み。インポートしないこと |
| シフト管理ページスクロールは AppNav の `overflow-y-auto` で実現 | AppNav content div の `md:overflow-hidden` → `md:overflow-y-auto` に変更済み。他のnoScrollPageにも影響するが内容がはみ出さなければスクロールバー非表示で問題なし |
| ShiftManageClient sticky ツールバーの top は `var(--page-header-h)` | `--page-header-h` = ページタイトル+タブの高さ。ShiftDayList内ヘッダーの top は `calc(--page-header-h + --toolbar-h)` を使う |
| `punch_logs.note` に実打刻時刻が記録される | 形式: `出勤打刻: HH:MM` / `退勤打刻: HH:MM  早退承認者: XX`。`"管理者修正:staffId"` とは別管理。備考列表示には `clockInNote`/`clockOutNote` フィールドを使う |
| 問い合わせLINE返信は全文送信 | `inquiry_reply` 通知の80文字制限を撤廃済み。再度制限を入れないこと |
| break_end を挿入する処理は休憩室の箱も解放すること | `releaseBreakRoomBox()`（lib/break-room.ts）を呼ばないと幽霊が箱に残る。新しい break_end / clock_out 経路を作るときは必ず追加 |
| `/api/punch/[projectId]/statuses` のレスポンスはオブジェクト形式 | `{ statuses: [...], breakRoom: {...} }`。以前は配列だった。端末クライアントの型と一致させること |
| 休憩室の定員超過はDBのUNIQUE制約で防止 | カウント方式は同時タップで競合する。箱番号UNIQUE(project_id,use_date,box_number)方式を維持。error.code 23505 を「箱が使用中」と表示 |
| insert直後のID取得に `.single()` 禁止 | RLSのSELECTポリシーが通らないとエラー。insertとselectを分離し、取れない場合のフォールバックを用意（周知投稿で発生済み） |
| Server Actions のアップロードは bodySizeLimit に注意 | Vercelデフォルト1MB。next.config.ts で `serverActions.bodySizeLimit: "10mb"` 設定済み。クライアント側でも10MB検証を入れる |
| Server Action は全体 try/catch で保護 | 未補足例外がクライアントで「This page couldn't load」クラッシュになる。catchしてエラーメッセージを返し console.error でVercelログに残す |
| 周知の添付は1周知1ファイル | `notices.attachment_url/attachment_name`＋`notice-attachments`バケット（public）。周知削除時にストレージも削除すること |

---

## 詳細ファイルインデックス

| 知りたいこと | 参照先 |
|-------------|--------|
| 機能仕様・業務ロジック | **SPEC.md** 該当セクション |
| DBテーブル設計・RLS | SPEC.md §7 → [db-tables.md](db-tables.md) |
| ページ一覧・ナビゲーション構造 | [routing-and-pages.md](routing-and-pages.md) |
| lib/ の関数シグネチャ | [lib-functions.md](lib-functions.md) |
| API Routes 一覧 | [api-routes-and-cron.md](api-routes-and-cron.md) |
| Cron 発火条件・時刻 | [api-routes-and-cron.md](api-routes-and-cron.md) |
| 通知キー一覧（有効・廃止） | [notification-settings-types.md](notification-settings-types.md) |
| 使えるアイコン名 | [icons.md](icons.md) |
| UIルール・デザインシステム | [dev-rules.md](dev-rules.md) |
| 環境変数一覧 | SPEC.md §9 |
| テストアカウント | SPEC.md §8 |

---

## MDの更新ルール

### いつ何を更新するか

| 作業内容 | 更新する全ファイル |
|---------|-----------------|
| 既存ページ・タブの機能を変更・追加した | `SPEC.md`（該当セクション） + `memory/MEMORY.md`（現在の状態） + `memory/routing-and-pages.md`（タブ名等変更時） |
| 新しいページを追加した | `SPEC.md`（新セクション追加） + `memory/routing-and-pages.md` + `memory/MEMORY.md`（現在の状態） |
| 新しいDBテーブルを作った | `SPEC.md §7` + `memory/db-tables.md` |
| lib/ に新しい関数を追加した | `memory/lib-functions.md` |
| 新しいAPI Routeを追加した | `memory/api-routes-and-cron.md` |
| Cronの処理・時刻を変えた | `memory/api-routes-and-cron.md` |
| 通知キーを追加・廃止した | `memory/notification-settings-types.md` + `SPEC.md §4-7` |
| 新しいアイコンを追加した | `memory/icons.md` |
| 新しいバグ・地雷を発見した | `memory/MEMORY.md`（地雷セクション） |
| UIレイアウト・設計パターンを変えた | `memory/MEMORY.md`（地雷セクション） + ユーザーメモリ `dev-rules.md` |
| 作業フェーズが完了した | `memory/MEMORY.md`（現在の開発状態） |

### 更新の原則

1. **SPEC.md が一次情報** — 機能仕様はSPEC.mdに書く。memory/ はSPECの場所案内と差分・注意事項のみ
2. **SPEC.mdとmemory/は必ずセットで更新** — SPECだけ・memoryだけの片方更新は次セッションで矛盾が起きる
3. **コードの実態を書く** — SPECに書いてあっても実装が違う場合はMEMORYが正
4. **廃止情報も残す** — 「使ってはいけないもの」は削除せず廃止済みとして明記する
5. **現在の開発状態は作業完了時に更新** — 次のAIセッションのために「今どこまで進んだか」を書く

### 更新しなくていいもの

- `SPEC.md` に書いてある内容と完全に同じ情報（memory/にコピー不要）
- 一時的なデバッグ情報・実験的な変更
- node_modules・ビルド成果物の情報

---

## SPEC.md クイックナビ

| 作業内容 | SPEC.md セクション |
|---------|------------------|
| スタッフ向け機能を触る | §3 スタッフメニュー |
| 管理者向け機能を触る | §4 管理メニュー |
| 通知・LINE連携を触る | §4-7, §6-2, §6-3 |
| 新テーブルを作る | §7 DBテーブル一覧 |
| Cron を追加・変更する | §6-3 |
| 環境変数を追加する | §9, §11 |
