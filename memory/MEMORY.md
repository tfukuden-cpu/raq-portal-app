# Raq Works 開発メモリ

> AIが作業を始める前に必ず読む。SPEC.md と合わせて使う。

---

## システム概要

合同会社Raqの社内ポータルPWA。Next.js 16 + Supabase + LINE通知。  
スタッフの勤怠・シフト・座席・通知を一元管理する多テナントシステム。

**開発スタイル:** バイブコーディング（JS/SQL未経験ユーザーがAIに指示して進める）

---

## 現在の開発状態（2026-06-04）

### 直近の作業（UI/UXリファクタリング）

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
- /attendance/edit に早退・残業申請タブ追加（承認UI）
- 勤怠申請の承認フロー完成

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

### いつ更新するか

| タイミング | 更新するファイル |
|-----------|----------------|
| 新しいページ・機能を追加した | `routing-and-pages.md` |
| 新しいDBテーブルを作った | `db-tables.md` + `SPEC.md §7` |
| lib/ に新しい関数を追加した | `lib-functions.md` |
| 新しいAPI Routeを追加した | `api-routes-and-cron.md` |
| Cronの処理・時刻を変えた | `api-routes-and-cron.md` |
| 通知キーを追加・廃止した | `notification-settings-types.md` + `SPEC.md §4-7` |
| 新しいアイコンを追加した | `icons.md` |
| 新しいバグ注意点が見つかった | `MEMORY.md`（地雷セクション）|
| 作業フェーズが変わった | `MEMORY.md`（現在の開発状態）|
| 仕様が変わった | `SPEC.md` を先に更新、MEMORYは差分のみ |

### 更新の原則

1. **SPECとの重複は避ける** — 仕様の詳細はSPEC.mdに書く。ここは「どこを見るか」の案内役
2. **コードの実態を書く** — SPECに書いてあっても実装が違う場合はMEMORYが正
3. **廃止情報も残す** — 「使ってはいけないもの」は削除せず廃止済みとして明記する
4. **現在の開発状態は作業完了時に更新** — 次のAIセッションのために「今どこまで進んだか」を書く

### 更新しなくていいもの

- `SPEC.md` に書いてある内容と完全に同じ情報（コピー不要）
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
