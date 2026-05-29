# Raq 社内ポータル PWA — 引継ぎ資料

最終更新：2026-05-29（v52：シフト管理番号順ビュー強化・スタッフ向けシフトカレンダーUI刷新）

---

## 1. プロジェクト概要

合同会社Raq の社内ポータルを **GAS（Google Apps Script）Webアプリ** から
**Next.js + Supabase 製の PWA** へ全面移行するプロジェクト。

| 項目 | 値 |
|---|---|
| 利用人数 | 約100人 |
| 案件数 | 10〜20案件（マルチテナント） |
| 兼務 | あり（1人が複数案件に所属） |
| LINE通知 | 案件ごとに別グループへ通知 |
| 配布方法 | PWA（ホーム画面追加・iOS/Android両対応） |
| 月額予算 | できるだけ安く（$0/月目標） |
| 開発体制 | 1人（バイブコーディング・JS/SQL未経験） |

---

## 2. 技術スタック

```
Next.js 15+ (App Router) + TypeScript
Tailwind CSS v4 (@import "tailwindcss", class-based dark mode)
Supabase (PostgreSQL + Auth + RLS)
Vercel（ホスティング・Cron Jobs）
```

### 認証方式：合成メール方式
ユーザーは **社員ID（例：S001）＋パスワード** でログイン。
内部で `s001@raq.internal` という合成メアドに変換して Supabase Auth へ。

### 案件コンテキスト
Cookie `rqp_project_id`（HTTPOnly・30日）に現在選択中の案件IDを保持。
- 1案件のみ → 自動セット
- 複数案件 → `/select-project` で選択

---

## 3. 現在の開発フェーズと方向性

### ⚠️ v15 大規模仕様変更（2026-05-16 決定）

以下の変更が決定した。実装はフェーズ別に進める（セクション13参照）。

| # | 変更内容 | フェーズ |
|---|---|---|
| 1 | 打刻メニューを廃止し、現場端末専用打刻ページを新設 | Phase 1 |
| 2 | 出発報告のON/OFFを案件設定で切り替え可能にする | Phase 1 |
| 3 | シフトパターンの必要枠数を日別設定（曜日ごと or 日付ごと）に変更 | Phase 2 |
| 4 | シフト仮組をアプリ内で実行（スプシ不要）・希望休・稼働設定を考慮 | Phase 2 |
| 5 | シフト編集モードの新設（ドラッグ移動・追加・削除・スワップ） | Phase 2 |
| 6 | まとめてシフト依頼をLINEで送信（複数日・変更依頼対応） | Phase 2 |
| 7 | スタッフカードタップ→メンバー設定へジャンプ・離脱処理 | Phase 3 |
| 8 | 案件ごとのスタッフ稼働設定・シフト設定（メンバー設定内） | Phase 3 |
| 9 | 仮組時に稼働設定・シフト設定を反映 | Phase 3 |

---

### 現状（v15時点）
GASからの移行を進めており、**コア機能はほぼ揃った状態**。
実際の案件・スタッフで使い始めている段階。

| カテゴリ | 状態 |
|---|---|
| 認証（社員ID＋パスワード＋LINE連携） | ✅ 完成 |
| 打刻・勤怠実績 | ✅ 完成 |
| シフト表示・希望休申請 | ✅ 完成 |
| 管理者シフト管理（セクションフィルタ含む） | ✅ 完成 |
| 周知・投稿 | ✅ 完成 |
| 問い合わせ（スタッフ↔管理者） | ✅ 完成 |
| LINE通知（イベント系） | ✅ 完成・動作確認済み |
| LINE通知（定時スケジュール） | 🔄 実装済み・本番テスト未 |
| LINEグループ連携 | ✅ 完成 |
| セクション管理（IDOM案件対応） | ✅ 完成（v11新設） |
| CSV一括登録（IDOM形式・重複スキップ） | ✅ 完成（v11更新） |
| **Google Sheets連携** | ✅ 完成（OAuth2認証、本番動作中） |
| 希望休ルール適用（バリデーション） | ✅ 完成 |
| 当日状況 ステータス手動変更 | ✅ 完成（v13新設） |
| 勤怠修正 カードUI・直接編集 | ✅ 完成（v13改善） |
| **打刻専用ページ（現場端末）** | ✅ 完成（v16） |
| **当月初回同意書確認（氏名入力・履歴閲覧）** | ✅ 完成（v16） |
| **出発報告ON/OFF設定** | ✅ 完成（v17） |
| **打刻時刻自動丸め（定時/遅刻/早退/残業）** | ✅ 完成（v18） |
| **シフト編集モード（ドラッグ）** | ✅ 完成（v19〜v20） |
| **シフト仮組（アプリ内）** | ✅ 完成（v21） |
| **まとめてシフト変更LINE通知（グリッド確定時）** | ✅ 完成（v20） |
| **メンバー設定拡充（備考・稼働日数・複数セクション・勤怠順守率）** | ✅ 完成（v21） |
| **スタッフカードタップ→メンバー設定・離脱処理（全メニュー共通）** | ✅ 完成（v22） |
| **スタッフ稼働設定・シフト設定（仮組反映）** | ✅ 完成（v23） |
| **ナビ再構成（ロール別メニュー統合・DevBanner廃止）** | ✅ 完成（v24） |
| **当日状況UI改善（サマリーカード・シフト時刻表示・出発報告OFF対応）** | ✅ 完成（v24） |
| **希望休タブUI刷新（申請一覧→取り下げ・申請月制限）** | ✅ 完成（v25） |
| **ページ整理・Myページ統合・ダッシュボードシフトリンク** | ✅ 完成（v26） |
| **LINE連携必須化・なりすまし防止・LINEブロック検知** | ✅ 完成（v27） |
| **欠勤経過報告・シフト展開通知・変更ログ表示** | ✅ 完成（v27） |
| **確定後変更タブ（当日状況）** | ✅ 完成（v31） |
| **座席表（当日・翌日配置・レイアウト設定）** | ✅ 完成（v32）／専用ページ（/seating）＋当日状況タブ（v48で復活）。スタッフナビからは削除 |
| **座席エディタ強化（壁描画・パン・グリッドスナップ0.5刻み・複製・重なり防止）** | ✅ 完成（v33） |
| **座席フリー席・無効席対応** | ✅ 完成（v39） |
| スタッフ向け勤怠実績PDF出力 | ➖ 不要（決定） |
| アバターシステム | 🔄 設計済み・パーツ未実装（低優先） |

### 次に優先すべきこと（新しいセッションはここから）

**v52 完了内容**
- **シフト管理：番号順ビュー（ShiftDayList）強化**
  - `sortByAccount=true` 時にスタッフ行ビュー（行=スタッフ、列=日付）を新設。従来はパターン軸のままでトグルが機能していなかった
  - セル背景をセクション×早番/遅番で色分け（管理ビュー ShiftEditGrid と同一体系）
  - シフト名略称を3文字表示（「販売早番」→「販早」等）で早番/遅番を区別可能に
  - 右端に月間出勤日数列を追加
  - `upsertSingleShiftAction` を追加：番号順ビューの空セルをクリック→公休をセット（ホバーで「休」ボタン表示）
- **スタッフ向けシフトカレンダー（ShiftCalendar）UI刷新**
  - セル背景をセクション×早番/遅番で色分け（販売=オレンジ、査定=緑、SV=青 等、管理ビューと統一）
  - シフト名フルネームをセル内に表示（`clamp(8px, 3.2vw, 12px)` でセル幅に比例してリサイズ）
  - 下部詳細パネルを廃止、日付タップ→ボトムシート形式モーダルに変更
  - モーダル：ヘッダーに「日付 ｜ シフト名」（シフト色背景）、ボディに開始〜終了時間を大きく表示
  - 変更履歴もモーダル内に統合

**v51 完了内容**
- **勤怠実績：シフトクエリのページネーション対応**
  - Supabase PostgREST はデフォルト1回1000行上限。P001の5月シフトは3209行あり先頭約8日分しか返っていなかった
  - `work-record-actions.ts` に `fetchAllShifts()` / `fetchAllPunches()` を追加し、1000行ずつページネーションして全件取得
  - 期間設定後も全スタッフ・全日付のデータが正しく表示されるようになった

**v50 完了内容**
- **勤怠実績：名前検索バグ修正・スタッフ詳細モーダル追加・CSVエクスポート**
  - 名前検索：`filtered.length > 5` → `staffList.length > 5` に修正（検索中に入力欄が消えるバグ修正）
  - スタッフ行をボタン化：クリックで設定期間の全実績をモーダル表示
  - モーダル内容：スタッフ名・アカウント番号・セクション・サマリーチップ・日別実績（シフト名・打刻時刻・ステータス）
  - モーダルフッターに「Excelエクスポート」ボタン追加 → `勤怠実績_{名前}_{開始日}_{終了日}.csv` でダウンロード
  - `AttendanceSummarySection.tsx` を全面書き直し

**v49 完了内容**
- **シフト管理 研修設定タブをセッション単位UIに全面刷新**
  - DB: `staff_trainings` に `project_id`・`batch_id` カラム追加
  - 研修追加フォーム：種類選択（導入研修/案件研修/その他）・複数日カレンダー・時間・複数スタッフ選択
  - 研修リスト：セッション単位で名前・日付チップ・スタッフ名を表示・削除可
  - 追加時に当月グリッドドラフトへ即時反映
  - `training-session-actions.ts` 新規作成（fetch/create/delete）

**v48 完了内容**
- **離脱リスク表示ラベル整理**
  - StaffInfoPanel の「充足カウントから除外中」→「離脱リスクあり」、「通常カウント対象」→「離脱リスクなし」に変更
  - メンバー管理（SettingsClient）のチェックボックス説明文を「ONにすると充足カウント除外・グリッドに赤枠表示」に更新
  - メンバー管理リストに「離脱リスク」バッジを追加（churn_risk=true かつ非退職スタッフ）
