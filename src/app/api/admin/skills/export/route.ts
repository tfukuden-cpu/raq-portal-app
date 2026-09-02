/**
 * GET /api/admin/skills/export
 * スキル管理マトリクスをExcel(.xlsx)で返す
 * query: projectId
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";

async function requireAccess(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  return (
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive"
  );
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId) return new NextResponse("Bad Request", { status: 400 });
  if (!(await requireAccess(projectId))) return new NextResponse("Forbidden", { status: 403 });

  const admin = createAdminClient();

  const [{ data: members }, { data: shiftPatterns }, { data: skillItems }, { data: skillValues }] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, section, sections, staffs(name, display_name, account_number)")
      .eq("project_id", projectId)
      .is("end_date", null),
    admin.from("shift_patterns").select("section").eq("project_id", projectId),
    admin.from("skill_items").select("id, label").eq("project_id", projectId).order("sort_order"),
    admin.from("staff_skill_values").select("staff_id, item_id, value").eq("project_id", projectId),
  ]);

  const sections = [...new Set(
    (shiftPatterns ?? []).map(p => (p as { section?: string | null }).section).filter(Boolean) as string[]
  )].sort();
  const items = ((skillItems ?? []) as { id: string; label: string }[]);

  const valueMap = new Map<string, boolean>();
  for (const v of (skillValues ?? []) as { staff_id: string; item_id: string; value: boolean }[]) {
    valueMap.set(`${v.staff_id}_${v.item_id}`, v.value);
  }

  type Row = {
    mainSection: string;
    accountNumber: string | null;
    name: string;
    sections: string[];
    staffId: string;
  };
  const rows: Row[] = ((members ?? []) as {
    staff_id: string; section: string | null; sections: string[] | null;
    staffs: { name: string | null; display_name: string | null; account_number: string | null }
      | { name: string | null; display_name: string | null; account_number: string | null }[] | null;
  }[]).map(m => {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs;
    const secs = (m.sections ?? []).filter(Boolean);
    return {
      staffId: m.staff_id,
      mainSection: m.section ?? "",
      accountNumber: s?.account_number ?? null,
      name: s?.display_name ?? s?.name ?? m.staff_id,
      sections: secs.length > 0 ? secs : (m.section ? [m.section] : []),
    };
  });

  rows.sort((a, b) => {
    const an = a.accountNumber, bn = b.accountNumber;
    if (an == null && bn == null) return a.name.localeCompare(b.name, "ja");
    if (an == null) return 1;
    if (bn == null) return -1;
    const af = parseFloat(an), bf = parseFloat(bn);
    if (!isNaN(af) && !isNaN(bf) && af !== bf) return af - bf;
    return an.localeCompare(bn, "ja", { numeric: true });
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "I Works";
  wb.created = new Date();
  const ws = wb.addWorksheet("スキル管理");
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];

  ws.columns = [
    { width: 14 }, // メインセクション
    { width: 14 }, // アカウント番号
    { width: 16 }, // 名前
    ...sections.map(() => ({ width: 10 })),
    ...items.map(() => ({ width: 14 })),
  ];

  const hdr = ws.addRow(["メインセクション", "アカウント番号", "名前", ...sections, ...items.map(i => i.label)]);
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: "center" };
  hdr.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  });

  const OK_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } }; // 青
  const NG_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } }; // 赤

  for (const r of rows) {
    const row = ws.addRow([
      r.mainSection,
      r.accountNumber ?? "",
      r.name,
      ...sections.map(s => (r.sections.includes(s) ? "対応可能" : "対応不可")),
      ...items.map(i => (valueMap.get(`${r.staffId}_${i.id}`) ? "○" : "×")),
    ]);
    row.eachCell((cell, col) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
      if (col > 3) {
        cell.alignment = { horizontal: "center" };
        cell.fill = (cell.value === "対応可能" || cell.value === "○") ? OK_FILL : NG_FILL;
      }
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const filename = `スキル管理_${today}.xlsx`;

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
