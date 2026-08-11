# DBテーブル一覧

> 詳細な用途・カラム定義 → SPEC.md §7

## コアテーブル

| テーブル | 主な用途・主要カラム |
|---------|-------------------|
| `staffs` | スタッフマスタ（name, display_name, global_role, line_user_id, line_friend, avatar_config） |
| `projects` | 案件マスタ（name, is_active） |
| `project_members` | 案件所属（staff_id, project_id, role, section, sections[], work_days_type, account_number, churn_risk, shift_published, **sort_order**=SV手動並び順(2026-06-20追加・#17/#19)） |
| `project_settings` | 案件設定（line_group_id, notification_settings JSONB, enable_departure_report） |

## シフト関連

| テーブル | 用途 |
|---------|-----|
| `shifts` | シフトデータ（staff_id, project_id, shift_date, shift_name, shift_start, shift_end） |
| `shift_change_logs` | シフト変更履歴（before_data, after_data, changed_by） |
| `shift_patterns` | シフト区分マスタ（name, section, sort_order） |
| `shift_openings` | シフト募集 |
| `shift_requests` | 追加申請（opening_id, status） |
| `shift_off_requests` | 希望休申請・優先度付き（priority: 第一〜第四希望休, source）。**実運用で使う希望休はこちら**（スタッフ申請・管理者一覧・仮組生成が参照） |
| `shift_slot_requirements` | セクション別必要枠数（日付別オーバーライド対応） |
| `holiday_requests` | 希望休申請・承認制（request_date, status）。**別系統でほぼ未使用**。希望休を参照する処理は `shift_off_requests` を使うこと |
| `holiday_rules` | 希望休ルール（rule_type, value） 6種類: open_day / deadline_day / monthly_limit_per_person / weekend_limit / daily_limit_count / consecutive_limit |

## 勤怠関連

| テーブル | 用途 |
|---------|-----|
| `punch_logs` | 打刻ログ（punch_type: clock_in/clock_out, recorded_at） |
| `departure_reports` | 出発報告（reported_at, eta_minutes） |
| `absence_reports` | 欠勤報告（absence_date, reason, status, **substitute_work_date**=振替出勤可能日(2026-06-20追加・#13), followup_symptoms, followup_recovery_status 等） |
| `late_reports` | 遅刻報告（late_date, reason, expected_arrival） |

## 周知・コミュニケーション

| テーブル | 用途 |
|---------|-----|
| `messages` | **統合メッセージ**（周知+個別連絡+問い合わせを統合・2026-06-29新設）。1通の本文＋宛先定義。`audience_type`: all=全員 / section=セクション指定(audience_sections text[]) / staff=複数or個人 / admins=スタッフ→管理者(問い合わせ相当)。`sender_staff_id, title, body, is_pinned, allow_reply, attachment_url/name`。RLS=受信者/発信者/案件管理者select |
| `message_targets` | メッセージの受信者1人=1行＝**スレッド単位**。`message_id, project_id, staff_id(受信者・admins宛は発信者本人), staff_read_at, admin_read_at`。UNIQUE(message_id, staff_id)。**受信者展開のinsertはadminクライアントで行う**（他人の行を作るためRLSにinsertポリシー無し）。既読更新は本人/管理者 |
| `message_replies` | メッセージスレッド内の返信（双方向）。`message_id, project_id, thread_staff_id(どの受信者スレッドか=会話相手), author_staff_id(書いた人), body`。RLS select/insert=自分のスレッド or 案件管理者。**全員宛でも返信はthread_staff_id単位＝本人↔管理者の個別会話**になり荒れない |
| `notices` | 周知事項（title, body, is_pinned, target_staff_id）。**messagesへ移行予定→廃止（データ残置）** |
| `notice_reads` | お知らせ既読（staff_id, notice_id）。**廃止予定** |
| `notice_comments` | 周知へのコメント。**廃止予定** |
| `inquiries` | 問い合わせ。**messages(audience_type=admins)へ移行予定→廃止** |
| `notification_logs` | 通知送信ログ（LINE設定の通知履歴で確認可） |

## 座席・休憩

| テーブル | 用途 |
|---------|-----|
| `seats` | 座席定義 |
| `seat_assignments` | 座席割り当て |
| `seat_walls` | 座席レイアウト壁 |
| `mota_slot_assignments` | H MOTAスロット配置（account_number, slot, staff_name, assigned_account） |
| `break_slot_settings` | 休憩スロット設定（slot_number ①②③, start_time, end_time, ratio） |
| `staff_break_overrides` | スタッフ別当日休憩時間（project_id, staff_id, override_date, regular_minutes, short_minutes）デフォルト60/15分 |
| `work_exception_requests` | 早退・残業申請（request_type: early_leave/overtime, signer_name, status: pending/approved/rejected） |
| `break_slot_assignments` | 休憩スロット割り当て（UNIQUE: project_id, assignment_date, staff_id） |
| `break_room_settings` | 休憩室の定員＋設備＋開閉（project_id PK, capacity 1〜50 デフォルト6, amenities jsonb `[{label, ok}]`, is_open boolean default true） |
| `login_bonuses` | ログインボーナス（staff_id PK・全社共通, coins, total_logins, last_claimed_date）。毎日1回コインのガチャ。更新はサーバーアクションの admin クライアント |
| `notices.attachment_url/attachment_name` | 周知の添付ファイル（1周知1ファイル）。Storage バケット `notice-attachments`（public）に実体 |
| `break_room_uses` | 休憩室の占有（入室中のみ行が存在・退室で削除。UNIQUE: project_id, use_date, box_number / UNIQUE: project_id, use_date, staff_id） |
| `staff_partners` | パートナーモンスター所持（SPEC.md §6-7・全社共通。id 代理PK, staff_id, monster_id 1〜72, obtained_at）。**重複所持OK**＝同一 monster_id の行が複数あり得る（複合PK不可）。insert はガチャアクションの admin クライアントのみ。RLS: 本人 select 可 |
| `staffs.active_partner_id` | 現在連れているパートナー（mon 1〜72・null=なし） |

## タスク・LINE連携

| テーブル | 用途 |
|---------|-----|
| `group_tasks` | LINEグループ抽出タスク（title, assignee_staff_id, status, group_id）※/tasksでは取込み候補扱い |
| `project_tasks` | 管理者タスク管理（title, category, assignee_staff_id, start_date, due_date, progress, status, priority）2026-07-12新設 |
| `project_task_notes` | タスク作業メモ（task_id, author_staff_id, body, progress, mark_done）メモでステータス自動導出・2026-07-12新設 |
| `skill_items` | スキル管理カスタム項目（project_id, label, sort_order）2026-07-12新設 |
| `absence_recovery_marks` | 欠勤補填日の回収済マーク（staff_id, absence_date・行が存在=済）2026-07-12新設 |
| `break_slot_daily_settings` | 休憩スロット①〜③の日付別オーバーライド（target_date・行がある日はこちら優先）2026-08-10新設 |
| `staff_skill_values` | スタッフ×カスタム項目の○×（staff_id, item_id, value）2026-07-12新設 |
| `task_extraction_groups` | タスク抽出グループ設定（group_id, enabled） |
| `line_groups` | LINEグループ情報 |
| `line_name_mappings` | LINEユーザー名→社員IDマッピング |
| `rankings` | 番付データ（project_id, staff_name, account_number, rank, period） |

## RLSヘルパー関数（既存・使うこと）

```sql
public.current_staff_id()        -- 認証ユーザーの社員IDを返す
public.is_project_admin(project_id) -- 案件管理者かどうか判定
```

## 新テーブル作成時の最低限RLS

```sql
alter table public.<table> enable row level security;

create policy "select_own_<table>" on public.<table>
  for select to authenticated
  using (staff_id = public.current_staff_id());

create policy "admin_select_<table>" on public.<table>
  for select to authenticated
  using (public.is_project_admin(project_id));

create policy "insert_own_<table>" on public.<table>
  for insert to authenticated
  with check (
    staff_id = public.current_staff_id()
    and exists (
      select 1 from public.project_members pm
      where pm.staff_id = <table>.staff_id
      and pm.project_id = <table>.project_id
    )
  );
```