- **シフトグリッド 離脱リスクセル表示改善**
  - 離脱リスク対象日のセルを2行表示（シフト名 ＋「【離脱リスク】」小テキスト）＋赤い枠線（`ring-inset ring-1 ring-red-400`）
  - 名前セル背景を薄い赤（`bg-red-50`）に変更
  - 名前セルに「離脱リスク」バッジを表示
  - 凡例を更新（オレンジドット廃止・赤枠凡例追加）
- **離脱リスクトグルのリアルタイム反映**
  - `churnRiskOverrides` Map state を ShiftEditGrid に追加
  - StaffInfoPanel に `onChurnRiskChanged` コールバック追加、toggle 成功時に親の override を更新
  - 離脱リスク変更後にページリロードなしでグリッドに即反映
- **当日状況に座席表タブ復活（当日座席・翌日配置のサブタブ付き）**
  - v45で削除した座席表タブを「座席表」として復活（3つ目のタブ）
  - タブ内に「当日座席」「翌日配置」サブタブを配置
  - `attendance/page.tsx`：seats・当日/翌日 seat_assignments・seat_walls・翌日 shifts を並列フェッチし SeatData/PlanSeat/PlanStaff を生成
  - `AttendanceClient.tsx`：Props 追加、サブタブ UI、`SeatingClient embedded`・`SeatingPlanClient embedded` で描画
- **スタッフナビから座席表を削除**
  - `layout.tsx` の STAFF_ITEMS から `/seating`（座席表）を削除
  - 座席表は当日状況ページ（管理者・運用者）から参照。スタッフ向け独立ページは不要

**v47 完了内容**
- **離脱リスク機能** 連続欠勤3日以上のスタッフを管理者に通知し、シフト充足から除外する
  - `project_members.churn_risk boolean DEFAULT false` カラム追加
  - `/attendance`（当日状況）に離脱リスク候補アラートバナーを追加（同一スタッフの連続欠勤3日以上を検知）
  - スタッフ詳細設定モーダルに「離脱リスク」トグル追加（手動ON/OFF）
  - フラグONのスタッフはシフト名に「【離脱リスク】」を付記（例：販売遅番【離脱リスク】）
  - フラグONのスタッフはシフト充足カウントに含まない（ShiftEditGrid の充足行・充足サマリー両方）

**v46 完了内容**
- **仮確定を単一種類に統一** 枠確定（slot）の廃止。仮確定＝人確定（スタッフ固定・再仮組み時に他セクションから使用不可）の1種類のみ
  - 当初は「枠確定（スロット数固定）」「人確定（スタッフ固定）」の2種類で実装したが、枠確定の場合に他セクションへ移ったスタッフの代替補填が自動化できないため廃止
  - `slot_locked_sections text[]` カラムはDBに残存するが使用しない
- **シフトグリッド同時編集ロック機能** 複数アカウントで同時に編集した際の仮保存競合を防ぐ
  - `shift_grid_drafts` に `editing_by text`, `editing_at timestamptz` カラム追加
  - 編集画面を開くと自動的にロック取得を試みる（TTL: 5分）
  - 他のユーザーが編集中（ロック保持かつ5分以内）: 警告バナー表示、仮保存/再仮組み/確定ボタンを無効化
  - ハートビート: 3分ごとに `editing_at` を更新（タブが開いている間はロックを保持）
  - ロック切れ（5分以上ハートビートなし）: 自動的に取得可能になる（強制引き継ぎ）
  - 閉じる・確定時: ロックを自動解放
  - 「引き継ぐ」ボタン: ロック切れ時や手動引き継ぎ時に使用可

**v45 完了内容**
- **当日状況から座席表タブを削除** `/attendance` の「座席表」タブ（当日座席・翌日配置のサブタブ）を完全除去
- 座席表は `/seating` 専用ページで確認・席替えができるため、当日状況ページへの埋め込みは不要と判断
- `AttendanceClient.tsx` から SeatingClient・SeatingPlanClient のインポート・Props・描画コードをすべて削除
- `attendance/page.tsx` から seats・seat_assignments・seat_walls・tomorrowShifts の並列フェッチを削除（サーバー負荷軽減）
- タブは「当日シフト」「確定後変更」の2つのみに整理

**v44 完了内容**
- **打刻ページ：座席表UI追加** `/punch/[projectId]` に「座席表で打刻」「名前で打刻」のタブ切り替えを追加
- **座席タップ打刻** スタッフが自分の席をタップして出勤・退勤・休憩入り・休憩終了を打刻できる
- **座席ステータス色分け** 未出勤/勤務中/休憩中/退勤済/欠勤をステータスに応じて色分け表示
- **30秒ポーリング** 打刻端末は認証不要なため Realtime の代わりに `/api/punch/[projectId]/statuses` を30秒ごとにポーリングしてステータス更新
- **API route 新設** `GET /api/punch/[projectId]/statuses` — adminClient でその日の全スタッフのステータスを返す（認証不要）
- **席替えモード** 管理者が `/seating` の「席替え」ボタンをタップしてその場で今日の席割りを変更・保存できる
- **自動配置ボタン** 席替えモードに「自動配置」ボタンを追加（`autoAssignSeatsAction` を再利用）
- **Supabase Realtime** `/seating` ページで `punch_logs` の INSERT をリアルタイム購読し、座席ステータスを即時更新（`alter publication supabase_realtime add table punch_logs` 適用済み）
- **terminalBreakAction 追加** `actions.ts` に認証不要・adminClient の休憩打刻アクションを追加
- **TerminalMember 型拡張** `onBreak`, `isAbsent`, `section`, `accountNumber`, `hasShiftToday` フィールドを追加
- **変更ファイル** `src/app/punch/[projectId]/actions.ts`・`page.tsx`・`TerminalPunchClient.tsx`・`src/app/(portal)/seating/SeatingClient.tsx`・`seating/page.tsx`・`src/app/api/punch/[projectId]/statuses/route.ts`（新規）

**v43 完了内容**
- **Excel出力：列順変更** 名前 → アカウント番号 → 日付… の順に変更
- **Excel出力：アカウント番号形式** 常に `ASS 01`〜`ASS 160` 形式で出力（01-09はゼロ埋め）
- **Excel出力：アカウント番号なしメンバーを末尾追加** 番号未設定スタッフは名前＋シフトを一番下に追加
- **Excel出力：非セクションシフトを空白化** 公休・有休・研修・希望休・未アポコール等はセクション解決不能 → 常に空白。セクションフィルタ適用時は選択外セクションのシフトも空白
- **Excel出力：括弧を半角化** `査定（早番）` → `査定(早番)`（`seatColors.ts` の `formatSectionShift` を修正）
- **シフトグリッド：アカウント番号表示** `ShiftEditGrid.tsx` の `Member` 型に `accountNumber` 追加。名前セル下部にグレー小テキストでアカウント番号を表示
- **シフトグリッド：SV以外のアカウント番号順ソート** デフォルトでSV=名前順、SV以外=アカウント番号昇順（未設定は末尾）
- **並び順トグルボタン（管理画面ツールバー）** 「セクション順 ↔ 番号順」切り替えボタンをシフト管理ツールバーに追加。番号順モード時：SV上部固定（セクションヘッダー維持・名前順）、SV以外をアカウント番号順フラット表示（セクションヘッダー非表示）
- **並び順トグルボタン（編集グリッドツールバー）** ShiftEditGrid 内の「充足」ボタン隣に独立した切り替えボタンを追加。props の初期値を引き継ぎ、編集モード中に独立して切り替え可能

**v42 完了内容**
- **座席表：壁表示**  `seat_walls` テーブルのデータを `SeatingClient` / `SeatingPlanClient` に渡し SVG オーバーレイで描画（`%` 座標文字列・viewBox なし）。`attendance/page.tsx` と `attendance/AttendanceClient.tsx` にも反映
- **座席表：スクロール対応** キャンバスを `width: "max(100%, 1800px)", aspectRatio: "3/2"` に統一（SeatLayoutEditor と同一サイズ）。小画面は水平スクロール。`overflow-x-auto` ラッパー
- **翌日配置：ドラッグ入替** HTML5 DnD API でカードをドラッグ→ドロップ先とスタッフ入替。ドラッグ中は `opacity-40 scale-95`、ドロップ先は `ring-2 ring-blue-500 scale-105`。カードの色もスタッフと一緒に移動
- **翌日配置：ラベル削除** カードから席番号ラベルを除去
- **座席色：シフト名優先** `resolveShiftSection(shiftName, section)` でシフト名プレフィックスからセクションを解決（"MOTA_遅番_A" → MOTA）。`formatSectionShift()` で「査定（早番）」形式のラベル表示
- **フリー席ドラッグ** フリー席に配置されたスタッフもドラッグ可能に修正
- **自動配置ロジック改善**  
  - セクション指定席 → 同セクションスタッフのみ（マッチなければ空席のまま）  
  - フリー席・セクション未指定席 → 余ったスタッフを順番に配置  
  - 既存の手動配置を保持したまま追加配置（`existingAssignments` を引数で受け取る）  
  - シフト名プレフィックスでセクションを解決（`parseSection()`）
- **seatColors.ts 追加関数** `resolveShiftSection()` / `formatSectionShift()` を新規追加
- **シフト管理ツールバー刷新** 月ナビ・シフト展開ボタン・Excel出力・再仮組み・シフト編集を同一行に配置。ヘッダー右上から移動
- **Excel出力** 選択日のシフトをアカウント番号（数値）昇順でソートし `.xlsx` ダウンロード。列：アカウント番号 / 氏名 / 日付 / シフト名 / セクション（シフト）。`xlsx` ライブラリ（dynamic import）を使用

