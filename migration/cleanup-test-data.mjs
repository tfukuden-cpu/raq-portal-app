/**
 * seed-test-data.mjs で作ったテストデータを削除するスクリプト
 *
 * 使い方:
 *   cd C:\dev\raq-portal-app
 *   node migration/cleanup-test-data.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
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

const TEST_IDS = Array.from({ length: 50 }, (_, i) =>
  `S${String(i + 2).padStart(3, "0")}`
); // S002〜S051

async function main() {
  console.log("🗑  テストデータ削除開始（S002〜S051）\n");

  // holiday_requests
  const { error: e1 } = await supabase.from("holiday_requests").delete().in("staff_id", TEST_IDS);
  console.log(e1 ? `❌ holiday_requests: ${e1.message}` : "✅ holiday_requests 削除完了");

  // shifts
  const { error: e2 } = await supabase.from("shifts").delete().in("staff_id", TEST_IDS);
  console.log(e2 ? `❌ shifts: ${e2.message}` : "✅ shifts 削除完了");

  // project_members
  const { error: e3 } = await supabase.from("project_members").delete().in("staff_id", TEST_IDS);
  console.log(e3 ? `❌ project_members: ${e3.message}` : "✅ project_members 削除完了");

  // staffs
  const { error: e4 } = await supabase.from("staffs").delete().in("id", TEST_IDS);
  console.log(e4 ? `❌ staffs: ${e4.message}` : "✅ staffs 削除完了");

  // Auth ユーザー削除
  console.log("\n  Auth ユーザー削除中...");
  let page = 1;
  let allUsers = [];
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (!data?.users?.length) break;
    allUsers = allUsers.concat(data.users);
    if (data.users.length < 1000) break;
    page++;
  }

  const testEmails = new Set(TEST_IDS.map(id => `${id.toLowerCase()}@raq.internal`));
  const toDelete = allUsers.filter(u => testEmails.has(u.email));

  let deleted = 0;
  for (const u of toDelete) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) console.error(`  ❌ ${u.email}: ${error.message}`);
    else deleted++;
  }

  console.log(`✅ Auth ユーザー: ${deleted}件 削除完了`);
  console.log("\n🏁 クリーンアップ完了！");
}

main().catch(e => { console.error(e); process.exit(1); });
