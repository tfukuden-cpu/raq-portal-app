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

const { data: projects } = await supa.from("projects").select("id, name").eq("is_active", true).order("id");

for (const p of projects ?? []) {
  const { count: members } = await supa.from("project_members").select("*", { count: "exact", head: true }).eq("project_id", p.id);
  const { count: holidays } = await supa.from("holiday_requests").select("*", { count: "exact", head: true }).eq("project_id", p.id);
  const { count: patterns } = await supa.from("shift_patterns").select("*", { count: "exact", head: true }).eq("project_id", p.id);
  console.log(`${p.id} "${p.name}"  メンバー:${members}名  シフトパターン:${patterns}件  希望休:${holidays}件`);
}