**v41 完了内容**
- スタッフ共通ナビ（STAFF_ITEMS）に `/seating`（座席表）を追加（シフトの次）
- 当日状況ページ（管理者向け）に「座席表」タブを追加（3つ目のタブ）
  - サブタブ「当日座席」：当日の席割り当て・打刻ステータスをリアルタイム表示
  - サブタブ「翌日配置」：翌日の自動配置・手動配置・保存機能
- `SeatingClient` / `SeatingPlanClient` に `embedded?: boolean` プロップを追加
  - `embedded=false`（デフォルト）: 従来のスタンドアロン全画面表示（変更なし）
  - `embedded=true`: ヘッダーなし・コンパクト表示（タブ内に埋め込み可能）
  - SeatingPlanClientはembedded時も自動配置・保存・クリアボタンをコンパクトバーで表示
- `attendance/page.tsx`：座席・配置データを並列取得してAttendanceClientに渡す
  - 新規取得: `seats`, 当日/翌日`seat_assignments`, 翌日`shifts`
  - 既存の`punchLogs`/`absenceRows`/`todayShifts`を再利用

**v40 完了内容**
- シフト編集グリッドのスタッフ情報パネルに希望休（off_requests）のCRUD機能を追加
- `OffRequestSection.tsx` 新規作成：カレンダー選択・優先度（希休1〜4）・×削除チップ
- 追加時→即時ドラフト反映、削除時→即時ドラフトクリア
- 「設定をシフトに保存・反映」ボタンが完全置換方式に変更（`replaceStaffHolidayDraftAction`）
  - 削除済み希望休も確実にドラフトから消える（追加のみ→差し替え方式に修正）
- 追加したアクション：`fetchOffRequestsForStaffAction` / `addOffRequestForStaffAction` / `removeOffRequestForStaffAction` / `deleteDraftCellsAction` / `replaceStaffHolidayDraftAction`
- shift_off_requests の source チェック制約：`'excel'` か `'app'` のみ（`'manual'` は不可）

**v39 完了内容**
- 座席表にフリー席・無効席を追加（`seats.seat_type text DEFAULT 'normal'`）
- `seat_type`: `"normal"`（通常セクション席）/ `"free"`（フリー席・誰でも可）/ `"disabled"`（無効席・使用不可）
- SeatLayoutEditor：席タイプセレクタを追加。フリー席=緑枠・FREEラベル、無効席=グレーハッチング
- SeatingClient（当日表示）：無効席はハッチングで表示・クリック不可。フリー席は緑枠
- SeatingPlanClient（翌日配置）：無効席はクリック不可・薄表示。フリー席は緑枠で配置可能
- autoAssignSeatsAction：無効席は自動配置対象外、フリー席は全スタッフ配置可能

**v38 完了内容**
- 仮組み余剰配置ループを改善：早番不足時は遅番優先スタッフでも早番に割当
- 余剰配置ループで「不足パターン（必要数未達）を早番優先順で先に試みる」ロジック追加
- 必要数が充足していれば従来通り優先シフト順にフォールバック

**v37 完了内容**
- スタッフ詳細設定モーダルの基本設定セクションに「希望給（時給）」入力欄を追加
- `project_members.desired_wage integer` カラム追加（Supabase MCP）
- メンバー一覧カードに希望給バッジ表示（¥1,200/h 形式・アンバー色、設定済みのみ）
- `updateMemberInfoAction` で保存、`page.tsx` / `members/page.tsx` のクエリを拡張

**v36 完了内容**
- 当日状況の欠勤スタッフ行に「詳細」ボタンを追加 → モーダルで報告時刻・欠勤理由・翌日/翌々日出勤可否を表示
- 遅刻スタッフ行の「催促する」横にも「詳細」ボタンを追加 → 報告時刻・遅刻理由・到着目安を表示
- absence_reports / late_reports のクエリを拡張（created_at, next_day_available, day_after_available, status）

**v35 完了内容**
- スタッフ詳細設定モーダルを4セクションに再構成（基本設定 / シフト設定 / 研修設定 / 離脱処理）
- 研修設定UIを全面刷新（研修日を設定ボタン → 展開パネル：タイプ選択＋時間＋カレンダー複数選択）
- 稼働日数のデフォルトを月21日に変更（既存データなくても月/21で表示・保存）
- シフト設定を常時表示（折りたたみ廃止）
- 新規スタッフ追加のアサイン日を必須化
- `staff_trainings`テーブルに`training_name`・`start_time`・`end_time`カラム追加
- 仮組みロジックが研修名・時間を正しくシフトエントリに反映するよう更新

**v34 完了内容**
- ナビをアカウント種別3種に刷新（スタッフ/管理者/運用者）
- 運用者サイドバーの管理セクション見出しを案件ファイルタブに変更（案件切り替え）
- タスク管理をナビから削除しホーム画面に統合（管理者・運用者のみ）
  - ホームタブ：今日の自分のタスクをウィジェット表示（チェックで完了）
  - タスクタブ：全タスク・他メンバータスク・管理機能
- /notices/manage を周知事項と問い合わせのタブ統合ページに改修



**Phase 1 完了 ✅**（v16〜v18）

**Phase 2 進行中 → セクション13参照**
- ~~P2-3: シフト編集モード~~ ✅ v19〜v20完了
- ~~P2-2: シフト仮組（アプリ内生成）~~ ✅ v21完了
- ~~P2-1: シフトパターン必要枠数の日別設定~~ ✅ v21完了（案件設定から日別入力方式に刷新）
- ~~P2-4: まとめてシフト依頼LINE送信~~ ✅ v20完了（グリッド確定時のNotifyModalで実装済み）
- **Phase 2 全タスク完了 ✅**

**Phase 3 完了 ✅**
- ~~P3-2: スタッフカードタップ→設定・離脱処理~~ ✅ v22完了
- ~~P3-1: 稼働設定を仮組ロジックに反映~~ ✅ v23完了（稼働日数・連勤上限・優先パターン・優先セクション・前月末連勤引き継ぎ・勤務間インターバル11時間）

**次の優先タスク** → ユーザーの要望次第

#### 座席表 残課題メモ（v42時点）
- セクション一覧をハードコードから案件設定のシフトパターン.section に変更
- 座席エディタのセクションカラーグルーピング表示（視認性向上）

### 開発スタイルの注意点
- **バイブコーディング**：ユーザーはJS/SQL未経験。実装はAIが担当し、ユーザーは方向性を決める
- **Vercel自動デプロイ**：`git push` → GitHub → Vercel で自動反映
- **テストアカウント**：S001（admin）でP001・P002を確認。O002は運用者（executive）

---

## 4. 開発の再開方法

```powershell
cd C:\dev\raq-portal-app
npm run dev
# → http://localhost:3000
```

新しい Claude セッションで作業する場合の起動メッセージ：
```
合同会社Raqの社内ポータル（GAS→Next.js+Supabase PWA移行）を開発中です。
プロジェクトは C:\dev\raq-portal-app にあります。
HANDOVER.md を先に読んでください。
次にやることはセクション11に書いてあります。
```

---

## 4. データモデル

### マスタ系

```
projects（案件マスタ）
  id, name, spreadsheet_id, line_group_id,
  punch_rule, shift_format, start_date, is_active

staffs（社員マスタ）
  id, auth_user_id, name, display_name,
  global_role (staff/admin/executive),
  default_project_id, line_user_id,
  hire_date, is_active, must_change_password,
  avatar_color text,       ← 廃止予定（avatar_config に移行中）
  avatar_config jsonb,     ← ★v9新設（要SQL実行：セクション9参照）
  line_blocked boolean     ← ★v27新設（LINEブロック検知用。unfollowイベントでtrue）

project_members（兼務対応）
  staff_id, project_id, role (staff/project_admin),
  section text,            ← ★v11新設（IDOM案件のセクション管理）
  sections text[],         ← ★v21新設（複数セクション対応。非空なら sections 優先、フォールバックは [section]）
  work_days_type text,     ← ★v21新設（"month" or "week"）
  work_days_count int,     ← ★v21新設（稼働日数。月ならn日、週ならn日）
  preferred_shift text,    ← ★v23新設（優先配置するシフトパターン名）
  preferred_section text,  ← ★v23新設（複数セクション時の優先セクション）
  max_consecutive_days int,← ★v23新設（連勤上限日数。デフォルト5日）
  start_date, end_date, is_main
```

### 機能データ

