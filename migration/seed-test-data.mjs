/**
 * テストデータ投入スクリプト
 *
 * 使い方:
 *   cd C:\dev\raq-portal-app
 *   node migration/seed-test-data.mjs
 *
 * 投入内容:
 *   - スタッフ 50名（S002〜S051）を Auth + staffs + project_members に登録
 *   - P001 のシフト（2026年5月・6月）を全員分作成
 *   - 希望休申請（2026年6月分）をランダムに作成
 *   - 再実行可能（upsert / skip）
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ============================================================
// 設定
// ============================================================
const INITIAL_PASSWORD = "raq-init-2026";
const PROJECT_ID = "P001";
const EMAIL_DOMAIN = "raq.internal";

// ============================================================
// 環境変数読み込み
// ============================================================
function loadEnv() {
  const envPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".env.local"
  );
  if (!existsSync(envPath)) {
    throw new Error(`.env.local が見つかりません: ${envPath}`);
  }
  let content = readFileSync(envPath, "utf-8");
  // BOM除去
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください");
  process.exit(1);
}

// ============================================================
// スタッフデータ（S002〜S051 ＝ 50名）
// ============================================================
// デモ用所属会社（5社をローテーション）
const COMPANIES = [
  "株式会社アクセル",
  "有限会社ブリッジワーク",
  "株式会社クロスサポート",
  "パートナーズ株式会社",
  "東京スタッフィング株式会社",
];

const STAFF_LIST = [
  { id: "S002", name: "佐藤 健太",   display: "佐藤",   role: "staff",         company: COMPANIES[0] },
  { id: "S003", name: "鈴木 美咲",   display: "鈴木",   role: "staff",         company: COMPANIES[0] },
  { id: "S004", name: "高橋 大輝",   display: "高橋",   role: "staff",         company: COMPANIES[0] },
  { id: "S005", name: "田中 愛",     display: "田中",   role: "staff",         company: COMPANIES[0] },
  { id: "S006", name: "伊藤 翔太",   display: "伊藤",   role: "staff",         company: COMPANIES[0] },
  { id: "S007", name: "渡辺 菜々",   display: "渡辺",   role: "staff",         company: COMPANIES[0] },
  { id: "S008", name: "山本 拓也",   display: "山本",   role: "staff",         company: COMPANIES[0] },
  { id: "S009", name: "中村 沙織",   display: "中村",   role: "staff",         company: COMPANIES[0] },
  { id: "S010", name: "小林 雄太",   display: "小林",   role: "staff",         company: COMPANIES[0] },
  { id: "S011", name: "加藤 里奈",   display: "加藤",   role: "project_admin", company: COMPANIES[0] },
  { id: "S012", name: "吉田 俊介",   display: "吉田",   role: "staff",         company: COMPANIES[1] },
  { id: "S013", name: "山田 彩香",   display: "山田",   role: "staff",         company: COMPANIES[1] },
  { id: "S014", name: "松本 蒼",     display: "松本",   role: "staff",         company: COMPANIES[1] },
  { id: "S015", name: "井上 真由",   display: "井上",   role: "staff",         company: COMPANIES[1] },
  { id: "S016", name: "木村 拓海",   display: "木村",   role: "staff",         company: COMPANIES[1] },
  { id: "S017", name: "林 結衣",     display: "林",     role: "staff",         company: COMPANIES[1] },
  { id: "S018", name: "清水 陸",     display: "清水",   role: "staff",         company: COMPANIES[1] },
  { id: "S019", name: "山崎 千尋",   display: "山崎",   role: "staff",         company: COMPANIES[1] },
  { id: "S020", name: "森 祐樹",     display: "森",     role: "staff",         company: COMPANIES[1] },
  { id: "S021", name: "池田 なつみ", display: "池田",   role: "staff",         company: COMPANIES[1] },
  { id: "S022", name: "橋本 勇気",   display: "橋本",   role: "staff",         company: COMPANIES[2] },
  { id: "S023", name: "石田 麻衣",   display: "石田",   role: "staff",         company: COMPANIES[2] },
  { id: "S024", name: "前田 航",     display: "前田",   role: "staff",         company: COMPANIES[2] },
  { id: "S025", name: "藤田 葵",     display: "藤田",   role: "staff",         company: COMPANIES[2] },
  { id: "S026", name: "後藤 光",     display: "後藤",   role: "staff",         company: COMPANIES[2] },
  { id: "S027", name: "小川 みく",   display: "小川",   role: "staff",         company: COMPANIES[2] },
  { id: "S028", name: "岡田 遼",     display: "岡田",   role: "staff",         company: COMPANIES[2] },
  { id: "S029", name: "長谷川 春菜", display: "長谷川", role: "staff",         company: COMPANIES[2] },
  { id: "S030", name: "中島 篤史",   display: "中島",   role: "project_admin", company: COMPANIES[2] },
  { id: "S031", name: "藤井 もも",   display: "藤井",   role: "staff",         company: COMPANIES[2] },
  { id: "S032", name: "西村 蓮",     display: "西村",   role: "staff",         company: COMPANIES[3] },
  { id: "S033", name: "福田 さくら", display: "福田",   role: "staff",         company: COMPANIES[3] },
  { id: "S034", name: "三浦 颯",     display: "三浦",   role: "staff",         company: COMPANIES[3] },
  { id: "S035", name: "岡本 夏希",   display: "岡本",   role: "staff",         company: COMPANIES[3] },
  { id: "S036", name: "松田 光輝",   display: "松田",   role: "staff",         company: COMPANIES[3] },
  { id: "S037", name: "中川 あかり", display: "中川",   role: "staff",         company: COMPANIES[3] },
  { id: "S038", name: "野口 賢",     display: "野口",   role: "staff",         company: COMPANIES[3] },
  { id: "S039", name: "原田 ゆき",   display: "原田",   role: "staff",         company: COMPANIES[3] },
  { id: "S040", name: "村上 悠斗",   display: "村上",   role: "staff",         company: COMPANIES[3] },
  { id: "S041", name: "和田 奈緒",   display: "和田",   role: "staff",         company: COMPANIES[3] },
  { id: "S042", name: "近藤 海斗",   display: "近藤",   role: "staff",         company: COMPANIES[4] },
  { id: "S043", name: "坂本 愛莉",   display: "坂本",   role: "staff",         company: COMPANIES[4] },
  { id: "S044", name: "上田 蒼汰",   display: "上田",   role: "staff",         company: COMPANIES[4] },
  { id: "S045", name: "石井 莉子",   display: "石井",   role: "staff",         company: COMPANIES[4] },
  { id: "S046", name: "河野 隼人",   display: "河野",   role: "staff",         company: COMPANIES[4] },
  { id: "S047", name: "斎藤 ひまり", display: "斎藤",   role: "staff",         company: COMPANIES[4] },
  { id: "S048", name: "横山 稜",     display: "横山",   role: "staff",         company: COMPANIES[4] },
  { id: "S049", name: "宮本 心",     display: "宮本",   role: "staff",         company: COMPANIES[4] },
  { id: "S050", name: "浜田 柊",     display: "浜田",   role: "staff",         company: COMPANIES[4] },
  { id: "S051", name: "谷口 みなみ", display: "谷口",   role: "staff",         company: COMPANIES[4] },
];

// ============================================================
// シフトパターン
// ============================================================
const SHIFT_PATTERNS = [
  { name: "Aシフト", start: "09:00:00", end: "18:00:00" },
  { name: "Bシフト", start: "13:00:00", end: "22:00:00" },
  { name: "公休",    start: null,        end: null        },
];

/**
 * YYYY-MM-DD 文字列の配列を返す（日曜は公休になりやすくする用途）
 */
