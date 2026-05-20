/**
 * LINE通知設定のユーティリティ（クライアント・サーバー共用）
 * "use server" ではないので通常の関数として export できる
 */

export type NotifyItemConfig = {
  enabled:         boolean;
  /** 通知先: admin=管理者グループのみ / staff=スタッフのみ */
  recipient:       "admin" | "staff";
  /** 定時通知の送信時刻 HH:MM */
  time?:           string;
  /** 希望休リマインド: 締切の何日前に送るか */
  days_before?:    number;
  /** 出勤リマインド: 出勤時間の何分前に送るか */
  minutes_before?: number;
  /** 退勤リマインド: 退勤時間の何分後に送るか */
  minutes_after?:  number;
  /** カスタムメッセージ本文（{変数名} プレースホルダー使用可） */
  message?:        string;
};

export type NotificationSettings = {
  // ── イベント通知（即時）─────────────────────────────────
  /** 欠勤申請が来たとき → 管理者グループへ */
  absence:          NotifyItemConfig;
  /** 欠勤申請受付完了 → 申請したスタッフへ */
  absence_confirm:  NotifyItemConfig;
  /** 遅刻申請が来たとき → 管理者グループへ */
  tardiness:        NotifyItemConfig;
  /** 出退勤の打刻が行われたとき → 管理者グループへ */
  clock:            NotifyItemConfig;
  /** お知らせが投稿されたとき → スタッフへ */
  announcement:     NotifyItemConfig;
  /** スタッフから問い合わせが来たとき → 管理者グループへ */
  inquiry:              NotifyItemConfig;
  /** 管理者が問い合わせに返信したとき → スタッフへ */
  inquiry_reply:        NotifyItemConfig;
  /** スタッフがシフト追加申請をしたとき → 管理者グループへ */
  shift_request:        NotifyItemConfig;
  /** 管理者がシフト追加申請を承認・却下したとき → スタッフへ */
  shift_request_result: NotifyItemConfig;
  /** 管理者がシフトを変更・削除したとき → 対象スタッフへ */
  shift_changed:        NotifyItemConfig;
  /** 管理者が勤怠補正申請を承認・却下したとき → スタッフへ */
  correction_result:    NotifyItemConfig;

  // ── 定時通知（スケジュール）────────────────────────────
  /** 出勤時間N分前リマインド → スタッフへ */
  shift_start_remind:  NotifyItemConfig;
  /** 退勤時間N分後：打刻リマインド＋次回出勤アナウンス → スタッフへ */
  shift_end_remind:    NotifyItemConfig;
  /** 当日休み → 翌日出勤アナウンス → スタッフへ */
  rest_day_remind:     NotifyItemConfig;
  /** 毎日の出勤状況サマリー → 管理者グループへ */
  daily_summary:       NotifyItemConfig;
  /** 希望休締切前リマインド → スタッフへ */
  holiday_reminder:    NotifyItemConfig;
  /** 希望休申請受付開始通知（毎月1日） → スタッフへ */
  holiday_open_notify: NotifyItemConfig;
  /** 欠勤者への経過報告リマインド（17時） → 当日欠勤かつ翌日出勤のスタッフへ */
  absence_followup_remind: NotifyItemConfig;
  /** 経過報告が提出されたとき → 管理者グループへ */
  absence_followup_notify: NotifyItemConfig;
  /** シフト展開通知（管理者が展開ボタンを押したとき） → 全スタッフへ */
  shift_published:     NotifyItemConfig;
};

// ── デフォルトメッセージ ──────────────────────────────────