```
punch_logs（打刻ログ）
  project_id, staff_id,
  punch_type (clock_in/clock_out/break_start/break_end),
  recorded_at (timestamptz), note, approver_name

shifts（シフト）
  project_id, staff_id, shift_date (text YYYY-MM-DD),
  shift_name, shift_start (text HH:MM), shift_end (text HH:MM),
  status, note
  unique(project_id, staff_id, shift_date)

shift_patterns（シフトパターン定義）
  project_id, name, short_name, start_time, end_time,
  required_count (int), sort_order,
  section text,              ← ★v21: セクション（nullのパターンはセクション不問）
  target_role text,          ← ★v21: "all" / "admin" / "staff"
  required_weekday int,      ← ★v21: 平日必要人数（nullの場合は required_count を使用）
  required_weekend int       ← ★v21: 休日必要人数

shift_requests（シフト追加申請）
  project_id, staff_id, request_date, preferred_start,
  preferred_end, reason, status (pending/approved/rejected)

departure_reports（出発報告）
  project_id, staff_id, reported_at, eta_minutes

absence_reports（欠勤報告）
  project_id, staff_id, absence_date (text), reason,
  next_day_available, day_after_available, status
  ※ next_day_available は経過報告で更新（/absence-followup から送信）
  ※ next_day_available=false の場合、翌日の absence_report を自動作成

late_reports（遅刻報告）
  project_id, staff_id, late_date (text), reason,
  expected_arrival, status

notices（周知事項）
  project_id, title, body, is_pinned, posted_by,
  created_at, updated_at

notice_reads（既読管理）
  notice_id, staff_id, read_at

holiday_requests（希望休申請）
  project_id, staff_id, request_date,
  status (pending/approved/rejected/cancelled),
  note, reviewed_by, reviewed_at

holiday_rules（希望休ルール）
  project_id, rule_type, value (int), sort_order
  rule_type: deadline_day / monthly_limit_per_person /
             daily_limit_count / consecutive_limit

punch_corrections（勤怠補正申請）
  project_id, staff_id, target_date,
  corrected_in, corrected_out, reason, status,
  reviewed_by, reviewed_at

posts（投稿・スタッフ掲示板）
  project_id, staff_id, body, created_at

project_settings（案件ごとの設定）
  project_id,
  sheet_url,
  notification_settings jsonb  ← ★v9新設（要SQL実行：セクション9参照）

shift_change_logs（シフト変更ログ）
  project_id, staff_id, shift_date, action,
  before_data jsonb, after_data jsonb, changed_by, changed_at

shift_slot_requirements（日別必要人数） ← ★v20新設
  project_id, section, pattern_name, shift_date, required_count
  unique(project_id, section, pattern_name, shift_date)
  ※ 編集グリッドのカウント行クリックで日付ごとに上書き設定できる
  ※ section が null のパターンは section="" で保存

shift_grid_drafts（グリッド仮保存） ← ★v20新設
  project_id, target_month (YYYY-MM),
  draft_data jsonb,  ← GridDraftEntry[] の配列
  saved_by, saved_at,
  locked_sections text[],      ← 仮確定セクション（人確定）
  slot_locked_sections text[], ← 枠確定（v46廃止・カラムのみ残存）
  editing_by text,             ← ★v46: 現在編集中のスタッフID（null=未編集）
  editing_at timestamptz       ← ★v46: 最終ハートビート時刻（5分TTL）
  unique(project_id, target_month)
  ※ 編集中の差分をそのまま保存。次回ロード時に続きから編集可能

consent_records（同意書確認履歴）← ★v16新設
  staff_id, project_id,
  consent_month (text YYYY-MM),
  confirmed_name (text),   ← 同意時に本人が入力した氏名
  signed_at (timestamptz)
  unique(staff_id, project_id, consent_month)
  ※ 現場端末打刻ページ（/punch/[projectId]）で当月初回打刻時に記録
  ※ スタッフ管理ページ（/admin/staffs）の「同意書」ボタンから閲覧可能
```

---

## 5. ドキュメント

| ファイル | 内容 |
|---|---|
| `HANDOVER.md` | 開発引継ぎ資料（本書） |
| `docs/管理者マニュアル.txt` | 案件管理者向け操作説明書（全8機能・よくある操作フロー含む） |

---

## 6. プロジェクト構成

```
src/
├── app/
│   ├── (portal)/
│   │   ├── layout.tsx              ← AppNav + DevBanner + ロール別メニュー
│   │   ├── dashboard/              ← ホーム（出発報告・欠勤・遅刻・打刻状態）
│   │   ├── punch/                  ← フルスクリーン打刻UI
│   │   ├── shifts/
│   │   │   ├── page.tsx            ← シフト/希望休/追加申請 タブ
│   │   │   ├── manage/             ← 管理者シフト管理（日付タブ・充足バッジ）
│   │   │   └── request/            ← シフト追加申請
│   │   ├── record/                 ← 勤怠実績（月次）
│   │   ├── post/                   ← 投稿（社内掲示板）
│   │   ├── my/                     ← スタッフ マイページ
│   │   ├── notices/                ← 周知事項
│   │   ├── holidays/               ← 希望休申請
│   │   ├── corrections/            ← 勤怠補正申請
│   │   ├── attendance/             ← 当日状況（管理者）
│   │   └── admin/
│   │       ├── page.tsx            ← 案件一覧
│   │       ├── my/                 ← 運用者/管理者 マイページ ★v9新設
│   │       │   ├── page.tsx
│   │       │   ├── AvatarEditor.tsx  ← アバターエディター（UI）
│   │       │   ├── AvatarSvg.tsx     ← SVGアバター描画（パーツ未実装）
│   │       │   ├── AvatarPicker.tsx  ← 旧カラーピッカー（廃止予定）
│   │       │   ├── avatar-types.ts   ← 型・定数定義
│   │       │   └── actions.ts
│   │       ├── staffs/             ← スタッフ管理
│   │       ├── operators/          ← 運用者管理
│   │       ├── notices/            ← 周知一覧（全社）
│   │       ├── posts/              ← 投稿一覧（全社）
│   │       └── [projectId]/
│   │           ├── page.tsx
│   │           └── settings/
│   │               ├── page.tsx
│   │               ├── SettingsClient.tsx  ← タブUI（basic/members/shift/holiday/notify/danger）
│   │               ├── actions.ts
│   │               └── notify-config.ts    ← 通知設定の型・定数・デフォルト値
│   │
│   ├── api/
│   │   ├── auth/line/              ← LINE Login OAuth
│   │   ├── cron/notify/route.ts   ← スケジュール通知 cron ★v9新設
│   │   └── set-project/route.ts
│   │
│   └── (その他: login, change-password, select-project, etc.)
│
├── components/
│   ├── AppNav.tsx
│   ├── DevBanner.tsx
│   └── icons.tsx
│
└── lib/
    ├── notify.ts          ← LINE通知共通ライブラリ ★v9新設
    ├── line.ts            ← pushLine() / multicastLine()
    ├── gsheets.ts         ← Google Sheets 連携
    ├── datetime.ts        ← JST日時ユーティリティ
    ├── attendance.ts      ← 勤怠計算
    ├── project-context.ts ← 案件ID取得
    └── supabase/ (server / client / middleware / admin)
```

---

## 7. LINE通知システム（v9実装済み）

### アーキテクチャ

```
イベント通知（即時）
  各Server Action → sendEventNotify(projectId, type, vars) → LINE送信

スケジュール通知（定時）
  Vercel Cron（5分ごと） → /api/cron/notify → LINE送信
```

### 通知種別

| キー | 種類 | 内容 | デフォルト宛先 |
|---|---|---|---|
| `absence` | イベント | 欠勤申請 | 管理者グループ |
| `absence_confirm` | イベント | 欠勤受付完了 | 申請スタッフ本人 |
| `tardiness` | イベント | 遅刻申請 | 管理者グループ |
| `clock` | イベント | 出退勤打刻 | 管理者グループ |
| `announcement` | イベント | お知らせ投稿 | 全スタッフ |
| `inquiry` | イベント | 問い合わせ受信 ★v10新設 | 管理者グループ |
| `inquiry_reply` | イベント | 問い合わせ返信 ★v10新設 | スタッフ本人 |
| `shift_start_remind` | 定時 | 出勤N分前リマインド | スタッフ本人 |
| `shift_end_remind` | 定時 | 退勤打刻忘れ確認 | スタッフ本人 |
| `rest_day_remind` | 定時 | 翌日出勤アナウンス | スタッフ本人 |
| `daily_summary` | 定時 | 当日出勤状況サマリー | 管理者グループ |
| `holiday_reminder` | 定時 | 希望休締切リマインド | スタッフ全員 |
| `holiday_open_notify` | 定時 | 毎月1日 希望休申請開始通知 ★v27新設 | スタッフ全員 |
| `absence_followup_remind` | 定時 | 欠勤者への翌日出勤可否確認（17時） ★v27新設 | スタッフ本人 |
| `absence_followup_notify` | イベント | 経過報告受信通知 ★v27新設 | 管理者グループ |
| `shift_published` | イベント | シフト展開（個人シフト送信） ★v27新設 | スタッフ本人 |

### 設定
案件設定 → LINE通知タブ でON/OFF・宛先・タイミング・メッセージ文を変更できる。
設定は `project_settings.notification_settings` (jsonb) に保存。

### メッセージ変数

| 変数 | 内容 |
|---|---|
| `{名前}` | スタッフ表示名 |
| `{日付}` | 対象日（YYYY-MM-DD） |
| `{シフト}` | シフト名（時刻）例: Aシフト（09:00〜18:00） |
| `{欠勤理由}` | 欠勤理由テキスト |
| `{翌日出勤可否}` | 「翌日：出勤可」or「翌日：欠勤」 |
| `{翌々日出勤可否}` | 同上（翌々日） |
| `{遅刻理由}` | 遅刻理由テキスト |
| `{到着目安時間}` | 到着予定時刻 |
| `{時刻}` | 打刻時刻（HH:MM） |
| `{種別}` | 出勤 / 退勤 |
| `{タイトル}` | お知らせタイトル |
| `{本文}` | お知らせ本文 |
| `{次回出勤日}` | 次回シフトの日付 |
| `{翌日}` | 翌日の日付 |
| `{出勤数}` | 当日出勤予定人数 |
| `{一覧}` | スタッフ別出退勤一覧 |

### Cronの認証
`Authorization: Bearer <CRON_SECRET>` ヘッダーで保護。
`.env.local` に `CRON_SECRET=（ランダムな文字列）` を追加する。

---

## 8. アバターシステム（v9設計・実装途中）

### 概要
「トモダチコレクション」スタイルのSVGアバター。
案件管理者・運用者が `/admin/my` で自分のアバターを設定できる。

### データ型（`avatar-types.ts`）

```typescript
type AvatarConfig = {
  bg:         string;  // 背景色キー（"sky"/"mint"/"rose" など8種）
  skin:       number;  // 肌色 0-4
  hair_style: number;  // 髪型 0-4
  hair_color: string;  // 髪色キー（12種）
  eyes:       number;  // 目 0-4
  mouth:      number;  // 口 0-3
  cheeks:     boolean; // ほっぺ
};
```

