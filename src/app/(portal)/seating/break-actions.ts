"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { extractSpreadsheetId, readSheet } from "@/lib/gsheets";
import { revalidatePath } from "next/cache";

export type BreakSlotSetting = {
  id: string;
  slot_number: number;
  label: string;
  start_time: string;
  end_time: string;
  target_shift: "early" | "late" | "both";
  ratio: number;
  sort_order: number;
  /** 小休憩の時間帯（スロット単位・未設定は null） */
  short_start_time?: string | null;
  short_end_time?: string | null;
};

export type BreakSlotAssignment = {
  staff_id: string;
  slot_number: number;
};

/** シート取込で引き当てできなかった行 */
export type BreakImportUnresolved = {
  /** シート上の行番号（1始まり） */
  row: number;
  /** シートのアカウント番号（空欄なら "-"） */
  account: string;
  reason: string;
};

export type BreakImportResult = {
  success: boolean;
  imported: number;
  /** スロット番号 → 取り込んだ人数 */
  slotCounts: Record<number, number>;
  /** シートに無くなったので消した古い割り当ての件数（source='manual' は含まない） */
  removed: number;
  /** 座席表で個別に設定されていて残した割り当ての件数（source='manual'） */
  keptManual: number;
  unresolved: BreakImportUnresolved[];
  message?: string;
};

export type BreakShortSetting = {
  staff_id: string;
  short_break_minutes: number;
};

export type BreakRecord = {
  staff_id: string;
  break_type: string | null;
  started_at: string;
  ended_at: string | null;
};

const DEFAULT_SLOTS: Omit<BreakSlotSetting, "id">[] = [
  { slot_number: 1, label: "①", start_time: "12:00", end_time: "13:00", target_shift: "early", ratio: 20, sort_order: 0, short_start_time: null, short_end_time: null },
  { slot_number: 2, label: "②", start_time: "13:15", end_time: "14:15", target_shift: "both",  ratio: 40, sort_order: 1, short_start_time: null, short_end_time: null },
  { slot_number: 3, label: "③", start_time: "14:30", end_time: "15:30", target_shift: "late",  ratio: 40, sort_order: 2, short_start_time: null, short_end_time: null },
];

