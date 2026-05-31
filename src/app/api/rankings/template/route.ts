import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("番付インポート");

  ws.columns = [
    { header: "順位", key: "rank",    width: 14 },
    { header: "セクション", key: "section", width: 16 },
    { header: "社員名", key: "name",   width: 20 },
  ];

  // ヘッダースタイル
  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: "FF1F3864" } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border    = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  });
  headerRow.height = 20;

  // セクション選択肢の注記
  const noteRow = ws.addRow(["", "← 下記から選択", ""]);
  noteRow.getCell(2).font = { italic: true, color: { argb: "FF888888" }, size: 9 };

  const choices = ["ASS査定", "ASS販売", "査定販売", "Hybrid第3", "その他"];
  choices.forEach(c => {
    const r = ws.addRow(["", c, ""]);
    r.getCell(2).font = { color: { argb: "FF595959" }, size: 9 };
  });

  // 区切り
  ws.addRow([]);

  // サンプルデータ（査定）
  const sampleSatei = [
    ["1",        "ASS査定",  "ASS 42"],
    ["2",        "ASS査定",  "ASS 34"],
    ["3",        "査定販売",  "田中 花子"],
    ["4",        "Hybrid第3", "山田 太郎"],
    ["G",        "査定販売",  "佐藤 次郎"],
    ["審査待ち01", "ASS査定",  "ASS 01"],
  ];
  const sampleHanbai = [
    ["1",     "査定販売",  "本多 剛"],
    ["2",     "ASS販売",  "ASS 42"],
    ["3",     "ASS販売",  "ASS 25"],
    ["固定",   "査定販売",  "小林 高之"],
    ["累積待ち","ASS販売",  "ASS 01"],
  ];

  const allSamples = [...sampleSatei, [], ...sampleHanbai];

  // サンプル行ヘッダー
  const sh = ws.addRow(["▼ サンプルデータ（このまま入力してください）", "", ""]);
  ws.mergeCells(`A${sh.number}:C${sh.number}`);
  sh.getCell(1).font = { bold: true, color: { argb: "FFC55A11" }, size: 10 };
  sh.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

  allSamples.forEach(row => {
    if (row.length === 0) { ws.addRow([]); return; }
    const r = ws.addRow(row);
    r.eachCell(cell => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
        left: { style: "thin", color: { argb: "FFDDDDDD" } },
        right: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
    });
  });

  // バイナリ出力
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename*=UTF-8\'\'%E7%95%AA%E4%BB%98%E3%82%A4%E3%83%B3%E3%83%9D%E3%83%BC%E3%83%88%E3%83%86%E3%83%B3%E3%83%97%E3%83%AC%E3%83%BC%E3%83%88.xlsx',
    },
  });
}