### SVG仕様（`AvatarSvg.tsx` へのパーツ追加が必要）

**キャンバス**: `viewBox="0 0 100 100"`

| パーツ | 位置・サイズ |
|---|---|
| 背景円 | cx=50 cy=50 r=50 |
| 顔の楕円 | cx=50 cy=53 rx=27 ry=29（上端y≈24、下端y≈82） |
| 耳（左） | cx=22 cy=54 rx=5 ry=6 |
| 耳（右） | cx=78 cy=54 rx=5 ry=6 |
| 眉毛 | y≈37〜40 付近 |
| 目 | 左:cx=38 cy=48 / 右:cx=62 cy=48 |
| 鼻 | x=47〜53 y≈59〜63（サブトル） |
| 口 | 中心x=50 y≈65〜68 |
| ほっぺ | 左:cx=32 cy=64 / 右:cx=68 cy=64 rx=8 ry=4.5 |

**レンダリング順（上が奥）:**
1. 背景円
2. HairBack（後ろ髪）
3. 耳
4. 顔楕円
5. 眉毛
6. 目
7. 鼻
8. 口
9. ほっぺ（`config.cheeks===true` のとき）
10. HairFront（前髪）

**髪型スタイル（0〜4）:**
- 0: ショート — 頭頂部キャップのみ、耳より上で止まる
- 1: ミディアム — キャップ＋耳を覆うサイドウィング（y≈54）
- 2: ロング — キャップ＋長いサイドストランド（y≈72）＋後ろ髪（y≈97）
- 3: ポニーテール — 短い前髪＋右側に束
- 4: スパイキー — キャップベース＋4本のトゲ

**目スタイル（0〜4）:**
- 0: ノーマル — 縦長楕円 rx=5 ry=5.5、白ハイライト
- 1: ハッピー — ∪型ストローク（M x,50 Q cx,43 x2,50）
- 2: ビッグ — 大楕円 rx=7 ry=7.5、ハイライト2つ
- 3: ウィンク — 左=ノーマル、右=∩型ストローク
- 4: スター — 5角星ポリゴン（金色 #FFD700）

**口スタイル（0〜3）:**
- 0: スマイル — `M 40,65 Q 50,73 60,65` ストローク
- 1: ビッグスマイル — 広い弧＋赤い口内＋白い歯
- 2: ニュートラル — 水平線 y=68
- 3: びっくり — 二重楕円 cx=50 cy=68

### ⚠️ AvatarSvg.tsx の現状
`AvatarSvg.tsx` はファイルが存在するが、**パーツのSVGパスはユーザーが手書きする予定**。
現在はコンポーネントの骨格と型のみ。`HairBack`/`HairFront`/`Eyes`/`Mouth` 関数が定義されているが、
パスの中身は未完成の可能性がある。新しいAgentは**触らずにそのまま残すこと**。

### 保存アクション
`updateAvatarConfigAction(fd: FormData)` が `admin/my/actions.ts` に実装済み。
`staffs.avatar_config` (jsonb) に保存する。

---

## 9. Google Sheets 連携

### 操作場所
**`/admin/[projectId]`（案件詳細設定画面）のスプシタブ**から行う。
`/shifts/manage` のスプシタブは v8 で削除済み。

### シフト作業フロー
```
① 案件設定 → スプシを自動作成 or URL手動入力
   └─ 保存と同時にメンバーシート自動同期

② 案件設定 →「シフト表生成」
   └─ 年月指定 ＋「仮組あり」オプション（draftAssign=true）
   └─ holiday_requests テーブルから希望休を自動反映
   └─ シフトパターン・メンバー一覧付きのテンプレートをスプシに生成

③ スプシで手入力（シフト名をマスに入力）
   └─ 不足数はスプシの数式が自動計算

④ シフト管理（/shifts/manage）→「スプシから読込」
   └─ importFromSheetAction → shifts テーブルへ反映

⑤ アプリ→スプシへの書き戻しはしない（スプシが正）
```

### 自動同期タイミング
| 操作 | 同期先シート |
|---|---|
| メンバー追加/削除/役割変更 | メンバーシート |
| シフトパターン保存 | シフトパターンシート |
| 希望休ルール保存 | 希望休ルールシート |
| シフト表生成 | 希望休シート ＋ シフト表シート |

### スプシ構成（9シート固定）
| シート名 | 用途 |
|---|---|
| 設定 | 通知ON/OFF等の設定値 |
| メンバー | 社員ID・表示名・本名・役割・会社名 |
| 希望休 | 希望休申請データ |
| シフト表 | 月次入力用テンプレート（target_role で admin/staff 分割） |
| シフト | シフト詳細データ |
| 打刻ログ | 打刻履歴 |
| 日別勤怠 | 日別勤怠実績 |
| 月次集計 | 月次集計 |
| シフト変更ログ | シフト変更履歴 |

### 認証方式（3段階フォールバック・v11）
1. `GOOGLE_SERVICE_ACCOUNT_JSON` （JSON丸ごと）
2. `GOOGLE_CLIENT_EMAIL` ＋ `GOOGLE_PRIVATE_KEY` （個別環境変数）
3. `GOOGLE_CLIENT_ID` ＋ `GOOGLE_CLIENT_SECRET` ＋ `GOOGLE_REFRESH_TOKEN` （OAuth2）

### 関連ファイル
- `lib/gsheets.ts` — シート操作全般（`generateShiftTableSheet` / `syncMembersSheet` 等）
- `admin/[projectId]/settings/actions.ts` — `generateShiftTableAction` / `createSpreadsheetAction` 等
- `shifts/actions.ts` — `importFromSheetAction`（スプシ→DBへの読込）
- `shifts/manage/SheetsSync.tsx` — 現在未使用（孤立ファイル）。必要なら管理画面に再統合可

---

## 10. UI デザイン方針

- **角丸**: `rounded-2xl`（カード・大要素）
- **配色**: `zinc-` グレースケール ＋ `blue-600` アクセント
- **モバイルファースト**: `h-dvh` + `flex flex-col`
- **ダークモード**: `dark:` クラスを必ずペアで指定
- **tabular-nums**: 時刻・件数に必ず使用
- **絵文字禁止**: SVGアイコン（`src/components/icons.tsx`）を使う
- **スクロールなし**: `flex-1 min-h-0 overflow-y-auto`
- Tailwind v4: `@import "tailwindcss"` 形式（`tailwind.config.js` 不使用）

---

## 11. SQL実行状況

### ✅ 実行済み
- `project_settings.notification_settings` jsonb カラム追加
- `project_settings.line_group_id` text カラム追加（LINEグループ連携）
- `inquiries` テーブル作成（RLS設定済み）
- `staffs.avatar_config` jsonb カラム追加（要確認）

### ⏳ 未実行（要実行）

#### ① shift_patterns テーブル更新
```sql
alter table public.shift_patterns
  add column if not exists short_name text not null default '',
  add column if not exists required_count int;
```

#### ② holiday_rules テーブル新規作成
```sql
create table if not exists public.holiday_rules (
  id         uuid        primary key default gen_random_uuid(),
  project_id text        not null references public.projects(id) on delete cascade,
  rule_type  text        not null,
  value      int         not null,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);
alter table public.holiday_rules enable row level security;
create policy "select_member_holiday_rules" on public.holiday_rules
  for select to authenticated
  using (exists (select 1 from public.project_members pm
    where pm.staff_id = public.current_staff_id()
      and pm.project_id = holiday_rules.project_id));
create policy "admin_all_holiday_rules" on public.holiday_rules
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));
```

---

## 12. 環境変数（.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...        # 絶対公開禁止・サーバーのみ
NEXT_PUBLIC_BASE_URL=http://localhost:3000
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
CRON_SECRET=...                            # ★v9新設：openssl rand -hex 32 等で生成

# Google Sheets連携（以下いずれかの方式で設定）
# 方式A: OAuth2
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
# 方式B: サービスアカウントJSON
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# 方式C: 個別環境変数
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

---

## 13. 実装ロードマップ（v15〜）

> 凡例：✅ 完了 / 🔄 進行中 / ⏳ 未着手

---

### 🔴 Phase 1 ─ 打刻・出発報告の基盤変更

#### P1-1. 現場端末専用打刻ページ新設

**仕様**
- URL：`/punch/[projectId]`（案件ごとに別URL・認証不要）
- 操作フロー：スタッフ名選択 → シフト選択 → 打刻種別選択 → 打刻実行
- 打刻種別：定時出勤 / 遅刻出勤 / 早退退勤 / 定時退勤
- 認証不要のため、RLSをバイパスする adminClient を使用
- シンプルなフルスクリーンUI（タブレット想定）

**影響ファイル**
- 新規：`src/app/punch/[projectId]/page.tsx`
- 新規：`src/app/punch/[projectId]/actions.ts`
- 削除：スタッフ・管理者メニューの `/punch` エントリ（layout.tsx の STAFF_ITEMS から削除）
- 現在の `/punch/page.tsx` は残すか要検討（スタッフ打刻の代替があるかどうか）

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P1-1a | `/punch/[projectId]` ページ作成（UI・打刻action） | ✅ |
| P1-1b | スタッフ・管理者メニューから打刻メニューを削除 | ✅ |
| P1-1c | 管理者マニュアル更新 | ⏳ |

---

#### P1-2. 出発報告ON/OFF設定

**仕様**
- `project_settings` に `enable_departure_report boolean default true` カラム追加
- 案件設定 > 基本設定タブ にON/OFFトグルを追加
- OFFの案件では：
  - スタッフの出発報告フォームを非表示
  - 当日状況の「出発済」ステータス・「催促する」ボタンを非表示
  - ナビから「出発報告」メニューを非表示（該当する場合）

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P1-2a | DBカラム追加（enable_departure_report） | ✅ |
| P1-2b | 案件設定UIにトグル追加 | ✅ |
| P1-2c | 当日状況ページに設定を反映 | ✅ |
| P1-2d | スタッフ側の出発報告フォームに設定を反映 | ✅ |