/** 休み扱いのシフト名（勤務シフトの判定に使う・全画面で同じリスト） */
const OFF_SHIFT_NAMES = ["公休", "休", "希望休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "公募"];

/** シートのデータは4行目以降（1〜3行目はヘッダー・注記） */
// 走査は1行目から。見出し・注記の行は「休憩の時刻が入っているか」で振り分けるので、
// シートの見出しが増減して位置がずれても取りこぼさない（2026-09-26・9/25分の取り込みで判明）
const SHEET_DATA_START_ROW = 1;

/**
 * "HH:MM" / "HH:MM:SS" → "HH:MM"（解釈できなければ null）。time型カラムは秒付きで返るため必ず通す。
 * 時 0-23・分 0-59 の範囲外は null にする（"16:60" を通すと time へのキャストで落ちる）。
 */
function toHHMM(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** 空文字を null に寄せる（time型カラムに "" を入れると 22007 で落ちるため） */
function timeOrNull(raw: string | null | undefined): string | null {
  return toHHMM(raw);
}

/** "2026/09/24" / "2026-9-4" → "2026-09-24"（解釈できなければ null） */
function toISODate(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** "ASS 61" / "ASS 03" / "61" → 61（数字が無ければ null）。ゼロ埋めの差を吸収する */
function accountKey(raw: string | null | undefined): number | null {
  const m = (raw ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 管理者判定（この案件の project_admin か、全社 admin/executive か）。
 * admin系のサーバーアクションは UI で隠すだけでは不十分なのでサーバー側でも必ず確認する。
 */
async function isProjectAdmin(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const staffId = user?.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!staffId) return false;
  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const role = (staff as { global_role?: string } | null)?.global_role;
  if (role === "admin" || role === "executive") return true;
  const { data: mem } = await admin
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  return (mem as { role?: string } | null)?.role === "project_admin";
}

export async function getBreakShortSettingsAction(
  projectId: string,
  date: string,
): Promise<BreakShortSetting[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("break_short_settings")
    .select("staff_id, short_break_minutes")
    .eq("project_id", projectId)
    .eq("assignment_date", date);
  return (data ?? []) as BreakShortSetting[];
}

export async function updateBreakShortSettingAction(
  projectId: string,
  date: string,
  staffId: string,
  minutes: number,
): Promise<{ success: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("break_short_settings")
    .upsert(
      { project_id: projectId, assignment_date: date, staff_id: staffId, short_break_minutes: minutes },
      { onConflict: "project_id,assignment_date,staff_id" },
    );
  if (error) return { success: false };
  revalidatePath("/attendance");
  return { success: true };
}

export async function getBreakSlotSettingsAction(projectId: string): Promise<BreakSlotSetting[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("break_slot_settings")
    .select("*").eq("project_id", projectId).order("sort_order");
  if (!data?.length) return DEFAULT_SLOTS.map((s, i) => ({ ...s, id: String(i) }));
  return data as BreakSlotSetting[];
}

/** 日付別スロット設定（オーバーライドがあればそれ・無ければ案件共通設定） */
export async function getBreakSlotSettingsForDateAction(
  projectId: string,
  date: string,
): Promise<{ slots: BreakSlotSetting[]; isDaily: boolean }> {
  const admin = createAdminClient();
  const { data: daily } = await admin.from("break_slot_daily_settings")
    .select("id, slot_number, label, start_time, end_time, target_shift, ratio, sort_order, short_start_time, short_end_time")
    .eq("project_id", projectId)
    .eq("target_date", date)
    .order("sort_order");
  if (daily && daily.length > 0) {
    return { slots: daily as BreakSlotSetting[], isDaily: true };
  }
  return { slots: await getBreakSlotSettingsAction(projectId), isDaily: false };
}

/** 日付別スロット設定を保存する（管理者UI用）。割り当ての自動再実行はしない */
export async function saveBreakSlotDailySettingsAction(
  projectId: string,
  date: string,
  slots: Omit<BreakSlotSetting, "id">[],
): Promise<{ success: boolean; error?: string }> {
  if (!(await isProjectAdmin(projectId))) return { success: false, error: "この操作は管理者のみ可能です" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: "日付が不正です" };

  const admin = createAdminClient();
  await admin.from("break_slot_daily_settings").delete()
    .eq("project_id", projectId).eq("target_date", date);
  const { error } = await admin.from("break_slot_daily_settings").insert(
    slots.map(s => ({
      ...s,
      short_start_time: timeOrNull(s.short_start_time),
      short_end_time:   timeOrNull(s.short_end_time),
      project_id:  projectId,
      target_date: date,
    }))
  );
  if (error) return { success: false, error: error.message };

  revalidatePath("/seating");
  revalidatePath("/seating/plan");
  revalidatePath("/attendance");
  return { success: true };
}

/** 日付別スロット設定を削除して案件共通設定に戻す */
export async function clearBreakSlotDailySettingsAction(
  projectId: string,
  date: string,
): Promise<{ success: boolean; error?: string }> {
  if (!(await isProjectAdmin(projectId))) return { success: false, error: "この操作は管理者のみ可能です" };

  const admin = createAdminClient();
  const { error } = await admin.from("break_slot_daily_settings").delete()
    .eq("project_id", projectId).eq("target_date", date);
  if (error) return { success: false, error: error.message };

  revalidatePath("/seating");
  revalidatePath("/seating/plan");
  revalidatePath("/attendance");
  return { success: true };
}

export async function saveBreakSlotSettingsAction(
  projectId: string,
  slots: Omit<BreakSlotSetting, "id">[],
): Promise<{ success: boolean; error?: string }> {
  // delete→insert で案件共通の休憩スロットを全上書きするのでサーバー側で管理者を確認する
  if (!(await isProjectAdmin(projectId))) return { success: false, error: "この操作は管理者のみ可能です" };

  const admin = createAdminClient();
  await admin.from("break_slot_settings").delete().eq("project_id", projectId);
  const { error } = await admin.from("break_slot_settings").insert(
    slots.map(s => ({
      ...s,
      short_start_time: timeOrNull(s.short_start_time),
      short_end_time:   timeOrNull(s.short_end_time),
      project_id: projectId,
    }))
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/seating");
  return { success: true };
}

export async function getBreakSlotAssignmentsAction(
  projectId: string,
  date: string,
): Promise<BreakSlotAssignment[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("break_slot_assignments")
    .select("staff_id, slot_number")
    .eq("project_id", projectId).eq("assignment_date", date);
  return (data ?? []) as BreakSlotAssignment[];
}

export async function updateBreakSlotAssignmentAction(
  projectId: string,
  date: string,
  staffId: string,
  slotNumber: number,
): Promise<{ success: boolean }> {
  if (!(await isProjectAdmin(projectId))) return { success: false };

  const admin = createAdminClient();
  const { error } = await admin.from("break_slot_assignments")
    .upsert({ project_id: projectId, assignment_date: date, staff_id: staffId, slot_number: slotNumber, source: "manual" },
      { onConflict: "project_id,assignment_date,staff_id" });
  if (error) return { success: false };
  revalidatePath("/seating");
  return { success: true };
}

/**
 * 現場が運用している休憩表スプレッドシートから、その日の休憩スロット割り当てを取り込む。
 *
 * シートの構造（`project_settings.break_sheet_url` / `break_sheet_name`）:
 *   A=日付 B=アカウント番号(ASS 61) C=商材 D=休憩開始 E=休憩終了 F=小休憩開始 G=小休憩終了
 *   1〜3行目はヘッダー・注記＝データは4行目以降。B が空の行は未入力のテンプレなのでスキップ。
 *
 * 引き当てできなかった行は黙って落とさず unresolved で返して画面に出す。
 */
export async function importBreakAssignmentsFromSheetAction(
  projectId: string,
  date: string,
): Promise<BreakImportResult> {
  const empty: BreakImportResult = {
    success: false, imported: 0, slotCounts: {}, removed: 0, keptManual: 0, unresolved: [],
  };

  try {
    if (!(await isProjectAdmin(projectId))) {
      return { ...empty, message: "この操作は管理者のみ可能です" };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ...empty, message: "日付が不正です" };
    }

    const admin = createAdminClient();

    // ── ① シートの場所 ───────────────────────────────────
    const { data: settings } = await admin.from("project_settings")
      .select("break_sheet_url, break_sheet_name")
      .eq("project_id", projectId)
      .maybeSingle();
    const sheetUrl  = (settings as { break_sheet_url?: string | null } | null)?.break_sheet_url?.trim() ?? "";
    const sheetName = (settings as { break_sheet_name?: string | null } | null)?.break_sheet_name?.trim() ?? "";
    if (!sheetUrl) {
      return { ...empty, message: "休憩表スプレッドシートが未設定です（案件設定 › 休憩設定 で登録してください）" };
    }
    if (!sheetName) {
      return { ...empty, message: "休憩表のシート名が未設定です（案件設定 › 休憩設定 で登録してください）" };
    }

    // ── ② シートを読む ───────────────────────────────────
    let sheetRows: string[][];
    try {
      sheetRows = await readSheet(extractSpreadsheetId(sheetUrl), sheetName, "A:G");
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/permission/i.test(msg) || /\b403\b/.test(msg)) {
        return { ...empty, message: "このシートに閲覧権限がありません（Google連携アカウントに共有してください）" };
      }
      if (/unable to parse range/i.test(msg)) {
        return { ...empty, message: `シート「${sheetName}」が見つかりません（シート名を確認してください）` };
      }
      if (/not found/i.test(msg) || /\b404\b/.test(msg)) {
        return { ...empty, message: "スプレッドシートが見つかりません（URLを確認してください）" };
      }
      return { ...empty, message: `シートの読み取りに失敗しました: ${msg}` };
    }

    // ── ③ スロット設定（日付別→共通のフォールバック） ────
    const { slots, isDaily } = await getBreakSlotSettingsForDateAction(projectId, date);
    if (slots.length === 0) {
      return { ...empty, message: "休憩スロットが設定されていません" };
    }
    const slotByTime = new Map<string, number>();
    const slotMap    = new Map<number, BreakSlotSetting>();
    for (const s of slots) {
      const st = toHHMM(s.start_time);
      const en = toHHMM(s.end_time);
      if (st && en) slotByTime.set(`${st}-${en}`, s.slot_number);
      slotMap.set(s.slot_number, s);
    }
    const slotLabel = (n: number) => slotMap.get(n)?.label ?? `スロット${n}`;

    // ── ④ スタッフ引き当て用（アカウント番号は退職者と重複するので当日シフトで絞る） ──
    const [{ data: memberRows }, { data: shiftRows }] = await Promise.all([
      admin.from("project_members")
        .select("staff_id, staffs(name, display_name, account_number)")
        .eq("project_id", projectId),
      admin.from("shifts")
        .select("staff_id, shift_name")
        .eq("project_id", projectId).eq("shift_date", date),
    ]);

    const workingIds = new Set<string>();
    for (const s of shiftRows ?? []) {
      const name = ((s as { shift_name?: string | null }).shift_name ?? "").trim();
      if (!name || OFF_SHIFT_NAMES.includes(name)) continue;
      workingIds.add(s.staff_id as string);
    }

    const byAccount = new Map<number, { staffId: string; name: string }[]>();
    for (const m of memberRows ?? []) {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name?: string | null; display_name?: string | null; account_number?: string | null } | null;
      const key = accountKey(s?.account_number);
      if (key === null) continue;
      const list = byAccount.get(key) ?? [];
      list.push({ staffId: m.staff_id as string, name: s?.display_name ?? s?.name ?? (m.staff_id as string) });
      byAccount.set(key, list);
    }

    // ── ⑤ 行を解釈 ───────────────────────────────────────
    const unresolved: BreakImportUnresolved[] = [];
    const picked = new Map<string, { slotNumber: number; row: number; account: string }>();
    /** スロット番号 → "16:00-16:30" → 票数（小休憩の多数派決定用） */
    const shortVotes = new Map<number, Map<string, number>>();
    const shortRefs: { row: number; account: string; slotNumber: number; key: string }[] = [];
    let dateRowCount = 0;

    for (let i = SHEET_DATA_START_ROW - 1; i < sheetRows.length; i++) {
      const rowNo = i + 1;
      const r = sheetRows[i] ?? [];
      const rawAccount = (r[1] ?? "").trim();
      if (!rawAccount) continue;                     // 未入力のテンプレ行
      const account = rawAccount;

      // シートは見出し・注記の行が混ざる（「査定番付」「アカウント」「11」など。
      // 日付ブロックが増えると位置も動く）。**データ行の判定は「休憩の時刻が入っていること」**で行う。
      // 時刻が無い行は見出しとみなして黙って飛ばす＝毎回同じ行が未解決に出るノイズを防ぐ
      const hasTimes = toHHMM(r[3]) !== null && toHHMM(r[4]) !== null;

      const key = accountKey(rawAccount);
      if (key === null) {
        // 時刻が入っているのにアカウント番号が読めない＝本物のデータ行が壊れている
        if (hasTimes) {
          unresolved.push({ row: rowNo, account, reason: "アカウント番号を読み取れません" });
        }
        continue;
      }

      // A列が日付として読めない行（日付セルの結合・記入漏れ・"9/24" のような年なし書式）。
      // 時刻が入っていれば取りこぼしなので報告し、無ければ見出しとして飛ばす
      const rowDate = toISODate(r[0]);
      if (rowDate === null) {
        if (hasTimes) {
          const rawDate = (r[0] ?? "").trim();
          unresolved.push({
            row: rowNo, account,
            reason: `日付（A列）を読み取れません${rawDate ? `（"${rawDate}"）` : "（空欄）"}`,
          });
        }
        continue;
      }
      if (rowDate !== date) continue;                // 対象日以外は今どおり黙ってスキップ
      dateRowCount++;

      // スタッフ引き当て
      const candidates = byAccount.get(key) ?? [];
      if (candidates.length === 0) {
        unresolved.push({ row: rowNo, account, reason: "このアカウント番号のメンバーが見つかりません" });
        continue;
      }
      const working = candidates.filter(c => workingIds.has(c.staffId));
      if (working.length === 0) {
        unresolved.push({
          row: rowNo, account,
          reason: `この日に勤務シフトがありません（候補: ${candidates.map(c => `${c.name}(${c.staffId})`).join(" / ")}）`,
        });
        continue;
      }
      if (working.length > 1) {
        unresolved.push({
          row: rowNo, account,
          reason: `同じアカウント番号で勤務中の人が複数います（${working.map(c => `${c.name}(${c.staffId})`).join(" / ")}）`,
        });
        continue;
      }
      const { staffId, name } = working[0];

      // スロット決定（時刻が一致しなければ取り込まない＝時間帯が増えたら気づけるように）
      const start = toHHMM(r[3]);
      const end   = toHHMM(r[4]);
      if (!start || !end) {
        unresolved.push({ row: rowNo, account, reason: `${name}: 休憩の時間帯（D/E列）が空です` });
        continue;
      }
      const slotNumber = slotByTime.get(`${start}-${end}`);
      if (!slotNumber) {
        unresolved.push({ row: rowNo, account, reason: `${name}: 休憩 ${start}–${end} に一致するスロットがありません` });
        continue;
      }

      const already = picked.get(staffId);
      if (already) {
        unresolved.push({
          row: rowNo, account,
          reason: already.slotNumber === slotNumber
            ? `${name}: ${already.row}行目と重複しています（無視しました）`
            : `${name}: ${already.row}行目と休憩が食い違います（${slotLabel(already.slotNumber)}を採用）`,
        });
        continue;
      }
      picked.set(staffId, { slotNumber, row: rowNo, account });

      // 小休憩の時間帯（スロット単位・多数派を採る）
      const shortStart = toHHMM(r[5]);
      const shortEnd   = toHHMM(r[6]);
      if (shortStart && shortEnd) {
        const vkey = `${shortStart}-${shortEnd}`;
        const votes = shortVotes.get(slotNumber) ?? new Map<string, number>();
        votes.set(vkey, (votes.get(vkey) ?? 0) + 1);
        shortVotes.set(slotNumber, votes);
        shortRefs.push({ row: rowNo, account, slotNumber, key: vkey });
      }
    }

    if (dateRowCount === 0) {
      return {
        ...empty, unresolved,
        message: unresolved.length > 0
          ? `シートに ${date} の行がありません（日付が読めない行が ${unresolved.length}件あります）`
          : `シートに ${date} の行がありません`,
      };
    }
    if (picked.size === 0) {
      return { ...empty, unresolved, message: "取り込める行がありませんでした（既存の割り当ては変更していません）" };
    }

    // ── ⑥ 小休憩の多数派を決め、食い違う行を報告 ─────────
    const shortMajority = new Map<number, { start: string; end: string }>();
    for (const [slotNumber, votes] of shortVotes) {
      let bestKey = "";
      let bestCount = -1;
      for (const [k, c] of votes) {
        if (c > bestCount) { bestCount = c; bestKey = k; }
      }
      const [start, end] = bestKey.split("-");
      if (start && end) shortMajority.set(slotNumber, { start, end });
    }
    for (const ref of shortRefs) {
      const maj = shortMajority.get(ref.slotNumber);
      if (!maj) continue;
      if (ref.key === `${maj.start}-${maj.end}`) continue;
      const [s, e] = ref.key.split("-");
      unresolved.push({
        row: ref.row, account: ref.account,
        reason: `小休憩が${slotLabel(ref.slotNumber)}の多数派（${maj.start}–${maj.end}）と違います（${s}–${e}）。休憩スロットは取り込みました`,
      });
    }

    // ── ⑦ 小休憩の時間帯を「この日の設定」に保存（効いている値と違うときだけ） ──
    const needsShortWrite = [...shortMajority.entries()].some(([slotNumber, maj]) => {
      const cur = slotMap.get(slotNumber);
      return toHHMM(cur?.short_start_time) !== maj.start || toHHMM(cur?.short_end_time) !== maj.end;
    });
    if (needsShortWrite) {
      if (isDaily) {
        for (const [slotNumber, maj] of shortMajority) {
          const { error: updErr } = await admin.from("break_slot_daily_settings")
            .update({ short_start_time: maj.start, short_end_time: maj.end })
            .eq("project_id", projectId).eq("target_date", date).eq("slot_number", slotNumber);
          if (updErr) {
            return { ...empty, unresolved, message: `小休憩の時間帯の保存に失敗しました: ${updErr.message}` };
          }
        }
      } else {
        // この日だけの設定が無いので、共通設定＋シートの小休憩時間帯で日付別行を作る
        const dailyRows = slots.map((s, i) => {
          const maj = shortMajority.get(s.slot_number);
          return {
            project_id:  projectId,
            target_date: date,
            slot_number: s.slot_number,
            label:        s.label,
            start_time:   toHHMM(s.start_time) ?? s.start_time,
            end_time:     toHHMM(s.end_time)   ?? s.end_time,
            target_shift: s.target_shift,
            ratio:        s.ratio,
            sort_order:   s.sort_order ?? i,
            short_start_time: maj?.start ?? timeOrNull(s.short_start_time),
            short_end_time:   maj?.end   ?? timeOrNull(s.short_end_time),
          };
        });
        await admin.from("break_slot_daily_settings").delete()
          .eq("project_id", projectId).eq("target_date", date);
        const { error: dailyErr } = await admin.from("break_slot_daily_settings").insert(dailyRows);
        if (dailyErr) {
          return { ...empty, unresolved, message: `小休憩の時間帯の保存に失敗しました: ${dailyErr.message}` };
        }
      }
    }

    // ── ⑧ 割り当てを書き込む ─────────────────────────────
    // 先に upsert してから掃除する（順番が逆だと upsert 失敗時に「消えただけ」になる）。
    // 掃除の対象は「シートに載っていない・source が manual ではない」行だけ＝
    // SVが座席表で個別に入れた指定（source='manual'）は再取り込みでも残す。
    const upsertRows = [...picked.entries()].map(([staffId, v]) => ({
      project_id:      projectId,
      assignment_date: date,
      staff_id:        staffId,
      slot_number:     v.slotNumber,
      source:          "sheet",
    }));

    const { error: upsertErr } = await admin.from("break_slot_assignments")
      .upsert(upsertRows, { onConflict: "project_id,assignment_date,staff_id" });
    if (upsertErr) {
      return { ...empty, unresolved, message: `割り当ての保存に失敗しました: ${upsertErr.message}` };
    }

    // シートに載っていない当日の割り当てを見て、手動指定は残す／それ以外（'sheet'・'auto'・
    // source が null の古い自動割当）は消す
    const sheetStaffIds = new Set(picked.keys());
    const { data: existingRows, error: existingErr } = await admin.from("break_slot_assignments")
      .select("staff_id, source")
      .eq("project_id", projectId).eq("assignment_date", date);
    if (existingErr) {
      return { ...empty, unresolved, message: `既存の割り当ての確認に失敗しました: ${existingErr.message}` };
    }

    const staleIds: string[] = [];
    let keptManual = 0;
    for (const row of existingRows ?? []) {
      const staffId = row.staff_id as string;
      if (sheetStaffIds.has(staffId)) continue;
      if ((row as { source?: string | null }).source === "manual") { keptManual++; continue; }
      staleIds.push(staffId);
    }

    if (staleIds.length > 0) {
      const { error: delErr } = await admin.from("break_slot_assignments").delete()
        .eq("project_id", projectId).eq("assignment_date", date)
        .in("staff_id", staleIds);
      if (delErr) {
        return { ...empty, unresolved, message: `古い割り当ての削除に失敗しました: ${delErr.message}` };
      }
    }

    const slotCounts: Record<number, number> = {};
    for (const v of picked.values()) {
      slotCounts[v.slotNumber] = (slotCounts[v.slotNumber] ?? 0) + 1;
    }

    revalidatePath("/seating");
    revalidatePath("/seating/plan");
    revalidatePath("/attendance");

    return {
      success: true,
      imported: upsertRows.length,
      slotCounts,
      removed: staleIds.length,
      keptManual,
      unresolved,
    };
  } catch (e) {
    console.error("importBreakAssignmentsFromSheetAction failed", e);
    return { ...empty, message: (e as Error).message ?? "取り込みに失敗しました" };
  }
}
