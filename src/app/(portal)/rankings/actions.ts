"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

type RankingRow = {
  rank_label: string;
  rank_order: number;
  staff_name: string;
  category: "査定" | "販売";
};

function classifyRank(val: string): "num" | "G" | "shinsa" | "kotei" | "ruiseki" | "other" {
  const v = val.trim();
  if (/^\d+$/.test(v)) return "num";
  if (v === "G") return "G";
  if (v.startsWith("審査待ち")) return "shinsa";
  if (v === "固定") return "kotei";
  if (v === "累積待ち") return "ruiseki";
  return "other";
}

export async function importRankingsAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "未認証" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { error: "案件が選択されていません" };

  const file = formData.get("file") as File | null;
  if (!file) return { error: "ファイルが選択されていません" };

  const arrayBuf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(arrayBuf as any);

  // 全シートから行を収集
  const allRows: { rank: string; section: string; name: string }[] = [];
  wb.eachSheet(ws => {
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // ヘッダースキップ
      const rank    = String(row.getCell(1).value ?? "").trim();
      const section = String(row.getCell(2).value ?? "").trim();
      const name    = String(row.getCell(3).value ?? "").trim();
      if (!rank || !section || !name) return;
      if (rank === "順位") return; // 繰り返しヘッダースキップ
      allRows.push({ rank, section, name });
    });
  });

  if (allRows.length === 0) return { error: "データが見つかりませんでした" };

  // ASS査定 抽出
  const sateiRows = allRows.filter(r => r.section === "ASS査定");
  // ASS販売 抽出
  const hanbaiRows = allRows.filter(r => r.section === "ASS販売");

  function buildRankings(rows: typeof allRows, category: "査定" | "販売"): RankingRow[] {
    const numRows    = rows.filter(r => classifyRank(r.rank) === "num");
    const gRows      = rows.filter(r => classifyRank(r.rank) === "G");
    const shinsaRows = rows.filter(r => classifyRank(r.rank) === "shinsa");
    const koteiRows  = rows.filter(r => classifyRank(r.rank) === "kotei");
    const ruisekiRows= rows.filter(r => classifyRank(r.rank) === "ruiseki");

    const result: RankingRow[] = [];
    let order = 0;

    numRows.forEach((r, i) => {
      result.push({ rank_label: String(i + 1), rank_order: order++, staff_name: r.name, category });
    });
    gRows.forEach(r => {
      result.push({ rank_label: "G", rank_order: order++, staff_name: r.name, category });
    });
    shinsaRows.forEach((r, i) => {
      result.push({ rank_label: `審査待ち${String(i + 1).padStart(2, "0")}`, rank_order: order++, staff_name: r.name, category });
    });
    koteiRows.forEach(r => {
      result.push({ rank_label: "固定", rank_order: order++, staff_name: r.name, category });
    });
    ruisekiRows.forEach(r => {
      result.push({ rank_label: "累積待ち", rank_order: order++, staff_name: r.name, category });
    });

    return result;
  }

  const sateiRankings  = buildRankings(sateiRows,  "査定");
  const hanbaiRankings = buildRankings(hanbaiRows, "販売");
  const allRankings = [...sateiRankings, ...hanbaiRankings];

  if (allRankings.length === 0) return { error: "ASS査定・ASS販売のデータが見つかりませんでした。セクション列が「ASS査定」または「ASS販売」になっているか確認してください。" };

  const admin = createAdminClient();

  // 既存データ削除して入れ替え
  await admin.from("member_rankings").delete().eq("project_id", projectId);
  const { error: insertErr } = await admin.from("member_rankings").insert(
    allRankings.map(r => ({ project_id: projectId, ...r }))
  );

  if (insertErr) return { error: insertErr.message };

  return {
    ok: true,
    sateiCount: sateiRankings.length,
    hanbaiCount: hanbaiRankings.length,
  };
}