function getDaysInMonth(year, month) {
  const days = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    date.setDate(date.getDate() + 1);
  }
  return days;
}

/**
 * 曜日取得（0=日〜6=土）
 */
function getDayOfWeek(dateStr) {
  return new Date(dateStr).getDay();
}

/**
 * スタッフ1人分のシフトを月ごとに生成
 * 大まかな規則：
 *   - 日曜 → 公休（70%）
 *   - 土曜 → 公休（40%）
 *   - 平日 → Aシフト60% / Bシフト30% / 公休10%
 *   - 月4〜6日程度公休になるよう調整
 */
function generateShiftsForStaff(staffId, year, month, seed) {
  const days = getDaysInMonth(year, month);
  const shifts = [];

  // 簡易擬似乱数（seed込み）
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };

  let holidayCount = 0;
  const maxHolidays = 6;

  for (const dateStr of days) {
    const dow = getDayOfWeek(dateStr);
    let shiftName, shiftStart, shiftEnd;

    const r = rand();
    if (holidayCount >= maxHolidays) {
      // 休み上限に達したらシフト確定
      const pat = r < 0.6 ? SHIFT_PATTERNS[0] : SHIFT_PATTERNS[1];
      shiftName = pat.name;
      shiftStart = pat.start;
      shiftEnd = pat.end;
    } else if (dow === 0) {
      // 日曜
      if (r < 0.7) {
        shiftName = "公休"; shiftStart = null; shiftEnd = null; holidayCount++;
      } else {
        const pat = r < 0.85 ? SHIFT_PATTERNS[0] : SHIFT_PATTERNS[1];
        shiftName = pat.name; shiftStart = pat.start; shiftEnd = pat.end;
      }
    } else if (dow === 6) {
      // 土曜
      if (r < 0.4) {
        shiftName = "公休"; shiftStart = null; shiftEnd = null; holidayCount++;
      } else {
        const pat = r < 0.7 ? SHIFT_PATTERNS[0] : SHIFT_PATTERNS[1];
        shiftName = pat.name; shiftStart = pat.start; shiftEnd = pat.end;
      }
    } else {
      // 平日
      if (r < 0.1) {
        shiftName = "公休"; shiftStart = null; shiftEnd = null; holidayCount++;
      } else if (r < 0.5) {
        shiftName = "Aシフト"; shiftStart = "09:00:00"; shiftEnd = "18:00:00";
      } else {
        shiftName = "Bシフト"; shiftStart = "13:00:00"; shiftEnd = "22:00:00";
      }
    }

    shifts.push({
      project_id: PROJECT_ID,
      staff_id: staffId,
      shift_date: dateStr,
      shift_name: shiftName,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      status: "confirmed",
    });
  }

  return shifts;
}

