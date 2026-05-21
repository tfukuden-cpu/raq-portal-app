/**
 * POST /api/admin/import-shift-off-requests
 * ExcelファイルからP001の希望休データをインポートする
 * multipart/form-data: file=xlsx, projectId=string
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";

const PRIORITY_VALUES = ["第一希望休", "第二希望休", "第三希望休", "第四希望休", "冠婚葬祭"] as const;

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (!myStaff || !["admin", "executive"].includes(myStaff.global_role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // フォームデータ取得
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;
  if (!file || !projectId) {
    return NextResponse.json({ error: "file and projectId required" }, { status: 400 });
  }

  // exceljs でパース
  const buf = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);

  // 「希望休」を含むシートを探す
  let sheet: ExcelJS.Worksheet | undefined;
  for (const ws of workbook.worksheets) {
    if (ws.name.includes("希望休")) { sheet = ws; break; }
  }
  if (!sheet) {
    return NextResponse.json({ error: "希望休シートが見つかりません" }, { status: 400 });
  }

  // ヘッダー行を解析（1行目）
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    headers.push(String(cell.value ?? ""));
  });

  // 日付列を特定（[6/1] 〜 [6/30] 形式）
  const dateCols: { colIdx: number; date: string }[] = [];
  let year = 0, month = 0;
  const datePattern = /\[(\d+)\/(\d+)\]/;
  for (let i = 0; i < headers.length; i++) {
    const m = headers[i].match(datePattern);
    if (m) {
      const mo = parseInt(m[1]);
      const day = parseInt(m[2]);
      // 年を推定（現在年または来年）
      if (year === 0) {
        year = new Date().getFullYear();
        month = mo;
        // 過去月なら来年
        const now = new Date();
        if (mo < now.getMonth() + 1 - 1) year++;
      }
      dateCols.push({ colIdx: i + 1, date: toDateStr(year, mo, day) });
    }
  }

  if (dateCols.length === 0) {
    return NextResponse.json({ error: "日付列が見つかりません" }, { status: 400 });
  }

  // スタッフのaccount_number→staff_idマップを取得
  const admin = createAdminClient();
  const { data: staffsRaw } = await admin
    .from("staffs")
    .select("id, account_number")
    .not("account_number", "is", null);
  const accountMap = new Map<string, string>();
  for (const s of staffsRaw ?? []) {
    if (s.account_number) accountMap.set(s.account_number.trim(), s.id);
  }

  // 申請者列・タイムスタンプ列を特定
  const tsColIdx    = headers.indexOf("タイムスタンプ") + 1;
  const staffColIdx = headers.indexOf("申請者") + 1;
  if (staffColIdx === 0) {
    return NextResponse.json({ error: "「申請者」列が見つかりません" }, { status: 400 });
  }

  // データ行をパース（2行目以降）
  const rows: { project_id: string; staff_id: string; request_date: string; priority: string; submitted_at: string | null }[] = [];
  const skipped: string[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // ヘッダーをスキップ

    const accountRaw = String(row.getCell(staffColIdx).value ?? "").trim();
    const staffId = accountMap.get(accountRaw);
    if (!staffId) {
      if (accountRaw) skipped.push(accountRaw);
      return;
    }

    const tsCell = tsColIdx > 0 ? row.getCell(tsColIdx).value : null;
    let submittedAt: string | null = null;
    if (tsCell instanceof Date) {
      submittedAt = tsCell.toISOString();
    } else if (typeof tsCell === "string" && tsCell) {
      submittedAt = new Date(tsCell).toISOString();
    }

    for (const { colIdx, date } of dateCols) {
      const raw = String(row.getCell(colIdx).value ?? "").trim();
      if (!raw || !(PRIORITY_VALUES as readonly string[]).includes(raw)) continue;
      rows.push({
        project_id:   projectId,
        staff_id:     staffId,
        request_date: date,
        priority:     raw,
        submitted_at: submittedAt,
      });
    }
  });

  if (rows.length === 0) {
    return NextResponse.json({
      ok: false,
      message: "取り込めるデータがありませんでした",
      skipped,
    });
  }

  // 同バッチ内の重複キー（staff_id+request_date）を除去（後勝ち）
  const deduped = [...new Map(rows.map(r => [`${r.staff_id}:${r.request_date}`, r])).values()];

  // upsert（同一project_id+staff_id+request_dateは上書き）
  const { error } = await admin
    .from("shift_off_requests")
    .upsert(deduped, { onConflict: "project_id,staff_id,request_date" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: deduped.length,
    skipped,
    month: `${year}年${month}月`,
  });
}