---

### 🟠 Phase 2 ─ シフト管理の抜本刷新

#### P2-1. シフトパターン必要枠数の日別設定 ✅ v21完了

**実装内容**
- `shift_patterns` に `section`, `target_role`, `required_weekday`, `required_weekend` カラム追加
- 案件設定 > シフトタブのパターン入力UIを刷新
  - パターン設定項目: ①シフト名 ②略称 ③開始/終了時間 ④セクション ⑤対象（全員/管理者/スタッフ）
  - `required_count` は廃止（日別設定方式に移行）
  - パターン行を折りたたみ可能に（▶トグル）
- `getRequired()` の優先順位: localSlotReqs（編集中） → slotReqMap（DB保存済み） → required_weekday/weekend → required_count

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-1a | DBカラム追加（section, target_role, required_weekday, required_weekend） | ✅ |
| P2-1b | 案件設定シフトタブのUI更新（折りたたみ・設定項目刷新） | ✅ |

---

#### P2-2. シフト仮組（アプリ内生成）✅ v21完了

**実装内容**
- 案件設定 > シフトタブに仮組セクション（`ShiftDraftSection.tsx`）を新設
- 3ステップUI: 月選択 → パターン×日付グリッドで必要人数入力 → 仮組生成
- `draft-actions.ts`（Server Actions）:
  - `fetchSlotRequirementsForMonthAction` — 既存日別必要人数を取得
  - `generateShiftDraftAction` — 自動割当ロジックで仮組生成 → `shift_grid_drafts` へ保存
- 生成ロジック: 希望休除外・当日既割当除外・セクション一致・役割一致でフィルタ後ランダム割当
- 生成後は「シフト管理で確認」リンクを表示 → グリッド編集モードで確認・修正・確定

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-2a | 仮組生成ロジック実装（Server Action） | ✅ |
| P2-2b | 仮組UIを案件設定シフトタブに実装 | ✅ |
| P2-2c | 生成結果をshift_grid_draftsに保存→グリッド編集で確定 | ✅ |

---

#### P2-3. シフト編集モード（ドラッグ対応）✅ v19〜v20完了

**実装済み機能**
- `ShiftEditGrid.tsx`：行=パターン・列=日付の月次横スクロールグリッド
- ドラッグ（`@dnd-kit/core`）でパターン移動・日付移動
- セルタップで「パターン変更」「公休に変更」「スタッフ追加」
- 日別必要人数インライン編集（CountCell）→ `shift_slot_requirements` テーブルへ保存
- セクション互換チェック（canAssign）・重複検出・エラーバブル表示
- 仮保存（`shift_grid_drafts`）・次回ロード時に続きから編集
- 確定後 LINE 通知フロー（NotifyModal）：スタッフ別変更一覧＋チェックボックスで個別 push
- セクション別不足/余剰バッジをツールバーに表示（SV除外）
- パターン充足状況行の左固定列に月次合計（配置/必要・差分）表示
- 一覧ビュー（ShiftDayList）：充足数 +/- 表示・SV は人数のみ・デフォルト全折りたたみ

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P2-3a | `@dnd-kit/core` インストール | ✅ |
| P2-3b | 編集モードUIの実装 | ✅ |
| P2-3c | ドラッグによる日付移動・スワップ実装 | ✅ |
| P2-3d | 一括確定・キャンセル処理 | ✅ |
| P2-3e | 仮保存・変更履歴・セクション互換チェック | ✅ |
| P2-3f | 充足表示・LINE通知フロー | ✅ |

---

#### P2-4. まとめてシフト依頼（LINE送信強化）✅ v20完了

**実装内容**
- グリッド編集の確定時に `NotifyModal` が表示される
- スタッフ別の変更一覧（日付・変更前後のシフト名）をまとめて表示
- チェックボックスで送る相手を個別選択
- `notifyShiftChangesAction` で選択スタッフにまとめてLINE push
- LINE未連携スタッフは送信対象外（モーダルに表示）

| # | タスク | 状態 |
|---|---|---|
| P2-4a | グリッド確定時のNotifyModal実装 | ✅ |
| P2-4b | notifyShiftChangesAction（Server Action） | ✅ |

---

### 🟡 Phase 3 ─ スタッフ設定の充実

#### P3-1. 案件ごとのスタッフ稼働設定・シフト設定 ✅ v23完了

**実装内容**
- `project_members` に `preferred_shift`, `preferred_section`, `max_consecutive_days` カラム追加（Supabase MCP）
- メンバー設定編集フォームを折りたたみ式「シフト設定（仮組用）」セクションに整理
  - 稼働日数（月/週）、優先パターン、連勤上限、優先セクション（複数セクション時のみ表示）
  - SVメモ（shift_note）は廃止（算出ロジックに影響しないため）
- `generateShiftDraftAction` の仮組アルゴリズムを大幅強化：
  - **月稼働日数上限**（work_days_type="month"）・**週稼働日数上限**（work_days_type="week"）
  - **連勤上限**（max_consecutive_days、デフォルト5日）
  - **優先スコアリング**：preferred_shift一致(+1) ＋ preferred_section一致(+1) → 高スコア優先割当
  - **前月末連勤引き継ぎ**：前月末7日分を取得し、月をまたぐ連勤を正確にカウント
  - **勤務間インターバル11時間**：前日シフト終了から次の開始まで11時間未満は除外

**タスク**

| # | タスク | 状態 |
|---|---|---|
| P3-1a | DBカラム追加（project_members） | ✅ |
| P3-1b | メンバー設定UIに入力欄追加（折りたたみ式） | ✅ |
| P3-1c | 仮組ロジックに稼働設定・前月連勤・インターバルを組み込み | ✅ |

---

#### P3-2. スタッフカードから設定・離脱処理 ✅ v22完了

**実装内容**
- `src/components/StaffPopupMenu.tsx`（共通コンポーネント）を新設
  - スタッフ名タップ → ボトムシートで「メンバー設定」「離脱処理」を選択
  - 「メンバー設定」→ `/admin/${projectId}/settings?tab=members` へ遷移
  - 「離脱処理」→ 離脱日入力 → `departStaffAction` 実行
- `departStaffAction`（settings/actions.ts に追加）:
  - `project_members.end_date` に離脱日をセット
  - 離脱日より後の `shifts` を削除
  - `revalidatePath` でページを自動更新
- **全メニューに統合**:
  - ShiftDayList（月次グリッドのスタッフ名チップ）→ StaffPopupMenu
  - ShiftEditGrid（EditModal内スタッフ名の横に「設定」リンク）
  - AttendanceClient（出勤スタッフ名・休みスタッフ名）→ StaffPopupMenu
  - メンバー設定の編集フォーム → 離脱処理セクションを直接追加（日付入力＋確定ボタン）
- メンバーカードの×（削除）ボタンを廃止（離脱処理に統一）

| # | タスク | 状態 |
|---|---|---|
| P3-2a | StaffPopupMenu コンポーネント新設 | ✅ |
| P3-2b | departStaffAction 実装 | ✅ |
| P3-2c | 全メニューへの統合 | ✅ |

---

### 🟢 継続タスク（既存）

| # | タスク | 状態 | 詳細 |
|---|---|---|---|
| X-1 | スケジュール通知の動作確認 | ✅ | 本番動作確認済み |
| X-2 | 希望休ルールのバリデーション（申請時チェック） | ✅ | actions.ts に実装済み（締切・月上限・日別上限・連続上限） |
| X-3 | 本番投入（GASと並行運用） | ➖ | 不要（GAS並行運用・100名移行は行わない方針） |
| X-4 | SQL未実行分を Supabase に適用 | ✅ | 適用済み（short_name, holiday_rules テーブルは使用中） |

---

### v24 ナビ再構成メモ（v34で更新）

**ロール別メニュー構成（v34時点）**

| ロール | メイン | 管理 | 運営 |
|---|---|---|---|
| スタッフ | ホーム/シフト/勤怠実績/投稿/問い合わせ/ヘルプ/My | なし | なし |
| 管理者（project_admin/admin） | 上記＋タスク（ホーム統合） | 当日状況/シフト管理/メンバー管理/周知・問合せ/勤怠管理/LINE連携/案件設定 | なし |
| 運用者（executive） | 上記管理者と同じ | 同左＋**案件ファイルタブ**（サイドバー見出し部分） | 案件管理/運用者管理/スタッフ一覧 |

- タスク管理はナビから削除。管理者・運用者のホーム画面に [ホーム|タスク] タブとして統合
- ホームタブ下部に「今日のタスク」ウィジェット（自分の担当・当日分のみ）
- 運用者の案件切り替えはサイドバーの管理セクション見出しをファイルタブ形式で表示
- DevBanner（視点モード切替バナー）廃止
- 補正審査（/corrections/manage）は勤怠修正（/attendance/edit）のタブに統合
- Myページ：全ロール共通 /my に統合（admin/my は /my にリダイレクト）
- /notices/manage を周知・問合せ統合ページに改修（タブで切り替え・未返信バッジ表示）

---

### v26 ページ整理メモ

- `holidays/page.tsx` 削除 → 希望休はシフトタブ内で完結
- `corrections/manage/page.tsx` 削除 → 勤怠修正の補正申請タブに統合
- `MY_ADMIN` の href を `/admin/my` → `/my` に変更
- `/admin/my/page.tsx` は `/my` へリダイレクト
- ダッシュボード「次回出勤」セクションをリンク化 → タップで `/shifts` へ
- スタッフ向け勤怠実績PDF出力ボタンを削除（機能不要と確定）
- 操作説明書を `docs/` フォルダに作成（スタッフ用・管理者用）