export const DEFAULT_NOTIFY_MESSAGES: Record<keyof NotificationSettings, string> = {
  absence:
`{日付}欠勤連絡
{名前}さんから欠勤の連絡がありました。
【理由】{欠勤理由}
{翌日出勤可否}
{翌々日出勤可否}
必要に応じて確認の連絡をしてください。`,

  absence_confirm:
`{名前}さん、本日の欠勤連絡受け付けました。
この後管理者が確認でき次第、確認の連絡が入る可能性がありますのでご対応のほどよろしくお願いします。`,

  tardiness:
`{日付}遅刻連絡
{名前}さんから遅刻の連絡がありました。
【理由】{遅刻理由}
【到着目安】{到着目安時間}`,

  clock:
`{名前}さんが{時刻}に{種別}しました。`,

  announcement:
`【お知らせ】
{タイトル}

{本文}`,

  inquiry:
`【問い合わせ】{名前}さんから問い合わせが届きました。
件名：{件名}
{内容}`,

  inquiry_reply:
`{名前}さん、問い合わせへの返信が届きました。
件名：{件名}
【返信内容】
{返信}`,

  shift_request:
`【追加申請】{名前}さんからシフト追加申請が届きました。
日付：{日付}
シフト：{シフト}
審査をお願いします。`,

  shift_request_result:
`{名前}さん、シフト追加申請の審査結果が届きました。
日付：{日付} / シフト：{シフト}
【結果】{結果}`,

  shift_changed:
`{名前}さん、シフトが変更されました。
【日付】{日付}
【変更前】{変更前}
【変更後】{変更後}`,

  correction_result:
`{名前}さん、勤怠補正申請の結果をお知らせします。
【対象日】{日付}
【結果】{結果}`,

  shift_start_remind:
`{名前}さん、お疲れ様です。
本日の出勤予定となっております。
（本日シフト：{シフト}）
電車遅延などを加味して余裕のある出勤をお願いします。
遅刻が発生する場合は早めに遅刻報告をお願いします。
お気をつけてお越しください。
本日もよろしくお願いいたします！`,

  shift_end_remind:
`{名前}さん、お疲れ様です。
本日もありがとうございました。
退勤の打刻はお済みですか？
※稼働時間に関わりますので打刻漏れには注意してください。

次回出勤：{次回出勤日}（{シフト}）
次回もよろしくお願いいたします！`,

  rest_day_remind:
`{名前}さん、お疲れ様です。
明日出勤予定となっております。
{翌日}{シフト}
明日もよろしくお願いいたします！`,

  daily_summary:
`📋 {日付}の出勤状況
出勤：{出勤数}名

{一覧}`,

  holiday_reminder:
`⏰ 希望休の提出期限が{残日数}日後（{締切日}）に迫っています。
お忘れなく提出してください。`,

  holiday_open_notify:
`{名前}さん、お疲れ様です。
{対象月}の希望休申請の受付を開始しました。
締切日：{締切日}
ポータルから申請をお願いします。`,

  absence_followup_remind:
`{名前}さん、お疲れ様です。
本日はご欠勤されておりますが、明日（{翌日}）の出勤について経過報告をお願いします。
ポータルの「経過報告」から翌日の出勤可否と状況をご報告ください。`,

  absence_followup_notify:
`【経過報告】{名前}さんから報告がありました。
【報告日】{日付}
【翌日出勤】{翌日出勤可否}
{症状}`,

  shift_published:
`{名前}さん、{対象月}のシフトが確定しました。
ポータルのシフトページからご確認ください。`,
};

// ── 変数定義（取得元の整理用） ────────────────────────────

/**
 * 各通知で使えるプレースホルダー変数
 * - {名前}         : staffs.display_name
 * - {日付}         : 申請日 / 対象日
 * - {シフト}       : shift_patterns.name（開始〜終了時刻付き）
 * - {次回出勤日}   : 次のシフト割当日
 * - {翌日}         : 翌日の日付
 * - {欠勤理由}     : absences.reason
 * - {翌日出勤可否} : absences.next_day_available（「翌日：出勤可」等）
 * - {翌々日出勤可否}: absences.day_after_next_available
 * - {遅刻理由}     : tardiness_reports.reason
 * - {到着目安時間} : tardiness_reports.eta
 * - {時刻}         : clock_records.clocked_at（HH:MM）
 * - {種別}         : "出勤" / "退勤"
 * - {タイトル}     : notices.title
 * - {本文}         : notices.body
 * - {出勤数}       : 当日の出勤スタッフ数
 * - {一覧}         : スタッフ別出退勤サマリー
 * - {残日数}       : 締切までの日数
 * - {締切日}       : 希望休締切日
 */
