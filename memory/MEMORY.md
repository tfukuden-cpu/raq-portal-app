# Raq Works 開発メモリ

> AIが作業を始める前に必ず読む。SPEC.md と合わせて使う。

---

## システム概要

合同会社Raqの社内ポータルPWA。Next.js 16 + Supabase + LINE通知。  
スタッフの勤怠・シフト・座席・通知を一元管理する多テナントシステム。

**開発スタイル:** バイブコーディング（JS/SQL未経験ユーザーがAIに指示して進める）

---

## 現在の開発状態（2026-06-25更新）

### 自動仮組の連勤上限バグ修正（6連勤以上が出る）（2026-06-25・本番反映済・案件=IDOM）
**ユーザー報告「自動仮組で6連勤以上で組まれる人がいる、やめてほしい」。P001は全144名が `max_consecutive_days`=null＝デフォルト5連勤のはずなのに6連勤以上が発生。**
- **原因＝連勤判定が「前」だけ見ていた**: `draft-actions.ts` の `consecutiveDaysBefore` は当日より前の連続日数のみ数えていたが、仮組はラウンドロビン(round毎にstride=11で開始日ずらし)＋余剰配置で**日付を飛び飛びの順に割り当てる**ため、後から間を埋める割当で前後の連勤区間が連結し上限超過。例(上限5): 先に6日を割当→後で1〜4日→5日を割当時に「前」だけ見ると1〜4=4連勤でOK判定→結果1〜6日の6連勤成立
- **修正**: `consecutiveDaysAfter`（当日より後の連続日数）と `wouldExceedConsecutive(staffId,date,max)=before+1+after>max` を追加し、候補フィルタ(ラウンドロビン)・余剰配置の両方の連勤チェックを `>= maxConsec`(前のみ)→`wouldExceedConsecutive`(前後)に置換。`existingDateSet` は前月末＋当月確定シフトを含むので確定シフトとの連結も防げる。`consecutiveDaysBefore` はソート用キャッシュ・診断で引き続き使用。tsc 0エラー

### 仮組から「インフォ（=販売/インフォ）・H MOTA」を除外（2026-06-25・本番反映済・案件=IDOM）
**ユーザー指示「販売/インフォ（＝インフォ）とヘルプモーター（=H MOTA）は手動編集するので仮組に組み込まない」。⚠️当初「販売・インフォ・H MOTA」と誤解し `販売` まで除外→販売スタッフ多数(28人)が全日空欄になり指摘で訂正。`販売` セクション(販売早番/遅番)は仮組に含める。MOTAも従来どおり対象。**
- **セクション対応（P001・要注意）**: パターン「販売/インフォ」の所属セクションは **`インフォ`**（ユーザーは「販売/インフォ」と呼ぶがセクション値はインフォ）。「ヘルプMOTA」パターンの所属は `H MOTA`。販売早番/販売遅番は `販売`。除外するのは **`インフォ` と `H MOTA` の2つだけ**
- **共有定数 `src/lib/shift-draft-config.ts`（plain・"use server"なし）**: `MANUAL_DRAFT_SECTIONS=["インフォ","H MOTA"]` / `isManualDraftSection(section)`。P001のセクションは `H MOTA/MOTA/SV/インフォ/ローン/未アポ/未成約後追い/査定/販売`
- **サーバー `generateShiftDraftAction`（draft-actions.ts）**: `allPatternDefs=[...patterns]`（全パターン）を確保した**後**に `patterns` から除外セクションをフィルタ→ラウンドロビン・余剰配置の対象外に。`validShiftNames` は `allPatternDefs` 由来なので**既存の手動エントリは有効扱いで保持**（stale化しない）。`targetSection` が除外セクションなら明示メッセージで弾く。**全呼び出し経路（設定ページの仮組／グリッドの全体・セクション再仮組み）を1か所でカバー**
- **UI除外**: 再仮組みモーダルのセクション選択肢(`ShiftEditGrid.tsx` sectionOptions に `isManualDraftSection` フィルタ)＋設定ページ必要人数グリッド(`ShiftDraftSection.tsx` は prop を `allPatterns`→`useMemo` で除外して `patterns`)
- **挙動の注意**: 「全セクションを再仮組み」と設定ページの仮組はドラフト全体を作り直すため、その時点で手動入力済みの除外2セクションのドラフトも消える（従来から全体再仮組みは全手動編集を破棄）。**特定セクションの再仮組みでは除外2セクションは保持**。確定済み `shifts` テーブルは再仮組みで一切触らない。tsc 0エラー

### 仮組生成が希望休を読むテーブルを修正（2026-06-25・本番反映済・案件=IDOM）
**ユーザー報告「7月の仮組作成時に7月希望休が反映されていない」の原因を特定し修正。**
- **原因＝希望休テーブルが2系統で、仮組が間違った方を読んでいた**: スタッフの希望休申請は `shift_off_requests`(第1〜第4希望priority付・実運用で使う方／`staff-off-request-actions.ts` が保存)に入るが、仮組生成 `draft-actions.ts` は別系統の `holiday_requests`(status付・ほぼ未使用)を読んでいた。7月P001は `shift_off_requests`=325件／`holiday_requests`=3件で、実質希望休が除外されず希望休日にも自動配置されていた
- **修正**: `draft-actions.ts` のデータ取得を `holiday_requests`→`shift_off_requests` に変更（カラム `staff_id`/`request_date` は両テーブル共通なので1クエリの差し替えのみ。`holidayRows`/`holidaySet` の変数名はそのまま）。tsc 0エラー
- ユーザー補足: 販売/インフォは手入力するので仮組の自動反映は不要（が、希望休除外は全セクションに効く独立の修正なので適用）

### 勤怠管理「勤怠実績」タブの修正5件（2026-06-25・本番反映済・案件=IDOM）
ユーザー報告を順次対応。コミット `e020621`(全件取得)〜`8f6079d`(未来日)〜`dc039ca`(希望休)〜`1b629d1`(遅刻早退除外)〜`eb932d7`(欠勤除外)。対象は `/attendance/edit` の勤怠実績タブ＝`page.tsx`（行データ算出）/`AttendanceEditClient.tsx`（明細＋サマリー）/`AttendanceSummarySection.tsx`（実績出力モーダル）/`work-record-actions.ts`（実績サマリー集計）。

