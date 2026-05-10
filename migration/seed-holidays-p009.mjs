/**
 * P009 の希望休ダミーデータ投入
 * node migration/seed-holidays-p009.mjs
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
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PROJECT_ID = "P009";

// P009 のメンバー取得
const { data: members } = await supa
  .from("project_members").select("staff_id").eq("project_id", PROJECT_ID);
const staffIds = (members ?? []).map(m => m.staff_id);
console.log(`対象スタッフ: ${staffIds.length}名`);

function getDaysInMonth(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function generateRequests(staffId, year, month, seed) {
  let state = seed;
  const rand = () => { state = (state * 22695477 + 1) & 0xffffffff; return (state >>> 0) / 0xffffffff; };
  const days = getDaysInMonth(year, month).filter(d => new Date(d).getDay() !== 0);
  const count = 1 + Math.floor(rand() * 3);
  const used = new Set();
  const rows = [];
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 20; t++) {
      const dateStr = days[Math.floor(rand() * days.length)];
      if (!used.has(dateStr)) {
        used.add(dateStr);
        rows.push({ project_id: PROJECT_ID, staff_id: staffId, request_date: dateStr, status: "approved", note: null });
        break;
      }
    }
  }
  return rows;
}

// 既存データ削除
await supa.from("holiday_requests").delete().eq("project_id", PROJECT_ID).in("staff_id", staffIds);

let batch = [];
for (let i = 0; i < staffIds.length; i++) {
  for (const { year, month } of [{ year: 2026, month: 5 }, { year: 2026, month: 6 }]) {
    batch.push(...generateRequests(staffIds[i], year, month, 777 + i * 53 + month * 999));
  }
}

const { error } = await supa.from("holiday_requests").insert(batch);
if (error) console.error("❌", error.message);
else console.log(`✅ ${batch.length}件 投入完了（P009・5月・6月）`);