export const NOTIFY_VARS: Record<keyof NotificationSettings, { label: string; note?: string }[]> = {
  absence: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{欠勤理由}" },
    { label: "{翌日出勤可否}",   note: "情報がある場合のみ" },
    { label: "{翌々日出勤可否}", note: "情報がある場合のみ" },
  ],
  absence_confirm: [
    { label: "{名前}" },
  ],
  tardiness: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{遅刻理由}" },
    { label: "{到着目安時間}" },
  ],
  clock: [
    { label: "{名前}" },
    { label: "{時刻}" },
    { label: "{種別}", note: "出勤 / 退勤" },
  ],
  announcement: [
    { label: "{タイトル}" },
    { label: "{本文}" },
  ],
  inquiry: [
    { label: "{名前}" },
    { label: "{件名}" },
    { label: "{内容}" },
  ],
  inquiry_reply: [
    { label: "{名前}" },
    { label: "{件名}" },
    { label: "{返信}" },
  ],
  shift_request: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{シフト}", note: "シフト名" },
  ],
  shift_request_result: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{シフト}", note: "シフト名" },
    { label: "{結果}", note: "承認 / 却下" },
  ],
  shift_changed: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{変更前}", note: "変更前のシフト名（なし = 新規登録）" },
    { label: "{変更後}", note: "変更後のシフト名（削除 = 削除）" },
  ],
  correction_result: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{結果}", note: "承認 / 却下" },
  ],
  shift_start_remind: [
    { label: "{名前}" },
    { label: "{シフト}", note: "シフト名・時刻" },
  ],
  shift_end_remind: [
    { label: "{名前}" },
    { label: "{次回出勤日}" },
    { label: "{シフト}", note: "次回シフト名・時刻" },
  ],
  rest_day_remind: [
    { label: "{名前}" },
    { label: "{翌日}", note: "翌日の日付" },
    { label: "{シフト}", note: "翌日のシフト名・時刻" },
  ],
  daily_summary: [
    { label: "{日付}" },
    { label: "{出勤数}" },
    { label: "{一覧}", note: "スタッフ別出退勤一覧" },
  ],
  holiday_reminder: [
    { label: "{残日数}" },
    { label: "{締切日}" },
  ],
  holiday_open_notify: [
    { label: "{名前}" },
    { label: "{対象月}", note: "希望休申請の対象月（例：2026/06）" },
    { label: "{締切日}", note: "今月の締切日" },
  ],
  absence_followup_remind: [
    { label: "{名前}" },
    { label: "{翌日}", note: "翌日の日付" },
  ],
  absence_followup_notify: [
    { label: "{名前}" },
    { label: "{日付}" },
    { label: "{翌日出勤可否}", note: "出勤可 / 出勤不可" },
    { label: "{症状}", note: "不可の場合の症状詳細" },
  ],
  shift_published: [
    { label: "{名前}" },
    { label: "{対象月}", note: "展開した月（例：2026/06）" },
  ],
};

// ── デフォルト値の構築 ───────────────────────────────────

export function buildDefaultNotificationSettings(
  partial: Record<string, unknown>
): NotificationSettings {
  const get = (key: keyof NotificationSettings, def: NotifyItemConfig): NotifyItemConfig => {
    const v = partial[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const merged = { ...def, ...(v as Partial<NotifyItemConfig>) };
      if (!merged.message) merged.message = DEFAULT_NOTIFY_MESSAGES[key];
      return merged;
    }
    return def;
  };
  return {
    absence:             get("absence",             { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.absence }),
    absence_confirm:     get("absence_confirm",     { enabled: false, recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.absence_confirm }),
    tardiness:           get("tardiness",            { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.tardiness }),
    clock:               get("clock",                { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.clock }),
    announcement:        get("announcement",         { enabled: false, recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.announcement }),
    inquiry:              get("inquiry",              { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.inquiry }),
    inquiry_reply:        get("inquiry_reply",        { enabled: false, recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.inquiry_reply }),
    shift_request:        get("shift_request",        { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.shift_request }),
    shift_request_result: get("shift_request_result", { enabled: false, recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.shift_request_result }),
    shift_changed:        get("shift_changed",        { enabled: true,  recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.shift_changed }),
    correction_result:    get("correction_result",    { enabled: true,  recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.correction_result }),
    shift_start_remind:  get("shift_start_remind",  { enabled: false, recipient: "staff", minutes_before: 60, message: DEFAULT_NOTIFY_MESSAGES.shift_start_remind }),
    shift_end_remind:    get("shift_end_remind",    { enabled: false, recipient: "staff", minutes_after: 15,  message: DEFAULT_NOTIFY_MESSAGES.shift_end_remind }),
    rest_day_remind:     get("rest_day_remind",     { enabled: false, recipient: "staff", time: "20:00",      message: DEFAULT_NOTIFY_MESSAGES.rest_day_remind }),
    daily_summary:       get("daily_summary",       { enabled: false, recipient: "admin", time: "08:00",      message: DEFAULT_NOTIFY_MESSAGES.daily_summary }),
    holiday_reminder:        get("holiday_reminder",        { enabled: false, recipient: "staff", time: "09:00", days_before: 3, message: DEFAULT_NOTIFY_MESSAGES.holiday_reminder }),
    holiday_open_notify:     get("holiday_open_notify",     { enabled: false, recipient: "staff", time: "09:00", message: DEFAULT_NOTIFY_MESSAGES.holiday_open_notify }),
    absence_followup_remind: get("absence_followup_remind", { enabled: false, recipient: "staff", time: "17:00", message: DEFAULT_NOTIFY_MESSAGES.absence_followup_remind }),
    absence_followup_notify: get("absence_followup_notify", { enabled: false, recipient: "admin", message: DEFAULT_NOTIFY_MESSAGES.absence_followup_notify }),
    shift_published:         get("shift_published",         { enabled: false, recipient: "staff", message: DEFAULT_NOTIFY_MESSAGES.shift_published }),
  };
}