- **「8日までしか表示されない」＋「一部スタッフの打刻が無い」＝同一原因**: `page.tsx` が `shifts`(月3669件)/`punch_logs`(月4138件)を `.limit(20000)` の単発クエリで取得していたが、**PostgRESTのdb-max-rows=1000で先頭1000行に切られる**（`.limit`では超えられない）。shiftsは日付昇順1000行＝6/8(累積968行)・6/9(1090行)でちょうど切れ「8日まで」、punch_logsは時刻昇順1000行で後半スタッフの打刻欠落。→ `work-record-actions.ts` と同じ **1000行ずつ `.range()` ループの `fetchAllShifts`/`fetchAllPunches`** に置換。地雷表に追記済。**他に1000超えするテーブルは無い**(absence109/late42/corrections129/members144 等は上限以下)
- **未来日の未打刻を打刻漏れにしない**: `shift.shift_date > today(JST)` の日は status を `ok` に（まだ出勤前なので当然）。`page.tsx`＋`work-record-actions.ts` 両方。集計側は未来日を出勤数に含めず totalDays のみ計上
- **希望休がOFF_SHIFT_NAMESに無く打刻漏れ化**: 「希望休」が休日リストに入っておらず勤務日扱い＝打刻漏れになっていた(6月313件)。`OFF_SHIFT_NAMES` に「希望休」を追加した箇所＝`edit/page.tsx`・`edit/work-record-actions.ts`・`api/admin/work-records/export/route.ts`・`api/admin/work-records/compliance/route.ts`(他の`attendance/page.tsx`等は既に希望休入り)。研修/導入研修は稼働日なので除外しない
- **問題件数(errorCount)＝打刻漏れのみに**: 当初 `status !== "ok"` で遅刻・早退・欠勤も問題に算入していた。**遅刻・早退・欠勤は理由/承認付きで正しく記録された状態なので除外**し、`no_clockin`/`no_clockout`(打刻漏れ)のみカウントに変更。`AttendanceEditClient` の errorCount＋`AttendanceSummarySection` の hasIssue/issueCount を揃えた
- **ステータスは1日1つ・優先順位判定**(`page.tsx` 265-271): 欠勤→(未来日→ok)→出勤未→退勤未→遅刻→早退。**打刻漏れが遅刻/早退より先**なので、遅刻/早退の日に打刻漏れが重なると status は no_clockin/no_clockout になり**問題件数に入る**（「ちゃんと打刻が揃った遅刻/早退」だけが除外される）
- 残課題: 「欠勤報告なし・勤務シフトあり・打刻なし」の無断欠勤(6月58件)は記録が無いため打刻漏れ表示のまま（仕様判断保留）。早朝(9時前)打刻のUTC日付ズレ(`recorded_at.slice(0,10)`)は潜在バグだがIDOM6月は該当0件