---

## 14. テストアカウント

| 項目 | 値 |
|---|---|
| メール | `s001@raq.internal` |
| 社員ID | `S001` |
| グローバルロール | `admin` |
| 案件 | P001（管理者）/ P002（スタッフ） |

---

## 15. ホスティングとCron

`vercel.json` が設置済み。Vercelにデプロイすると自動で5分ごとに
`/api/cron/notify` が呼ばれ、スケジュール通知が送信される。

ローカルでのcronテスト：
```powershell
curl -H "Authorization: Bearer <CRON_SECRETの値>" http://localhost:3000/api/cron/notify
```

---

## 16. 既知の問題・注意点

### Next.js の searchParams は Promise
```tsx
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams; // 必ず await する
```

### "use server" ファイルから非async関数をexportできない
→ 型・定数・ヘルパー関数は別ファイル（例: `notify-config.ts`）に置く。

### adminClient が必要な場面
運用者が自分の所属していない案件のデータを扱う場合は `createAdminClient()` を使う。
`createClient()`（RLS適用）では他案件のデータが取れない。

### Tailwind v4
`tailwind.config.js` は不使用。`@import "tailwindcss"` で設定。

---

## 17. 改訂履歴

| 日付 | バージョン | 内容 |
|---|---|---|
| 2026-04-29 | v1〜v4 | Phase 0〜8 実装 |
| 2026-05-05 | v5 | LINE Login・案件CRUD・GSheets連携・投稿・視点切替 |
| 2026-05-06 | v6 | スプシ連携大改訂、シフト表テンプレート |
| 2026-05-06 | v7 | 希望休ルール柔軟化、holiday_rules テーブル |
| 2026-05-09 | v8 | シフト管理UI全面刷新、adminClient化、ops メニュー追加 |
| 2026-05-10 | v9 | LINE通知システム実装（notify.ts・cron route・各action更新）、アバターシステム設計、運用者マイページ(/admin/my)、vercel.json |
| 2026-05-11 | v10 | 問い合わせシステム新設（/inquiries・/inquiries/manage）、LINE Login magic link修正（/auth/confirm）、LINEグループ連携（project_settings.line_group_id）、inquiry/inquiry_reply通知種別追加、通知カードアコーディオンUI、notify.ts個別try-catch、ops向け問い合わせ管理修正 |
| 2026-05-13 | v11 | セクション機能（project_members.section）、CSVフォーマットをIDOM形式に変更（所属会社,氏名,役割,セクション）、CSV重複スキップ、姓名スペース削除、LINE連携状況の表示、初期PW変更（1234）、問い合わせ返信バグ修正、シフト管理セクションフィルタ、シフト生成エラーハンドリング改善、Google Sheets認証を3段階フォールバック＋OAuth2個別環境変数対応 |
| 2026-05-09 | v12 | シフト管理UI全面刷新（ShiftDayList：日付タブ・充足バッジ・未登録折りたたみ・メンバー外シフト表示・router.refresh）、adminClient化（RLSバイパス）、/api/set-project Route Handler新設、Google Sheets連携セクション追記（セクション8）、運用者メニューへの管理者メニュー追加を残タスクに追記 |
| 2026-05-16 | v13 | UIブラッシュアップ多数：モバイルボトムナビをiOSセグメントコントロール風に刷新・`<a>`→`<Link>`でプリフェッチ有効化・loading.tsxを主要ページに追加・DevBannerをモバイルで非表示・シフト管理タブを2行レイアウトに改善。当日状況：未打刻バッジ追加・勤怠ステータスをバッジタップで手動変更可能に（changeAttendanceStatusAction実装）。勤怠修正：カード形式UIに刷新・異常打刻のみ表示＋修正ボタンで即時編集。補正申請承認時のpunch_logs自動上書き・LINE結果通知（correction_result通知種別追加）。 |
| 2026-05-16 | v14 | 管理者マニュアル作成（docs/管理者マニュアル.txt）。全8機能の詳細手順・よくある操作フロー・権限説明を記載。HANDOVER.mdにdocsセクション追加。 |
| 2026-05-16 | v15 | 大規模仕様変更決定・実装ロードマップ策定。Phase1（打刻専用ページ・出発報告ON/OFF）、Phase2（シフト仮組アプリ内生成・編集モード・ドラッグ操作・まとめて依頼）、Phase3（スタッフ稼働設定・離脱処理）の3フェーズで実装予定。 |
| 2026-05-18 | v16 | Phase 1 P1-1完了：現場端末専用打刻ページ（/punch/[projectId]）新設。認証不要・adminClient。スタッフ選択プルダウン（未打刻者のみ）、SV承認者入力（遅刻/早退）、当月初回同意書確認（7条・氏名入力）、同意書履歴をスタッフ管理ページに追加。ダッシュボードから打刻ボタン廃止。 |
| 2026-05-18 | v17 | Phase 1 P1-2完了：出発報告ON/OFF設定（案件設定 > 基本設定タブのトグル）。OFFの場合ダッシュボードレイアウトをAppleスタイルに刷新（現在時刻ヒーロー・シフトカード・次回出勤カード）。 |
| 2026-05-18 | v18 | Phase 1 追加実装：打刻時刻の自動丸め処理。定時→シフト開始/終了時刻、遅刻→15分繰り上げ、早退/残業→15分切り下げ。残業退勤ボタン追加。種別選択画面に記録予定時刻のヒント表示。 |
| 2026-05-18 | v19 | P2-3完了：シフトグリッド編集モード。`@dnd-kit/core` 導入。ShiftEditGrid（月次横スクロールグリッド・CSS Grid・sticky列/行・ドラッグスワップ・タップモーダル・差分Map・一括保存）。bulkUpsertShiftsAction追加。ShiftManageClientに「グリッド編集」ボタンを追加。 |
| 2026-05-18 | v20 | シフトグリッド大幅改善：一覧ビューを読み取り専用に変更（編集はグリッドモードのみ）。セクション外パターンへの配置を禁止（canAssign強化）。変更履歴・仮保存・スタッフ向け履歴表示を実装。グリッドをパターン軸レイアウトに変更（パターン行ごとに日付セルを横展開）。 |
| 2026-05-18 | v21 | P2-1・P2-2完了。シフトパターン設定を刷新（折りたたみ・セクション・対象役割・平日/休日必要人数）。案件設定シフトタブに仮組セクション新設（月選択→パターン×日付グリッド→自動生成→shift_grid_drafts保存）。メンバー設定拡充：シフト備考・稼働日数（月/週）・複数セクション（sections text[]）・勤怠順守率バッジ。フィルターをアコーディオン式に刷新（未設定オプション含む）。セクション入力をクリック選択式チップUIに変更（シフトパターンのセクションを自動取得）。 |
| 2026-05-18 | v22 | P3-2完了。StaffPopupMenu（共通ボトムシート）新設。スタッフ名タップ→「メンバー設定」「離脱処理」メニューをシフト管理一覧・当日状況に追加。ShiftEditGridのEditModalにメンバー設定リンク追加。メンバー設定編集フォームに離脱処理セクション追加。departStaffAction実装（end_date設定＋以降シフト削除）。メンバーカードの×削除ボタンを廃止。 |
| 2026-05-19 | v23 | P3-1完了。project_membersにpreferred_shift・preferred_section・max_consecutive_daysカラム追加。メンバー設定UIを折りたたみ式「シフト設定（仮組用）」セクションに整理・SVメモ廃止・優先セクション追加。仮組アルゴリズム強化：月/週稼働日数上限・連勤上限・優先スコアリング（パターン+セクション）・前月末連勤引き継ぎ（7日分）・勤務間インターバル11時間チェック。 |
| 2026-05-19 | v24 | ナビ再構成：ロール別メニューを統合（スタッフ/管理者/運営者が各自の上位メニューを全て表示）・DevBanner（モード切替バナー）廃止・補正審査を勤怠修正ページにタブ統合・周知管理→お知らせ管理リネーム。当日状況UI改善：サマリーカードを出勤/遅刻/欠勤の3種に変更・シフト時刻をshift_patternsから補完して表示・開始時間順ソート・出発報告OFF時に出発済カード非表示。 |
| 2026-05-19 | v25 | 希望休タブUI刷新：デフォルト表示を申請済み一覧（タップで取り下げ確認）＋「希望休を申請する」ボタン→カレンダー申請画面の2ステップ構成に変更（HolidayTab.tsx新設）。申請月制限：締切日前は今月のみ・締切日後は翌月のみ申請可能、未来月への次月ナビゲーションを無効化。 |
| 2026-05-20 | v27 | **LINE連携必須化・なりすまし防止・LINEブロック検知・欠勤機能拡充** ① LINE連携フロー刷新：初回ログイン後 `/link-line` へ誘導→「LINEで連携する」ボタン押下でOAuth開始（`bot_prompt=aggressive`で友達追加も同時完了）。友達チェック廃止（認証と登録を同時完了）。② LINE連携完了時にPWをcrypto.randomUUID×2に自動変更（なりすましログイン防止）。以降はLINEログインのみ有効。③ ポータルレイアウトでline_user_id未設定のユーザーを`/link-line`へ強制リダイレクト。④ LINEブロック検知：`staffs.line_blocked`カラム追加、LINE webhook（/api/line/webhook）でunfollowイベント→true・followイベント→false。スタッフ管理画面にブロック中バッジ（赤）・LINE未連携バッジ（黄）・統計チップを追加。⑤ 欠勤経過報告ページ（/absence-followup）新設：翌日出勤可否を報告→不可の場合は翌日の欠勤報告を自動作成。⑥ シフト展開ボタン（PublishButton）：シフト管理から全スタッフに個人シフトをLINEで一斉送信。⑦ シフト管理グリッドの欠勤セル赤色表示（absence_reportsと連動）。⑧ スタッフ向けシフトカレンダーで変更ログを公休・未登録日にも表示。⑨ 通知追加：holiday_open_notify・absence_followup_remind・absence_followup_notify・shift_published。⑩ ログイン後LINE OAuth直接起動→/link-lineへのリダイレクトに変更（stateクッキーループ修正）。|
| 2026-05-26 | v28 | シフト編集グリッド大改修・不足対応フロー新設・候補スコアリング（詳細は継続タスクに記録）。 |
| 2026-05-26 | v29 | **仮組みアルゴリズム修正・グリッドUI改善** ① セクション指定再仮組みで確定済みシフトが邪魔し配置0件になる問題を3箇所修正（existingMap除外・existingMonthCount除外・alreadyAssigned除外）。② shift_slot_requirements の required_count=0 を「未設定」として扱い自動計算にフォールスルーするよう修正（仮組み時に未入力セルが0でupsertされることで全スロットがrequired=0になりスキップされていた）。③ セクション指定再仮組みでパターンのsectionが未設定の場合に分かりやすいエラーメッセージを表示。④ ShiftEditGridに「← 戻る」「進む →」ボタンを追加（undoスタック＋redoスタックで双方向ナビゲーション）。⑤ 再仮組みモーダルのセクション選択肢から「（他セクションは保持）」の説明文を削除。⑥ PublishButtonにisPublishedを渡し展開済み月はグレーの「✓ 展開済み」バッジ表示・再展開も可能。 |
| 2026-05-26 | v30 | **シフトグリッドUI改善・スタッフ情報パネル新設・色分け刷新** ① 月合計列を右固定（sticky right-0）に変更。② 充足サマリー下にSV配置人数行を追加（violet色）。③ シフトパターンの色分けをセクション×早番/遅番の2軸で刷新（SV=青・査定=緑・販売=橙・MOTA=ティール・リメイク=ピンク・ローン=バイオレット、早番=薄色/遅番=濃色）。希望休系=黒ベース・空白=白。④ StaffInfoPanel.tsx新設：スタッフ名タップでセクション・稼働日数・連勤上限・優先シフト/セクション・備考・退職予定日・希望休申請一覧（優先度グループ別）を表示。第一希望休複数件時に警告メッセージを表示。⑤ page.tsxのSELECT拡張（work_days_type/count・preferred_shift/section・max_consecutive_days・shift_note・source）。⑥ ドラフト変更セルのインジケーターを青テキスト+太字のみに変更（ドット・枠線を廃止）。 |
| 2026-05-26 | v31 | **当日状況に「確定後変更」タブ追加** ① 当日状況ページに「当日シフト」「確定後変更」の2タブを追加。② 確定後変更タブ：shift_month_status.published_at以降にshift_change_logsへ記録された当日分の変更を取得・表示。③ 表示形式はシフトパターン軸：同じパターンで外れた人・入った人をペアにして「変更 A⇒B」で表示、片方のみは「追加」「削除」で表示。変更件数バッジをタブに表示。未展開月は「シフトが未展開です」と表示。 |
| 2026-05-26 | v32〜v33 | 座席表（当日・翌日配置・レイアウト設定）・座席エディタ強化（壁描画・パン・グリッドスナップ0.5刻み・複製・重なり防止・seat_wallsテーブル追加）。/admin ページを project_admin ロールにも開放。 |
| 2026-05-27 | v34 | **ナビ刷新・タスクホーム統合・周知問合せ統合** ① ナビをアカウント種別3種（スタッフ/管理者/運用者）に刷新。② 運用者サイドバーの管理セクション見出しを案件ファイルタブ化（クリックで案件切り替え・switchProjectAction新設）。③ タスク管理をナビから削除しホーム画面に統合：管理者・運用者のホームに[ホーム\|タスク]タブ追加、ホームタブ下部に今日の自分のタスクウィジェット（due_date=当日分・チェックで完了）。④ /notices/manage を周知事項と問い合わせのタブ統合ページに改修（CommunicationsManageClient・未返信バッジ）。 |
| 2026-05-27 | v36 | **当日状況 欠勤/遅刻 詳細モーダル** ① 欠勤スタッフ行（w-14プレースホルダー部分）を「詳細」ボタンに置き換え。② 遅刻スタッフ行の「催促する」ボタン横に「詳細」ボタンを追加。③ 詳細モーダルに報告時刻・理由・翌日/翌々日出勤可否（欠勤）または到着目安（遅刻）を表示。④ absence_reports/late_reportsのクエリにcreated_at・next_day_available等を追加。|
| 2026-05-27 | v39 | **座席表フリー席・無効席** `seats.seat_type text DEFAULT 'normal'` カラム追加。フリー席（誰でも配置可・緑枠）・無効席（使用不可・ハッチング表示）をSeatLayoutEditorで設定可能に。SeatingClient・SeatingPlanClientにタイプ別表示を追加。autoAssignSeatsActionで無効席除外・フリー席はセクション問わず配置。 |
| 2026-05-28 | v42 | **座席表改善・シフト管理UI刷新** 壁SVG表示（SeatingClient/SeatingPlanClient/AttendanceClient）・キャンバス1800px統一・水平スクロール対応。翌日配置：DnDカード入替・席ラベル削除・シフト名プレフィックスでセクション色解決・フリー席ドラッグ可・自動配置ロジック（セクション席は同セクションのみ、フリー席に余剰スタッフ、既存配置保持）。seatColors.ts：resolveShiftSection/formatSectionShift追加。シフト管理ツールバーに月ナビ・シフト展開・Excel出力を統合。Excel出力はアカウント番号順ソート・xlsxライブラリ。 |
| 2026-05-28 | v46 | **仮確定単一化・同時編集ロック** 枠確定（slot_locked_sections）廃止・仮確定は人確定1種類のみ。shift_grid_drafts に editing_by/editing_at カラム追加、グリッド編集モード開幕時に排他ロック取得（TTL5分・3分ハートビート）。他ユーザー編集中は保存/再仮組み/確定ボタン無効＋警告バナー表示。ロック切れ時は自動取得または「引き継ぐ」ボタンで手動引き継ぎ可。 |
| 2026-05-28 | v45 | **当日状況から座席表タブ削除** `/attendance` の「座席表」タブ（当日座席・翌日配置）を完全除去。座席表は `/seating` 専用ページに集約。AttendanceClient から SeatingClient/SeatingPlanClient 関連コードをすべて削除。page.tsx から seats/seat_assignments/seat_walls/tomorrowShifts のフェッチも削除。 |
| 2026-05-28 | v44 | **打刻ページ座席表統合・席替えモード・Realtime** `/punch/[projectId]` に「座席表で打刻」「名前で打刻」タブ切り替えを追加。席タップで出勤/退勤/休憩入り/休憩終了を打刻可能。ステータス色分け（未出勤/勤務中/休憩中/退勤済/欠勤）。打刻端末は30秒ポーリング（/api/punch/[projectId]/statuses 新設）。/seating に Realtime 対応（punch_logs INSERT で即時更新、supabase_realtime publication 追加）。管理者向け「席替え」ボタンを /seating に追加（その場で今日の座席を変更・自動配置も可能）。terminalBreakAction（認証不要・adminClient）追加。TerminalMember 型に onBreak/isAbsent/section/accountNumber/hasShiftToday を追加。 |
| 2026-05-28 | v43 | **シフト管理Excel出力改善・アカウント番号表示・並び順トグル** Excel列順を名前→番号→日付に変更・番号形式をASS 01統一・番号なしメンバーを末尾追加・公休/研修/非セクションシフトを空白化・括弧を半角化。ShiftEditGridにアカウント番号サブテキスト表示。並び順トグルボタンをシフト管理ツールバー＋編集グリッドツールバー両方に追加（番号順モード：SV固定上部・SV以外フラット番号順）。 |
| 2026-05-27 | v40 | **シフト編集スタッフ情報パネル・希望休CRUD** OffRequestSection.tsx新設（カレンダー+優先度選択+削除チップ）。追加時→即時ドラフト反映・削除時→即時ドラフトクリア。「設定をシフトに保存・反映」を完全置換方式（replaceStaffHolidayDraftAction）に変更。 |
| 2026-05-27 | v38 | **仮組み余剰配置改善** 余剰配置ループで不足パターン（早番優先）を先に試みるロジック追加。遅番優先スタッフでも早番スロットが不足していれば早番に割当。 |
| 2026-05-27 | v37 | **スタッフ詳細設定に希望給追加** `project_members.desired_wage integer` カラム追加。メンバー設定モーダルの基本設定セクションに希望給（円/時）入力欄追加。メンバー一覧カードに¥1,200/h形式バッジ表示（設定済みのみ・アンバー色）。|
| 2026-05-27 | v35 | **スタッフ設定モーダル再構成・研修設定UI刷新** ① `staff_trainings`に`training_name text`・`start_time time`・`end_time time`カラム追加（Supabase MCP）。② `TrainingSection.tsx`を全面リライト：「研修日を設定」ボタン→展開パネル（導入研修/研修/案件研修/カスタムの4タイプ選択・時間入力・複数日カレンダー選択・登録済みは半透明表示・タイプ別グループ表示+×削除チップ）。③ メンバー編集モーダルを4セクションに再構成（基本設定：氏名/所属会社/ロール/アカウント番号/セクション/アサイン日、シフト設定：稼働日数デフォルト月21日/優先セクション/優先パターン/連勤上限、研修設定：TrainingSection、離脱処理）。④ シフト設定折りたたみを廃止・常時表示化。⑤ 新規スタッフ追加のアサイン日を必須に変更（未入力時「作成して追加」ボタン無効）。⑥ 仮組みロジック（draft-actions.ts）のtrainingEntries生成でtraining_name/start_time/end_timeを使用、validShiftNamesに研修名を動的追加。|
