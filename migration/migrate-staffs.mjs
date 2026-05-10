/**
 * 既存スプシの社員名簿CSVをSupabaseに一括移行するスクリプト
 *
 * 使い方:
 *   1. C:\dev\raq-portal-app\migration\staffs.csv にCSVを置く
 *   2. PowerShellで以下を実行:
 *        cd C:\dev\raq-portal-app
 *        node migration/migrate-staffs.mjs
 *
 * 動作:
 *   - 各行について Supabase Auth ユーザーを作成
 *   - staffs テーブルに登録
 *   - project_members テーブルに DEFAULT_PROJECT_ID で登録
 *   - must_change_password = true（初回ログインでパスワード変更を強制）
 *   - 既存ユーザーはスキップ（再実行可能）
 *
 * CSV想定フォーマット（既存社員名簿シート）:
 *   1行目: ヘッダー（無視）
 *   A列: 社員ID  B列: パスワード(無視)  C列: 氏名
 *   D列: 部署    E列: 任意              F列: 表示名
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ============================================================
// 設定
// ============================================================
const CSV_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "staffs.csv"
);
const INITIAL_PASSWORD = "raq-init-2026"; // 初期パスワード（社員に通知して使う）
const EMAIL_DOMAIN = "raq.internal";
// project_members は作成しない。
// 案件への所属は管理画面（案件設定 > メンバー管理）で追加してください。

// ============================================================
// 環境変数読み込み（.env.local から）
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
  const content = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌ NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください"
  );
  process.exit(1);
}

// ============================================================
// シンプルCSVパーサ（カンマ区切り、ダブルクオート対応）
// ============================================================
function parseCSV(text) {
  // BOM除去
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\r") {
        // ignore
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!existsSync(CSV_PATH)) {
    console.error(`❌ CSVが見つかりません: ${CSV_PATH}`);
    console.error(
      "   既存スプシの社員名簿シートを CSV ダウンロードして、上記パスに置いてください"
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const csvText = readFileSync(CSV_PATH, "utf-8");
  const rows = parseCSV(csvText);
  const dataRows = rows.slice(1); // ヘッダー除外

  console.log(`📄 CSV読み込み: ${dataRows.length} 件`);
  console.log(`🔑 初期パスワード: ${INITIAL_PASSWORD}`);
  console.log(`💡 案件への所属は管理画面のメンバー管理で追加してください`);
  console.log("");

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of dataRows) {
    const id = (row[0] ?? "").trim();
    const name = (row[2] ?? "").trim();
    const dept = (row[3] ?? "").trim();
    const displayName = (row[5] ?? "").trim() || name;

    if (!id || !name) {
      console.log(`⏭️  スキップ（IDor氏名なし）: ${JSON.stringify(row)}`);
      skipped++;
      continue;
    }

    const email = `${id.toLowerCase()}@${EMAIL_DOMAIN}`;
    const globalRole =
      dept === "管理" || dept === "管理者" ? "admin" : "staff";

    try {
      // 1. Auth ユーザーを作成
      const { data: authUser, error: authErr } =
        await supabase.auth.admin.createUser({
          email,
          password: INITIAL_PASSWORD,
          email_confirm: true,
          user_metadata: { staff_id: id, name },
        });

      let authUserId;
      if (authErr) {
        if (
          authErr.message?.includes("already") ||
          authErr.code === "email_exists"
        ) {
          // 既存の場合：IDを取得
          const { data: existing } = await supabase.auth.admin.listUsers();
          const found = existing?.users?.find((u) => u.email === email);
          authUserId = found?.id;
          console.log(`⏭️  既存Authユーザー: ${id} (${email})`);
        } else {
          throw authErr;
        }
      } else {
        authUserId = authUser.user.id;
      }

      if (!authUserId) {
        throw new Error("Auth user IDを取得できませんでした");
      }

      // 2. staffs に upsert
      const { error: staffErr } = await supabase.from("staffs").upsert(
        {
          id,
          auth_user_id: authUserId,
          name,
          display_name: displayName,
          global_role: globalRole,
          must_change_password: true,
          is_active: true,
        },
        { onConflict: "id" }
      );

      if (staffErr) throw staffErr;

      // ※ project_members は作成しない
      // 案件への所属は管理画面（案件設定 > メンバー管理）で追加する

      console.log(`✅ ${id} ${displayName} (${globalRole})`);
      created++;
    } catch (e) {
      console.error(`❌ エラー ${id}: ${e.message ?? e}`);
      errors++;
    }
  }

  console.log("");
  console.log("=".repeat(50));
  console.log(`✅ 成功: ${created}`);
  console.log(`⏭️  スキップ: ${skipped}`);
  console.log(`❌ エラー: ${errors}`);
  console.log("=".repeat(50));
  console.log("");
  console.log(`💡 全員のパスワードは「${INITIAL_PASSWORD}」です`);
  console.log("   社員に通知し、初回ログイン時に変更を促してください");
  console.log("");
  console.log("📌 次のステップ：");
  console.log("   管理画面 > 各案件の設定 > メンバー管理");
  console.log("   → スタッフ名を選んで「追加」すると案件に紐づきます");
}

main().catch((e) => {
  console.error("致命的エラー:", e);
  process.exit(1);
});
