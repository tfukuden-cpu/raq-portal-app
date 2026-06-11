# DBテーブル一覧

> 詳細な用途・カラム定義 → SPEC.md §7

## コアテーブル

| テーブル | 主な用途・主要カラム |
|---------|-------------------|
| `staffs` | スタッフマスタ（name, display_name, global_role, line_user_id, line_friend, avatar_config） |
| `projects` | 案件マスタ（name, is_active） |
| `project_members` | 案件所属（staff_id, project_id, role, section, work_days_type, account_number, churn_risk） |
| `project_settings` | 案件設定（line_group_id, notification_settings JSONB, enable_departure_report） |

## シフト関連

| テーブル | 用途 |
|---------|-----|
| `shifts` | シフトデータ（staff_id, project_id, shift_date, shift_name, shift_start, shift_end） |
| `shift_change_logs` | シフト変更履歴（before_data, after_data, changed_by） |
| `shift_patterns` | シフト区分マスタ（name, section, sort_order） |
| `shift_openings` | シフト募集 |
| `shift_requests` | 追加申請（opening_id, status） |
| `shift_off_requests` | 希望休申請・優先度付き（priority: 第一〜第四希望休, source） |
| `shift_slot_requirements` | セクション別必要枠数（日付別オーバーライド対応） |
| `holiday_requests` | 希望休申請・承認制（request_date, status） |
| `holiday_rules` | 希望休ルール（rule_type, value） 6種類: open_day / deadline_day / monthly_limit_per_person / weekend_limit / daily_limit_count / consecutive_limit |

## 勤怠関連

| テーブル | 用途 |
|---------|-----|
| `punch_logs` | 打刻ログ（punch_type: clock_in/clock_out, recorded_at） |
| `departure_reports` | 出発報告（reported_at, eta_minutes） |
| `absence_reports` | 欠勤報告（absence_date, reason, status, followup_symptoms, followup_recovery_status 等） |
| `late_reports` | 遅刻報告（late_date, reason, expected_arrival） |

## 周知・コミュニケーション

| テーブル | 用途 |
|---------|-----|
| `notices` | 周知事項（title, body, is_pinned, target_staff_id） |
| `notice_reads` | お知らせ既読（staff_id, notice_id） |
| `inquiries` | 問い合わせ |
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
| `break_room_settings` | 休憩室の定員＋設備（project_id PK, capacity 1〜50 デフォルト6, amenities jsonb `[{label, ok}]`） |
| `notices.attachment_url/attachment_name` | 周知の添付ファイル（1周知1ファイル）。Storage バケット `notice-attachments`（public）に実体 |
| `break_room_uses` | 休憩室の占有（入室中のみ行が存在・退室で削除。UNIQUE: project_id, use_date, box_number / UNIQUE: project_id, use_date, staff_id） |

## タスク・LINE連携

| テーブル | 用途 |
|---------|-----|
| `group_tasks` | LINEグループ抽出タスク（title, assignee_staff_id, status, group_id） |
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