/**
 * 希望休申請を生成（6月分・1人1〜3件）
 */
function generateHolidayRequests(staffId, year, month, seed) {
  const days = getDaysInMonth(year, month);
  const workDays = days.filter(d => getDayOfWeek(d) !== 0); // 日曜除く

  let state = seed + 9999;
  const rand = () => {
    state = (state * 22695477 + 1) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };

  const count = 1 + Math.floor(rand() * 3); // 1〜3件
  // 承認フロー不要：申請即確定
  const statuses = ["approved"];
  const requests = [];
  const used = new Set();

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const idx = Math.floor(rand() * workDays.length);
      const dateStr = workDays[idx];
      if (!used.has(dateStr)) {
        used.add(dateStr);
        const status = statuses[Math.floor(rand() * statuses.length)];
        requests.push({
          project_id: PROJECT_ID,
          staff_id: staffId,
          request_date: dateStr,
          status,
          note: null,
        });
        break;
      }
      attempts++;
    }
  }

  return requests;
}

// ============================================================
// メイン
// ============================================================
async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("🚀 テストデータ投入開始");
  console.log(`📦 案件: ${PROJECT_ID}`);
  console.log(`👥 スタッフ: ${STAFF_LIST.length}名（S002〜S051）`);
  console.log(`🔑 初期パスワード: ${INITIAL_PASSWORD}`);
  console.log("");

  // -------------------------------------------------------
  // STEP 1: スタッフ登録
  // -------------------------------------------------------
  console.log("── STEP 1: スタッフ登録 ──────────────────────────");

  let authCreated = 0, authSkipped = 0, authErrors = 0;

  // 既存Authユーザー一覧を取得（ページネーション対応）
  let allAuthUsers = [];
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (!data?.users?.length) break;
    allAuthUsers = allAuthUsers.concat(data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  const existingEmails = new Map(allAuthUsers.map(u => [u.email, u.id]));

  const staffsToUpsert = [];
  const membersToUpsert = [];

  for (const staff of STAFF_LIST) {
    const email = `${staff.id.toLowerCase()}@${EMAIL_DOMAIN}`;
    let authUserId = existingEmails.get(email);

    if (!authUserId) {
      // Auth ユーザー新規作成
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: INITIAL_PASSWORD,
        email_confirm: true,
        user_metadata: { staff_id: staff.id, name: staff.name },
      });

      if (authErr) {
        console.error(`  ❌ Auth作成失敗 ${staff.id}: ${authErr.message}`);
        authErrors++;
        continue;
      }
      authUserId = authUser.user.id;
      authCreated++;
      process.stdout.write(`  ✅ ${staff.id} ${staff.display}\n`);
    } else {
      authSkipped++;
      process.stdout.write(`  ⏭  ${staff.id} ${staff.display}（既存）\n`);
    }

    staffsToUpsert.push({
      id: staff.id,
      auth_user_id: authUserId,
      name: staff.name,
      display_name: staff.display,
      company_name: staff.company,
      global_role: "staff",
      default_project_id: PROJECT_ID,
      must_change_password: true,
      is_active: true,
    });

    membersToUpsert.push({
      staff_id: staff.id,
      project_id: PROJECT_ID,
      role: staff.role,
      is_main: true,
    });
  }

  // staffs upsert
  if (staffsToUpsert.length > 0) {
    const { error } = await supabase.from("staffs").upsert(staffsToUpsert, { onConflict: "id" });
    if (error) console.error("  ❌ staffs upsert:", error.message);
    else console.log(`\n  📋 staffs: ${staffsToUpsert.length}件 upsert完了`);
  }

  // project_members upsert
  if (membersToUpsert.length > 0) {
    const { error } = await supabase.from("project_members").upsert(membersToUpsert, { onConflict: "staff_id,project_id" });
    if (error) console.error("  ❌ project_members upsert:", error.message);
    else console.log(`  👥 project_members: ${membersToUpsert.length}件 upsert完了`);
  }

  console.log(`\n  新規: ${authCreated} / スキップ: ${authSkipped} / エラー: ${authErrors}`);

  // -------------------------------------------------------
  // STEP 2: シフト生成（2026年5月・6月）
  // -------------------------------------------------------
  console.log("\n── STEP 2: シフト生成 ──────────────────────────────");

  const allStaffIds = STAFF_LIST.map(s => s.id);
  const months = [
    { year: 2026, month: 5 },
    { year: 2026, month: 6 },
  ];

  let shiftBatch = [];
  let seedBase = 42;

  for (const { year, month } of months) {
    for (let i = 0; i < allStaffIds.length; i++) {
      const staffId = allStaffIds[i];
      const seed = seedBase + i * 31 + month * 1000;
      const shifts = generateShiftsForStaff(staffId, year, month, seed);
      shiftBatch = shiftBatch.concat(shifts);
    }
  }

  console.log(`  📅 生成シフト件数: ${shiftBatch.length}件`);

  // バッチサイズ分割でupsert（Supabase は1リクエスト推奨500件程度）
  const BATCH = 400;
  let shiftSuccess = 0, shiftError = 0;
  for (let i = 0; i < shiftBatch.length; i += BATCH) {
    const chunk = shiftBatch.slice(i, i + BATCH);
    const { error } = await supabase
      .from("shifts")
      .upsert(chunk, { onConflict: "project_id,staff_id,shift_date" });
    if (error) {
      console.error(`  ❌ shifts upsert (chunk ${i / BATCH + 1}):`, error.message);
      shiftError += chunk.length;
    } else {
      shiftSuccess += chunk.length;
    }
  }
  console.log(`  ✅ シフトupsert: 成功${shiftSuccess}件 / エラー${shiftError}件`);

  // -------------------------------------------------------
  // STEP 3: 希望休申請（2026年5月・6月分）
  // -------------------------------------------------------
  console.log("\n── STEP 3: 希望休申請生成（2026年5月・6月） ──────────");

  let holidayBatch = [];
  for (const { year, month } of [{ year: 2026, month: 5 }, { year: 2026, month: 6 }]) {
    for (let i = 0; i < allStaffIds.length; i++) {
      const staffId = allStaffIds[i];
      const seed = 777 + i * 53 + month * 999;
      const requests = generateHolidayRequests(staffId, year, month, seed);
      holidayBatch = holidayBatch.concat(requests);
    }
  }

  console.log(`  🏖  生成件数: ${holidayBatch.length}件（5月・6月合計）`);

  // 既存データを削除してから再投入
  const { error: delErr } = await supabase
    .from("holiday_requests")
    .delete()
    .eq("project_id", PROJECT_ID)
    .in("staff_id", allStaffIds);

  if (delErr) console.warn("  ⚠ 既存holiday_requests削除:", delErr.message);

  let holidaySuccess = 0, holidayError = 0;
  for (let i = 0; i < holidayBatch.length; i += BATCH) {
    const chunk = holidayBatch.slice(i, i + BATCH);
    const { error } = await supabase.from("holiday_requests").insert(chunk);
    if (error) {
      console.error(`  ❌ holiday_requests insert (chunk ${i / BATCH + 1}):`, error.message);
      holidayError += chunk.length;
    } else {
      holidaySuccess += chunk.length;
    }
  }
  console.log(`  ✅ 希望休insert: 成功${holidaySuccess}件 / エラー${holidayError}件`);

  // -------------------------------------------------------
  // 完了
  // -------------------------------------------------------
  console.log("\n" + "=".repeat(55));
  console.log("✅ テストデータ投入完了！");
  console.log("=".repeat(55));
  console.log(`\n📌 ログイン情報`);
  console.log(`   社員ID: S002〜S051`);
  console.log(`   パスワード: ${INITIAL_PASSWORD}`);
  console.log(`   例: s002@raq.internal / ${INITIAL_PASSWORD}`);
  console.log(`\n📌 管理者スタッフ（project_admin）`);
  STAFF_LIST.filter(s => s.role === "project_admin").forEach(s => {
    console.log(`   ${s.id} ${s.name}`);
  });
  console.log(`\n💡 シフト確認: http://localhost:3000 にログイン → シフトメニュー`);
}

main().catch((e) => {
  console.error("致命的エラー:", e);
  process.exit(1);
});
