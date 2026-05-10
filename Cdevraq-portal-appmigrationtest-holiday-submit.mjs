/**
 * 希望休申請の動作確認スクリプト
 * submitHolidayAction と同じロジックで admin client を使って INSERT する
 *
 * 使い方:
 *   node migration/test-holiday-submit.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (!existsSync(envPath)) throw new Error(".env.local が見つかりません");
  let content = readFileSync(envPath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PROJECT_ID = "P001";
// 今日から5日間を5名のスタッフで申請
const TEST_STAFFS = ["S002", "S005", "S010", "S022", "S035"];
const today = new Date();
const rows = [];

for (const staffId of TEST_STAFFS) {
  const offset = TEST_STAFFS.indexOf(staffId);
  const d = new Date(today);
  d.setDate(d.getDate() + offset + 1); // 明日〜5日後
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  rows.push({ project_id: PROJECT_ID, staff_id: staffId, request_date: dateStr, status: "approved", note: "テスト申請" });
}

console.log("── 申請データ ─────────────────────────");
rows.forEach(r => console.log(`  ${r.staff_id}  ${r.request_date}`));
console.log("");

const { error } = await supabase.from("holiday_requests").insert(rows);
if (error) {
  console.error("❌ INSERT 失敗:", error.message);
} else {
  console.log(`✅ ${rows.length}件 申請成功（status=approved）`);
  console.log("\n💡 次の確認:");
  console.log("  1. /holidays/manage でデータが見える");
  console.log("  2. 案件設定 → シフト表を生成 → 該当日がピンク「公休」になる");
}