### 改修依頼8件（#12〜#19）対応（2026-06-20・本番反映済・案件=IDOM）
スプレッドシートの改修依頼8件を対応。コミット `fd45c50`(6件)〜`d7a20f8`(FB)〜`7d3700e`(撤回)〜`316019e`(#14)〜`7ec27b9`(#16)〜`88d78a4`(#15最終)。

- **#12 希望休受付開始のLINE（春原）**: `api/cron/notify/route.ts` の `holiday_open_notify` で、ループ内のグループ個別送信を廃止し**末尾で1通のレポート**（締切日・通知人数・セクション別一覧・未通知者）に集約。`rest_day_remind` と同パターン
- **#13 欠勤報告に振替出勤可能日（滝沢）**: `AbsenceModal.tsx` Step3 に日付入力(任意)追加→`submitAbsenceAction` で `absence_reports.substitute_work_date`(新カラム)に保存・スプシ追記・LINE文にも反映
- **#14 欠勤者レポートタブ（長尾）**: 勤怠管理(`/attendance/edit`)の**遵守率タブを廃止**し「欠勤者レポート」タブ(`absentees`)を新設。`AbsenteeReportClient.tsx` ＋API `GET /api/admin/work-records/absentees?projectId&month`。当月の欠勤者を日毎/人別で一覧、人別タップで過去1年の出勤率/出勤数/欠勤数。`WorkRecordsClient`(遵守率)はAttendanceEditClientから外したが他所では残置
- **#15 インフォ＝販売／インフォ（安積）**: **出勤簿(`attendance/page.tsx`)では `mergeInfo()` でインフォ→販売に統合**(列廃止`sectionOrderDisplay`・人数も販売にカウント・`moveSectionAction`は`shifts`のみ更新で安全)。インフォは**スキルとして`project_members.sections`に保持**。出勤簿カードのバッジは、インフォ(スキル)は従来通り表示しつつ、**当日シフト名が「販売／インフォ」の人(`MemberRow.infoToday`=`shift_name.includes("インフォ")`)はアンバー強調＋「★インフォ」**で区別。⚠️**シフト管理側のセクション表示マージは撤回**(StaffInfoPanel保存でインフォが消える事故＝地雷参照)
- **#16 日次報告タブ（安積）**: 当日状況に「日次報告」タブ(`report`)新設。`DailyReportTab.tsx`。優先セクション(=`project_members.section`、販売/査定)ごとにアカウント番号順で一覧。列= ASS○○(=ASS+優先) | アカウント番号 | シフト(7.5固定) | 商材(=優先セクション) | 欠勤(チェックボックス・欠勤報告から自動チェック・手動可) | 追加(優先≠当日セクションで✓) | 当日セクション。exceljsでExcel出力(スプシ貼付用)。`page.tsx`が`dailyReportRows`算出
- **#17/#19 並び順・列幅（滝沢/瀬貫）**: シフト編集の**手動順がlocalStorage保存で番号順より優先され直らなかった**のが#19の真因。`ShiftEditGrid.tsx` の `rowOrderOverride`(localStorage)を廃止→**基本アカウント番号順、SVのみ▲▼で手動並び替え→DB `project_members.sort_order`(新カラム)に保存**(`setSvOrderAction`)。`ACCT_W`68→92・`NAME_W`88→112で3桁/名前の見切れ解消
- **#18 H MOTA誤表示（矢野）**: `attendance/page.tsx` の hMotaRows を「当日シフト無し」→**「当日MOTAシフト無し」(`motaShiftIds`=shift_nameがMOTA/H MOTAで始まる)基準**に修正。他セクション出勤中の人(`isWorking`)はH MOTAの両スロットに本人名を自動表示(`HMotaPanel` MotaTableRow)
- **DBマイグレーション(本番適用済)**: `add_project_members_sort_order`(`project_members.sort_order int`) / `add_absence_substitute_work_date`(`absence_reports.substitute_work_date date`)。どちらもnullable追加
- **データ事故と復旧**: #15のシフト管理マージで `project_members.sections` のインフォが保存時に消失。S019は`["販売","インフォ"]`に手動復元・S125は無傷。**他の複数名も消えた可能性あり＝ユーザーからインフォ担当者リストをもらい次第一括復元(残作業)**。変更履歴テーブルが無く自動復元不可
- **改修報告書**: `docs/改修報告/改修内容報告書.html`＋`.pdf`(Edgeヘッドレス印刷)。スクショ枠あり(拡張のスクショはファイル保存不可のため未埋め込み)
- 残: インフォ担当者リスト復元 / #16の「優先セクション」がsection(基本)でよいか確認 / 報告書のスクショ差し込み

### デバッグ/Lint整備＆デッドコード掃除（2026-06-14・本番反映済）
- **現状**: TypeScript 0エラー / ESLint **0エラー**（warning 73）。コミット `9a64f20`〜`213f538`
- **開発環境（2026-06-14更新・node導入済）**: ユーザーが node を導入し **Bash/PowerShell 両方のPATHに通った**（`node` v24.16.0 / `npm` 11.13.0・実体 `C:\Users\fukud\OneDrive\デスクトップ\Rap\node.exe`）。**今は `npm run dev` / `npx tsc --noEmit -p tsconfig.json` / `npm run lint`(=eslint) / `next build` がそのまま使える**（以前の「npx空振りで誤通過」は解消）。
  - tsc前に `.next` を消すと、削除済ファイルを参照する `.next/types` の偽エラーが消える
  - 〔履歴〕導入前は playwright同梱 `/c/Users/fukud/AppData/Local/ms-playwright-go/1.50.1/node.exe` を直接指定して凌いでいた（フォールバックとして記憶）。**PATH反映には Claude Code の再起動が必要だった**
- **Next 16 はビルド時にESLintを実行しない**＝lintエラーがあってもVercelデプロイは通る（lintは品質チェック用）。ローカル `next dev` は `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` 未読込で500＆認証必須のため再現確認は困難
- **eslint.config.mjs 方針**: React Compiler系の新ルール（`react-hooks/set-state-in-effect`/`refs`/`purity`/`immutability`/`static-components`）は誤検出が多いため **error→warn に降格**（可視化は維持）。`@typescript-eslint/no-unused-vars` に `ignoreRestSiblings`＋`^_`無視を追加。`set-state-in-effect`（マウント時fetch）は基本無害＝個別対応しない方針
- **直した実バグ**: LineConnectionSection `isPolling`(ref→state) / SeatingClient `useState(Date.now())`(#418源→0+useEffect) / ShiftsTabs 入れ子`ShiftDetail`を関数化(再マウント防止) / 休憩室管理操作にサーバー側adminチェック
- **デッドコード**: 未使用import/変数を51件削除(27ファイル・最大は ShiftEditGrid の死蔵 `EditModal` -272行)。tsc 0維持で挙動変更なし。残23件は意図的保持(引数/useStateの値側/副作用呼び出し/MEMORY記載の残置)

### バトル土台＋モンスター管理(/monsters)＋ホームアイコン（2026-06-14・実装済・未デプロイ）
**ユーザー指示「今後バトル機能を追加。図鑑説明・基礎能力値・Lvアップで努力値割り振りを設計。ガチャはナビ廃止しホームのキャラエリアにガチャ/モンスターアイコンを出す」**
- **育成データ `src/lib/monster-stats.ts`（plain・"use server"なし）**: 6ステータス `hp/atk/def/spa/spd/spe`(=HP/こうげき/ぼうぎょ/とくこう/とくぼう/すばやさ)／8属性+無 `Element`(火水草雷氷地風闇)＋相性表 `elementMultiplier`／5ロール `Role`(アタッカー/タンク/スピード/まほう/バランス=基礎値配分)。`baseStats(id)`=レア度合計(★1:180〜★5:470)×ロール配分×id個体差(±8%)。`computeStats(id,level,evs)`／レベル1〜50・`expToNext`/`levelFromExp`・努力値 `EV_PER_LEVEL=3`/`EV_MAX_PER_STAT=100`/`EV_MAX_TOTAL=150`・`evBudgetForLevel`。150体ぶんの `属性/ロール/図鑑説明` を `BATTLE_DATA`(画像に合わせて設定)・`monsterDex(id)`/`MONSTER_DEX`
- **DB（適用済 `staff_partners_battle_columns`）**: `staff_partners` に `level/exp/ev_hp..ev_spe/party_slot(1〜3)` 追加。**育成は所持インスタンス(staff_partners.id)単位**。`UNIQUE(staff_id,party_slot) where not null`（パーティー枠重複防止）
- **`/monsters` ページ**（`src/app/(portal)/monsters/` page+MonstersClient+actions）: タブ **パーティー(3体)/てもち/ずかん**。てもち→インスタンス詳細(育成: レベル仮調整・努力値±5振り分け・パーティー枠1-3セット)・ずかん(150体・未所持はシルエット＋???)。アクション `getMonsterCollectionAction`/`setPartySlotAction`/`allocateEvAction`/`setLevelAction`(adminクライアント)。**連れ歩き(active_partner_id)とパーティー(party_slot)は別管理**
- **ホーム/ナビ改修**: `layout.tsx` の `staffMenu` からガチャ項目を**削除**（ナビに出さない）。`HomeClient` ヒーローステージ右下に **なかま(→/monsters)** と **ガチャ(→/gacha)** のアイコン追加。**両方とも `myStaffId==="O002"` のみ表示**（ガチャ未開放のため機能一式をO002限定に統一）。`/monsters` page も `MONSTERS_ALLOWED=["O002"]` で非O002は/dashboardへredirect（/gachaのGACHA_ALLOWEDと同様）。**全員開放時**: page.tsx の ALLOWED撤去＋HomeClient の `myStaffId==="O002"` 分岐撤去
- ⚠️ **レベルは現状「仮調整」**（詳細モーダルの±ボタン・`setLevelAction`）＝バトル未実装のため。バトルで経験値→レベルアップ→努力値付与の流れにする予定。努力値UIはLv1だと予算0で振れない（レベルを上げると振れる）
- バトル相性表 `ELEMENT_STRONG_AGAINST`/`STRONG_MULT(1.5)`/`WEAK_MULT(0.67)` は暫定（バトル実装時に調整）
- **/monsters のUI微調整（2026-06-14・デプロイ済）**: 図鑑/手持ち/パーティーの各カードに**レア度★＋色枠**・ずかんに凡例／**パーティー3枠＋タブを上部固定(sticky)**し下の手持ちをスクロール（タップで空き枠へ編成・もう一度で外す・枠番号バッジ）／**詳細モーダルのモンスター画像を正方形(max-w-320px aspect-square)に拡大**。コミット `3aba438`(レア度表示)〜`3485602`(正方形拡大)

### 外部生成ツール（ChatGPT＝静止画 / Higgsfield＝動画）= SPEC §10 に集約
- **静止画(キャラ/モンスター/UI)はChatGPT**（Higgsfield禁止・ユーザー指示）。アカウント=拓也福傳Plus。Chrome拡張でchatgpt.com→DL→`MONSTER/sheetN.png`→`resplit-rpg-sheet.ps1`分割。1シート=5列×2行=10体・`STARTIDX=(N-1)*10+1`・`$env:PREFIX`(char/mon)。既存ゲーム模倣NG
- **動画/演出はHiggsfield**: ガチャ召喚 `gacha-summon.mp4`(Kling3.0・約7.5cr・9:16・`object-contain`表示)。静止画には使わない
- 素材を同一URLで差し替えたら `public/sw.js` の `CACHE_VERSION` を上げる。詳細は **SPEC.md §10「画像・動画生成」**

### モンスターを150体・5段階レアリティに全面刷新（2026-06-14・コード/DB/画像すべて完了・未デプロイ）
**ユーザー指示「レア度を加味して全150体に完全に作り直す」。72体→150体・★4段階→★5段階。トーンは紆余曲折の末「カッコいい・勇ましい・完全オリジナル造語・ドット絵」に確定（DQ模倣→却下、可愛すぎ→却下を経て）。**
- **レア度ピラミッド（id昇順＝レア度昇順）**: ★1ノーマル(mon1-50・50体・50%・グレー#cbd5e1)／★2レア(51-90・40体・30%・緑#6ee7b7)／★3スーパーレア(91-120・30体・13%・青#93c5fd)／★4ウルトラレア(121-140・20体・5%・紫#c4b5fd)／★5レジェンド(141-150・10体・2%・金#fcd34d)。合計150体・100%
- **変更したコード**: `rpg-chars.ts` `MonsterRarity`に5追加＋`RPG_MONSTERS`を150体に完全置換（カッコいい造語名: ガルル/ツノゴロ…テンオウリュウ）／`gacha.ts` `RARITY_RATES`/`RARITY_INFO`に★5追加・`rarityFromRoll`を[1..5]に・確定枠を新関数`guaranteedRarity(roll)`(★3/4/5を本来比率で按分)に／`GachaClient.tsx` `RARITY_ORDER=[5,4,3,2,1]`・登場バナーを`bestRarity>=4`で`RARITY_INFO[bestRarity].label`表示。**tsc 0エラー**
- **DB（本番Supabase適用済・マイグレーション `monsters_expand_to_150`）**: `staff_partners.monster_id` の CHECK を `1..72`→`1..150` に拡張。旧IDは別モンスターを指すため `staff_partners` 全件DELETE＋`staffs.active_partner_id` 全件null（テストO002の64行のみ）
- **画像 完了（2026-06-14・ユーザー生成）**: 全150枚を `public/rpg/mon-1..150.png` に出力済み。**ユーザーがChatGPTで15シート(5列×2行)を生成→`C:\dev\raq-portal-app\MONSTER\sheet1..15.png` に保存→`scripts/resplit-rpg-sheet.ps1`(PREFIX=mon・STARTIDX=(N-1)*10+1)で一括分割**。元シートは `MONSTER/` フォルダに保存（再分割可）。`sw.js` CACHE_VERSION=**v6**（未デプロイなのでこのままでOK・デプロイで全更新）
- **プロンプト集** `docs/モンスター150体_画像生成プロンプト.md`（共通プレフィックス＋15シートの10体リスト＋分割コマンド・全コピペ可）。`resplit-rpg-sheet.ps1` に **`$env:PREFIX`** 対応を追加（既定char・mon指定で`mon-{n}.png`直接出力。旧`rename-monsters-to-mon.ps1`不要）
- **名前は実画像に合わせて再命名済み（2026-06-14）**: ユーザーが自由生成したため当初ラベル（ガルル等）と絵がズレていた→Claudeが MONSTER/sheet1..15.png を1枚ずつ確認し、各 mon-ID の絵に合う造語名150体に `RPG_MONSTERS` を再設定（ミツメモグラ/エリマキリザ…コンゴウオウ）。**150ラベルすべて絵基準**。tsc 0。⚠️`docs/モンスター150体_画像生成プロンプト.md` の名前は**生成時の旧名**のまま（履歴）＝コード(`RPG_MONSTERS`)が正
- 残: 本番反映は未（`git push origin master`でVercel自動デプロイ・ユーザー承認必要）／連れ歩きパートナーのホーム表示演出は従来通り未実装

### キャラクター体系の全面改訂＝基本職100体＋モンスターガチャ（アバター切替まで完了・本番デプロイ済 / 残=ガチャUI）
**SPEC.md §6-7 に仕様確定。①データ設計→②画像100枚→アバター切替 まで完了し本番反映済み。残るはガチャ画面UIのみ。**
- **🚀 デプロイ状況（2026-06-13・本番反映済）**: 本プロジェクトは `git push origin master` → GitHub → **Vercel が自動ビルド・デプロイ**（本番 https://raq-portal-app.vercel.app）。SPEC §8参照。この日の主なデプロイ済コミット: `2649798`(キャラ100体刷新＋ガチャ基盤)／`419ba30`(ホームを画面半分のゲーム風ステージに・背景home-stage.png)／`bbc55d9`(マイキャラ拡大 h-56/h-80)／休憩室の管理操作にサーバー側adminチェック追加。DB(マイグレーション・rpg_character全件nullリセット)も本番Supabaseに適用済。**masterへのpushは毎回ユーザー承認が必要**（自動モードがブロック・恒久許可するなら settings に permission ルール追加）
- **①で作ったもの（2026-06-13）**: `rpg-chars.ts` に新API追記（`RPG_JOBS`/`RPG_RACES`/`jobCharId`/`jobCharInfo`/`jobCharImg`/`jobCharIdFor`/`RPG_MONSTERS`(72・rarity付)/`monsterImg`/`monsterById`。旧 `RPG_CHARS`/`rpgCharFor`/`rpgCharImg` は残置）／抽選ロジック `src/lib/gacha.ts`（plain・`drawGacha`/`rarityFromRoll`/`pickMonster`/`gachaPlan`/`RARITY_RATES`/`RARITY_INFO`/コスト定数）／サーバーアクション `src/app/(portal)/gacha/actions.ts`（`drawGachaAction`/`getGachaStateAction`/`setActivePartnerAction`・UI未接続）／DB: `staff_partners`＋`staffs.active_partner_id`（マイグレーション create_staff_partners 適用済）
- **②画像 完了（2026-06-13）**: 基本職100体 `char-1..100.png` 生成済（ChatGPTで `jobs-sheet1..10.png`→`scripts/resplit-rpg-sheet.ps1` で分割。1シート=5列種族×2行職業=10体・行優先IDが `(職-1)*5+種族` に一致）。**方針=「全員別人」**（職業ごとに性別・年齢・髪色・配色・ポーズをばらす。種族列は強調）。プロンプト集 `docs/基本職100体_画像生成プロンプト.md`。モンスター退避 `char-37..108`→`mon-1..72`(72体) も完了（`scripts/rename-monsters-to-mon.ps1`）
- **アバター切替 完了（2026-06-13）**: `rpg-chars.ts` の旧 `RPG_CHARS`(100体に再定義・label="種族の職業")/`rpgCharFor`(→1-100)/`rpgCharImg`(→char-N.png) を**シグネチャ互換のまま新100体システムに差し替え**。これで My・AppNav・ホーム・打刻端末・休憩室は**無改修で切替**（呼び出し箇所は変更不要だった）。`staffs.rpg_character` 全件nullリセット済（32件→各自ハッシュ自動割当・再選択可）。`sw.js` CACHE_VERSION v3→v4。新コードは `jobCharIdFor`/`jobCharImg`/`jobCharInfo` を直接使ってもよい（同結果）
- **ガチャUI 実装（2026-06-14・福傳O002限定公開）**: `src/app/(portal)/gacha/page.tsx`（`GACHA_ALLOWED=["O002"]` 以外は `/dashboard` redirect）＋`GachaClient.tsx`（RPG風・単発100/10連1000・★レア枠＋NEW・所持グリッド・タップで連れ歩き設定）。**演出は Higgsfield動画版**: spin(マシン回転で待機)→charge(召喚ムービー `public/rpg/gacha-summon.mp4` 全画面再生・タップでスキップ)→reveal(`onEnded`でカードポップ＋閃光/粒子)。素材=capsule/flare/spark(ChatGPT)・summon動画(Higgsfield Kling3.0・7.5cr)。動画8.5MB・SWキャッシュ。**演出を変えるなら GachaClient のオーバーレイ＋draw()のgoVideo**。**⚠️ 動画は `object-contain` で表示（`object-cover` だとスマホの縦横比とズレてカプセルが見切れる・2026-06-14修正）**。動画を作り直す場合はアスペクト比に注意（現状9:16）。ナビ「ガチャ」は `layout.tsx` の `staffMenu`(staffId==="O002"のみ追加)。アイコンは `Trophy`。**全員開放時**: page.tsx の `GACHA_ALLOWED` 撤去＋layout の O002 分岐撤去。`drawGachaAction`/`getGachaStateAction`/`setActivePartnerAction` 接続済。**⚠️ 福傳の実アカウントは `O002`（executive）。`S001` は別のテスト用**（login_bonuses.staff_id は staffs.id へのFKあり＝存在しないIDにinsert不可）。テスト用に O002 のコインを 99,999,999 に設定済
- **②で残っている作業**: 連れ歩き(`active_partner_id`)パートナーを**ホーム等でアバター隣に表示**する演出（ガチャ画面での設定自体は実装済）／キャラ選択UIは現状フラット100体グリッド（将来 職業/種族でグループ化の改善余地）

### 投稿メニュー廃止（2026-06-13）
- スタッフメニューの「投稿」(`/post`・社内掲示板) を**ナビ・ページとも削除**。`STAFF_ITEMS` から項目除去／`src/app/(portal)/post/`(page/PostClient/actions) 削除／AppNav の `isNoScrollPage` から `/post` 判定除去。URL直打ちも404。`posts` テーブルは残置・未使用。AGENTS.md ルール15の `/post` 例も一般化に修正

### 勤怠実績 /record を王道RPG風に（2026-06-13）
- `RecordClient.tsx` を見た目だけRPG化（ロジック＝補正申請モーダル・統計・テーブルは無変更）。`rpg-ui.tsx` の `RpgWindow`/`BlinkCursor`/`dotGothic`/`RPG_PAGE_BG`/`RPG_KEYFRAMES`/`RpgStarfield` を使用。`page.tsx`(データ算出)は変更なし
- 構成: 星空ヘッダー「★きんむ きろく」＋アンバー月ナビ → メッセージウィンドウ → 「そうかつ」総勤務(アンバー大字)＋統計6項目 → アラート → 「★きんむの きろく」ダークテーブル(本日=アンバー行・じょうたいバッジ)。補正モーダルもRPG枠
- 白帯対策: main は `min-h-[100dvh] md:h-dvh md:overflow-hidden`＋`RPG_PAGE_BG`、スクロール領域 `pb-36 md:pb-6`。`loading.tsx` もダーク化
- **非機能だった 日別/週別/月別タブを撤去**。印刷用CSS(`.record-table`)は維持（印刷時は白地黒字に上書き）
- props の `projectName`/`complianceRate` は未使用に（型は残置）
- **基本職アバター100体 = 20職業 × 5種族**。職業順: ゆうしゃ/せんし/まほうつかい/そうりょ/ぶとうか/とうぞく/ゆみつかい/きし/パラディン/けんじゃ/おどりこ/しょうにん/にんじゃ/さむらい/りゅうきし/ガンナー/ネクロマンサー/ドルイド/うらないし/あそびにん。種族順: ヒューマン/エルフ/ドワーフ/じゅうじん/りゅうじん。`charId = (jobIndex-1)*5 + raceIndex`（1〜100）。画像 `char-{1..100}.png`。`staffs.rpg_character` に保存（既存値は②で全件 null リセット予定）
- **モンスター72体＝パートナー専用**（アバターには使わない）。画像を `char-37..108.png` → `mon-{1..72}.png` にリネーム（`monId = oldId-36`）。レアリティ＝カテゴリ: ★1かわいい(1-12,50%)/★2妖精亜人+アンデッド(49-72,35%)/★3つよい+魔人悪魔(13-24,37-48,12%)/★4ドラゴン幻獣(25-36,3%)
- **ガチャ**: 単発100コイン・10連1000コイン(★3以上確定)。**重複所持OK（還元なし・将来の育成/合成への布石）**。コインは既存 `login_bonuses.coins` を消費。既存アバターは移行時に全件nullリセット（ユーザー確定済み）
- **新DB**（未作成）: `staff_partners(id 代理PK, staff_id, monster_id 1-72, obtained_at・全社共通・重複行あり得る/複合PK不可)` ＋ `staffs.active_partner_id int`（連れ歩き中）。ガチャ更新は admin クライアントで残高チェック→減算→insert を1アクション
- **rpg-chars.ts 改訂方針**: 旧 `RPG_CHARS`(108フラット) 廃止 → `RPG_JOBS`(20)/`RPG_RACES`(5)/`jobCharId`/`jobCharInfo`/`jobCharImg` ＋ `RPG_MONSTERS`(72・rarity付)/`monsterImg`。旧 `rpgCharFor`/`rpgCharImg` の呼び出し箇所（My・AppNav・打刻端末・休憩室）を差し替え。画像差し替え時 `sw.js` CACHE_VERSION を上げる

### 直近の作業（シフトメニューを王道RPG風に刷新）
- スタッフの `/shifts` をホーム/打刻端末と同じRPGの世界観に統一（夜空グラデ＋DotGothic16＋紺#000846の白二重枠ウィンドウ）
- **共有RPG部品を新設 `src/components/rpg-ui.tsx`**: `RpgWindow`（title対応・className/bodyClassName/h-full対応）・`BlinkCursor`・`dotGothic`（next/fontインスタンス）・`RPG_PAGE_BG`・`RPG_KEYFRAMES`・`RPG_STARS`・`RpgStarfield`。今後ホーム(HomeClient)・打刻端末(TerminalPunchClient)の重複定義もここへ寄せられる（**今回は安全のため既存2箇所は未変更**）
- `ShiftCalendar.tsx`: クエストボード化。月ナビ◀▶（アンバー）、統計「しゅつげき/おやすみ」、本日=金色丸、選択日=アンバー枠。シフトバッジは夜空映えの半透明配色。外枠はRpgWindow相当を手書き（classNameでflex fillさせるため）
- `ShiftsTabs.tsx`: 見出し「★クエストカレンダー」/ボタン「▶きゅうか きぼう」。詳細パネル（PC=サイドパネル「クエストの ないよう」/モバイル=ボトムシート）をRPGウィンドウ化。希望休モーダルもRPG枠
- `StaffOffRequestCalendar.tsx`: 希望休申請カレンダーもRPG化（第1〜4希望=金/シアン/紫/グレー、申請・取下げモーダルRPG枠）
- `HolidayTab.tsx`/`page.tsx`/`loading.tsx`: 背景・余白をRPGに調整
- **修正したバグ2件**（下記「地雷」参照）: ①詳細パネルの曜日計算がローカルTZ依存でhydration mismatch(React #418) ②モバイルで `h-dvh` 固定だとレイアウト由来の白帯(#f4f6fa)が露出

### 直近の作業（ログインボーナス＝コインのガチャ）
- 毎日1回ホームで自動ポップアップするログインボーナス（`LoginBonusModal.tsx`・宝箱を開ける演出）。**連続ログインの概念なし**（累計コイン＋累計ログイン日数のみ）
- DB `login_bonuses(staff_id PK 全社共通, coins, total_logins, last_claimed_date)`（マイグレーション create_login_bonuses 済み・RLSは本人select可）。更新は `claimLoginBonusAction`（dashboard/actions.ts）が admin クライアントで実施
- 抽選は `src/lib/login-bonus.ts`（plain・"use server"なし）の `rollBonus(Math.random())`→ティア5段階（common10/uncommon30/rare50/epic100/jackpot500・期待値≈36/日）。`BONUS_TIERS` がコイン額・見出し・色を持ちクライアントの演出と共用
- **二重受取防止**: claim は当日未受取の行だけ更新（`.or(last_claimed_date is null / lt today)`）。負けたら alreadyClaimed を返す。`last_claimed_date === today(JST)` で受取済み判定
- ホームのヒーローバナー左上に「しょじコイン」バッジ（CoinIcon＝金貨SVG＋数）。`bonusCoins`/`bonusAvailable` を dashboard/page.tsx が homeProps で渡す（AdminHomeWrapper は素通し）。**コインの使い道は未実装**（貯まるだけ）
- 演出 keyframes（bonusShake/bonusBurst/bonusPop）は HomeClient の RPG_HOME_KEYFRAMES に定義（グローバル）
- 画像はChatGPT生成（`public/rpg/bonus-chest-closed.png`/`bonus-chest-open.png`/`bonus-coin.png`）。bonus-sheet.png（3列×1行）を resplit-rpg-sheet.ps1 で分割。Chest/CoinIcon コンポーネントが img で表示（旧SVG版は廃止）。差し替えにより sw.js CACHE_VERSION を v3 に更新

### 直近の作業（ホームに休憩室ウィンドウ＋開放/閉鎖切替）
- ホームに「きゅうけいキャンプ」を追加（**打刻端末の休憩室タブと同一スタイル**: camp-bg-v2.png＋焚き火rpgFlicker/火の粉rpgSpark＋メッセージウィンドウ「なかま N/Mにん」＋箱グリッド）。**箱は1枠のみのコンパクト表示**（人数は「なかま N/Mにん」カウントで把握）: ①閉鎖中=ヘイサちゅう ②自分が入室中=自分のキャラ＋きゅうけいちゅう（アンバー枠） ③満員=あきわく なし ④空きあり=ぼしゅうちゅう「▶くわわる」→先頭の空き箱番号に自動入室（`enterMyBreakRoomAction`＝セッションからstaffId導出→`enterBreakRoomAction`に委譲、休憩打刻中チェックはサーバー側）。退室は「きゅうけいちゅう」カードの退室ボタン。`getBreakRoomStateAction` は staffs join で name/rpgCharId を解決
- 打刻端末の休憩室タブに「▶つかいかた」ボタン→RPG風マニュアルモーダル（はいるとき/でるとき/ちゅうい。ひらがな表記）
- **開放/閉鎖**: `break_room_settings.is_open`（マイグレーション add_break_room_is_open 済み）。ホームで管理者（isAdmin）に「▶閉鎖する/開放する」ボタン。閉鎖中: ホーム=全箱✕・端末=「とざされている……」＋ヘイサちゅう表示・`enterBreakRoomAction` がサーバー側拒否
- statuses API breakRoom に `isOpen` 追加（端末30秒ポーリングで反映）。`BreakRoomState` 型に isOpen・`BreakRoomUse` に name?/rpgCharId? 追加
- dashboard/page.tsx が `getBreakRoomStateAction` を呼び homeProps に `isAdmin`/`projectId`/`breakRoomState` を追加。**AdminHomeWrapper は projectId を自分用に destructure するため HomeClient へ明示的に渡し直している**（忘れると管理者だけ休憩室操作不能）
- **建物名表示（2026-06-13）**: `src/lib/break-room-info.ts` に `BREAK_ROOM_NAME="サンパーク東京銀座708"` / `BREAK_ROOM_ADDRESS="中央区入船1丁目2-8"` を一元管理。ホームの「きゅうけいキャンプ」ウィンドウに「【ばしょ】サンパーク東京銀座708（とほ5ふん）」として表示。打刻端末のマニュアルモーダルにも同定数を使用

### 前の作業（ホームの王道RPG風リデザイン）
- `/dashboard`（HomeClient.tsx）を全面RPG化。夜空グラデ背景＋`DotGothic16`＋ドラクエ風 `RpgWindow`（紺#000846・白二重枠・枠上タイトルラベル）。機能・ロジックは無変更で見た目のみ変換
- 構成: ヒーローバナー（AI生成 `public/rpg/home-hero.png`・Higgsfield nano_banana_pro 2クレジット・星アニメ＋時計＋中央にマイキャラがrpgBobで立つ。タップでキャラ選択）→ メッセージウィンドウ（挨拶＋▼点滅）→ きゅうけいちゅう → きょうのクエスト（シフト）/ステータス（勤怠）→ コマンド（▶欠勤報告 ▶遅刻報告）→ おしらせ → こんしゅうの よてい（週間カレンダー）
- 旧UI（白カード・StatusCircle・マイキャラクターカード・モバイル時計ヘッダー）は削除。キャラ選択モーダル・トーストもRPG配色に変更
- 注意: AdminHomeWrapper の「今日のタスク」ウィジェット（MyTasksWidget）は白カードのまま（未RPG化）。出発/欠勤/遅刻モーダルも白のまま
- **ヒーローステージ（2026-06-13改修・旧stickyバナーは廃止）**: `h-[50vh] md:h-[56vh] min-h-[320px]` の**画面半分**サイズ。通常フロー（スクロールで流れる）。背景は ChatGPT生成の夜の城下町広場 `public/rpg/home-stage.png`（`object-cover object-bottom` で手前の石畳＋キャラを常時表示）＋ビネット（inset box-shadow）。マイキャラは `h-40 md:h-60`＋足元の楕円影。旧 `home-hero.png` は未使用残置。**`home-stage.png` は新規ファイル名なので sw.js バンプ不要**
- **AppNav も RPG化（全ページ共通）**: サイドバー=夜空グラデ＋右白枠＋DotGothic16、アクティブ項目は白枠＋amber▶。PCヘッダー=紺#000846＋白下枠。モバイルボトムナビ=紺＋白上枠＋アクティブamber。アイコンは AI生成ドット絵 `public/rpg/nav-*.png`（`src/lib/rpg-nav-icons.ts` で IconKey→画像をマップ、未定義キーはSVGフォールバック=`NavIcon`コンポーネント）
- **画像生成はChatGPTで行う（Higgsfield禁止・ユーザー指示）**: Chrome拡張(Claude in Chrome)で chatgpt.com にプロンプト送信→画像クリック→ライトボックスの↓でDL→Downloads から public/rpg/ へコピー→ `resplit-rpg-sheet.ps1` で分割。nav-icons-sheet.png（4列×5行・20個）から nav-home/calendar/chart/pen/bell/chat/help/user/users/calendar-gear/idcard/megaphone/clipboard/smartphone/gear/grid/shield/door/crown/star を切り出し済み（door/crown/star は予備）

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
- **キャラクター108体**: 定義は `src/lib/rpg-chars.ts`（id=char-{id}.png と一致）。職業・モンスター・魔人など。`staffs.rpg_character` で本人選択（null=ハッシュ自動割当）。変更UIは2箇所＝Myページ（/my）のプロフィールアイコンタップ（`my/MyCharacterAvatar.tsx`）とホーム（/dashboard）の「マイキャラクター」カード（どちらも `setMyRpgCharacterAction`）。新キャラ追加手順: ChatGPTで4列×3行シート生成 → `scripts/resplit-rpg-sheet.ps1`（$env:SHEET/STARTIDX/COLS/ROWS）で分割 → rpg-chars.ts にラベル追記。**旧 `split-rpg-sheet.ps1` は使用禁止**（グリッド単純切りのため翼などマス境界をはみ出すキャラが断片化する。resplit版は連結成分を重心のマスに帰属させて再構成）。シート→ID対応: sheet2=7-12(3x2)、sheet3〜10=13-24/25-36/37-48/49-60/61-72/73-84/85-96/97-108(各4x3)。ID 1-6 のシートは消失済み（再分割不可）
- **キャラ＝ユーザーアイコン化（2026-06-12）**: 選択キャラを各所のアイコンに使用。①/my プロフィールアイコン（旧 AvatarEditor 顔アバターは /my から廃止、`staffs.avatar_config` と `admin/my/AvatarEditor.tsx` は残置）②AppNav サイドバー下部＋PCヘッダーのユーザー円（layout.tsx が `rpg_character` を取得し `staffId`/`rpgCharId` propsで渡す）③打刻端末 `/punch/[projectId]` の名前選択リスト（イニシャル円→キャラ画像、ステータス色は円背景で維持）。`setMyRpgCharacterAction` は `/my` と layout も revalidate
- サーバーアクション: `seating/break-room-actions.ts`（get/enter/leave/leaveMy/forceRelease/setCapacity/setAmenities）
- **地図リンク**: 端末休憩室タブ「▶ちずをみる」→ Googleマップの徒歩経路ページ（現場⇔休憩室）を新規タブで開く外部リンク（`BREAK_ROOM_MAP_URL` in TerminalPunchClient.tsx）。当初のRPG風マップモーダルは「分かりにくい」とのことで廃止（AI生成画像 `public/rpg/world-map.png` はPDFマニュアル用に残置。旧SVG版 `WorldMapSvgLegacy` も未使用で残置）
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
| 休憩室の管理操作（開閉・定員・設備・強制解放）はサーバー側で管理者チェック必須 | `break-room-actions.ts` の `setBreakRoomOpenAction`/`setBreakRoomCapacityAction`/`setBreakRoomAmenitiesAction`/`forceReleaseBreakRoomAction` は当初UIで隠すだけ＝adminクライアントで無条件更新だった（一般スタッフが直接呼べば実行できる穴）。共通ヘルパー `isProjectAdmin(projectId)`（全社admin/executive または project_admin を session→staffs/project_members で判定）でサーバー側ガード追加済（2026-06-13）。**新しい管理者専用サーバーアクションを作るときは必ず同じガードを入れる**（admin系は UI 非表示だけでは不十分） |
| insert直後のID取得に `.single()` 禁止 | RLSのSELECTポリシーが通らないとエラー。insertとselectを分離し、取れない場合のフォールバックを用意（周知投稿で発生済み） |
| Server Actions のアップロードは bodySizeLimit に注意 | Vercelデフォルト1MB。next.config.ts で `serverActions.bodySizeLimit: "10mb"` 設定済み。クライアント側でも10MB検証を入れる |
| Server Action は全体 try/catch で保護 | 未補足例外がクライアントで「This page couldn't load」クラッシュになる。catchしてエラーメッセージを返し console.error でVercelログに残す |
| クライアントコンポーネントの useState 初期値／レンダー時に時刻・乱数を使わない | SSRとクライアントで結果が変わり hydration mismatch（React #418）になる。`useState("--:--")` 等の固定プレースホルダ＋マウント後の useEffect で確定（HomeClient の挨拶ランダム・AppNav の時計）。**useState初期値だけでなくレンダー本体の `new Date()` も同罪**＝`AdminHomeWrapper` がレンダー時に `new Date().toLocaleDateString(Asia/Tokyo)` で当日タスクを絞っていて深夜またぎ/キャッシュで間欠的に #418（2026-06-13修正）。**当日(JST)はサーバーの page.tsx で算出して props で渡す**こと（client で new Date しない）。**`useState(Date.now())` も同種**＝SeatingClient の超過判定tickが該当（2026-06-14・`useState(0)`＋マウント後 `setNowMs(Date.now())` に修正）。全ソース横断で `useState(Date.now()/new Date()/Math.random())` を grep して潰すのが確実 |
| 周知の添付は1周知1ファイル | `notices.attachment_url/attachment_name`＋`notice-attachments`バケット（public）。周知削除時にストレージも削除すること |
| `"YYYY-MM-DD"+T..+09:00` の `getDay()` はhydration不一致になる | 絶対時刻を実行環境のローカル曜日で返すため、SSR(UTC)とクライアント(JST)で曜日がずれReact #418。曜日は `new Date(ds+"T00:00:00Z").getUTCDay()` で算出する（ShiftsTabs panelDateLabel で発生済み）。※`new Date(y,m-1,d).getDay()`（ローカル構成要素）はTZ非依存で安全 |
| **Supabase(PostgREST)は `.limit(N)` 指定でも1回最大1000行しか返さない** | サーバー側 `db-max-rows=1000` の上限は `.limit(20000)` でも超えられない。数千件あるテーブル(`shifts`/`punch_logs`等)を昇順`.order()`＋単発クエリで取ると先頭1000行で切られる。勤怠管理(`/attendance/edit`)の `page.tsx` で発生＝shifts(月3669件)が`shift_date`昇順1000行＝**6/8で切れ「8日までしか表示されない」**、punch_logs(月4138件)が`recorded_at`昇順1000行＝**後半スタッフの打刻が欠落**。**1000行ずつ `.range(from, from+999)` でループ全件取得する**（`work-record-actions.ts fetchAllShifts/fetchAllPunches` が回避済み・page.tsxにも同方式を移植済2026-06-24）。新規ページで数千件テーブルを全件取るときは必ずページネーション |
| ダーク背景の固定ページは `h-dvh` だと白帯が出る | AppNavのコンテンツラッパーは下部に `pb-safe`/`pb-safe-xl`(9rem)の余白を持ち、その背景はレイアウト由来の `#f4f6fa`。`h-dvh` 固定だとこの余白を覆えず白帯が露出。モバイルは `min-h-[100dvh]`＋ボトムナビ分の `pb-36` でダーク背景を確保し、PCだけ `md:h-dvh md:overflow-hidden` でフル表示にする（/shifts で対応済み） |
| 共有RPG部品は `src/components/rpg-ui.tsx` | `RpgWindow`/`BlinkCursor`/`dotGothic`/`RPG_PAGE_BG`/`RPG_KEYFRAMES`/`RpgStarfield`。新規RPG画面はここから import する。HomeClient・TerminalPunchClient には同名の重複定義が残っている（未統合・触らない限り問題なし） |
| public/ の画像を同一URLで差し替えたら `sw.js` の CACHE_VERSION を上げる | Service Worker が画像をキャッシュしており旧画像が表示され続ける（RPGキャラ画像差し替えで発生済み）。v2 から画像は Stale While Revalidate（次回表示で更新）だが、即時反映したい場合はバージョンを上げて全キャッシュ破棄させる |
| 仮組の連勤上限チェックは「前後」両方を見る | `draft-actions.ts` は日付を飛び飛びの順(ラウンドロビンstride=11＋余剰配置)に割り当てるため、連勤判定を「前」だけで行うと後から間を埋める割当で連勤区間が連結し上限超過(6連勤以上)が起きる。`wouldExceedConsecutive`=`before+1+after>max` で前後を見ること（2026-06-25修正）。新しい割当ロジックを追加するときも同関数を使う |
| 希望休のテーブルは2系統＝実運用は `shift_off_requests` | スタッフ申請の希望休は `shift_off_requests`(priority=第1〜第4希望・`staff-off-request-actions.ts`／管理者一覧も同テーブル)。`holiday_requests`(status付)は別系統でほぼ未使用。**希望休を参照する処理は `shift_off_requests` を読むこと**。仮組生成 `draft-actions.ts` が `holiday_requests` を読んでいて希望休が反映されないバグがあった（2026-06-25修正） |
| **セクションの「表示マージ」を `project_members.section/sections` に適用してはいけない** | `StaffInfoPanel`(`shifts/manage/StaffInfoPanel.tsx`) は `member.sections` を初期値→`updateShiftSettingsAction` で**そのまま保存**する。表示用に props 段階で「インフォ→販売」等とマージすると、スタッフ設定保存時に**実データが上書きされ消える**（2026-06-20 #15対応でインフォが消失＝S019復元）。表示マージは①保存パスに乗らない画面のみ（当日状況の出勤簿＝`moveSectionAction` は `shifts` のみ更新で安全）か、②表示ラベルの差し替えだけに留める。シフト管理側の section マージは撤回済み。`project_members` のセクション変更履歴は残らない＝壊すと復元はリスト手動指定のみ |

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
