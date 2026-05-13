/**
 * Google Sheets API ヘルパー
 *
 * 認証方式（どちらか一方を .env.local に設定）:
 *   A) OAuth2（推奨）:
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   B) サービスアカウント:
 *      GOOGLE_SERVICE_ACCOUNT_JSON
 */

import { createSign } from "node:crypto";

// アクセストークンをプロセス内でキャッシュ
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expiresAt > now + 60) {
    return _tokenCache.token;
  }

  // ── A) OAuth2（リフレッシュトークン方式） ──
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    const data = (await res.json()) as { access_token?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description ?? "OAuthトークンの取得に失敗しました");
    }
    _tokenCache = { token: data.access_token, expiresAt: now + 3500 };
    return data.access_token;
  }

  // ── B) サービスアカウント（JWT方式） ──
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("Google認証が設定されていません（GOOGLE_REFRESH_TOKEN または GOOGLE_SERVICE_ACCOUNT_JSON が必要です）");

  // Vercelへの貼り付けでJSONが壊れることがあるため、3段階でフォールバック解析する
  let client_email: string | undefined;
  let private_key: string | undefined;

  // 試行1: 標準のJSON.parse
  try {
    const p = JSON.parse(json) as Record<string, string>;
    client_email = p.client_email;
    private_key  = p.private_key;
  } catch { /* → 試行2へ */ }

  // 試行2: PEM内の実際の改行を \n エスケープに変換して再パース
  if (!private_key) {
    try {
      const fixed = json.replace(
        /(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----\r?\n?)/g,
        (_, b, m, e) => b + m.replace(/\r?\n/g, "\\n") + e.replace(/\r?\n/g, "\\n"),
      );
      const p = JSON.parse(fixed) as Record<string, string>;
      client_email = p.client_email;
      private_key  = p.private_key;
    } catch { /* → 試行3へ */ }
  }

  // 試行3: JSONパースを諦めて正規表現で直接抽出
  if (!private_key) {
    const emailMatch = json.match(/"client_email"\s*:\s*"([^"]+)"/);
    const pemMatch   = json.match(/(-----BEGIN [A-Z ]+ KEY-----)([\s\S]+?)(-----END [A-Z ]+ KEY-----)/);
    if (emailMatch && pemMatch) {
      // base64部分の空白・改行をすべて除去して標準PEMに再組み立て
      const b64 = pemMatch[2].replace(/[\s\r\n]/g, "");
      client_email = emailMatch[1];
      private_key  = `-----BEGIN PRIVATE KEY-----\\n${b64}\\n-----END PRIVATE KEY-----\\n`;
    }
  }

  if (!client_email || !private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON からclient_emailとprivate_keyを読み取れませんでした。サービスアカウントのJSONファイルをVercelに再設定してください。");
  }
  const pem = private_key.replace(/\\n/g, "\n");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const sign = createSign("RSA-SHA256");
  sign.write(signingInput);
  sign.end();
  const jwt = `${signingInput}.${sign.sign(pem, "base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? "アクセストークンの取得に失敗しました");
  }
  _tokenCache = { token: data.access_token, expiresAt: now + 3600 };
  return data.access_token;
}

/** URL または ID からスプレッドシートIDを抽出 */
export function extractSpreadsheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : urlOrId.trim();
}

/**
 * シートの値を読み取る
 * @returns 行の配列（各行はセルの文字列配列）
 */
export async function readSheet(
  spreadsheetId: string,
  sheetName: string,
  range = "A:Z"
): Promise<string[][]> {
  const token = await getAccessToken();
  const encodedRange = encodeURIComponent(`${sheetName}!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `シートの読み取りに失敗しました (${res.status})`);
  }

  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

/**
 * シートに値を書き込む（既存データをクリアしてから上書き）
 */
export async function writeSheet(
  spreadsheetId: string,
  sheetName: string,
  values: string[][],
  range = "A1"
): Promise<void> {
  const token = await getAccessToken();
  const encodedClearRange = encodeURIComponent(`${sheetName}!A:AZ`); // 52列まで対応（31日+余裕）

  // まずクリア
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedClearRange}:clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (values.length === 0) return;

  const encodedRange = encodeURIComponent(`${sheetName}!${range}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range: `${sheetName}!${range}`, majorDimension: "ROWS", values }),
    }
  );

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `シートへの書き込みに失敗しました (${res.status})`);
  }
}

/**
 * シートの末尾に1行追記する（既存データを消さない）
 * ヘッダー行が存在しない場合は先にヘッダーを書き込む
 */
export async function appendSheetRow(
  spreadsheetId: string,
  sheetName: string,
  row: string[]
): Promise<void> {
  const token = await getAccessToken();
  const encodedRange = encodeURIComponent(`${sheetName}!A:A`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `行の追記に失敗しました (${res.status})`);
  }
}

/**
 * シートの特定セルだけを更新（シート全体をクリアしない）
 * @param range A1記法のセル範囲 例: "D5"
 */
export async function patchSheetCell(
  spreadsheetId: string,
  sheetName: string,
  range: string,
  value: string
): Promise<void> {
  const token = await getAccessToken();
  const encodedRange = encodeURIComponent(`${sheetName}!${range}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[value]] }),
    }
  );
  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `セルの更新に失敗しました (${res.status})`);
  }
}

/**
 * メンバーシートをプロジェクトの現在のメンバー一覧で上書き同期する
 * メンバー追加・削除・ロール変更のたびに呼ぶ
 */
export async function syncMembersSheet(
  spreadsheetId: string,
  members: {
    id: string;
    displayName: string;
    companyName: string | null;
    role: string;
    weeklyDays?: number | null;
    shiftPreference?: string | null;
    lineId?: string | null;
  }[]
): Promise<void> {
  const header = SHEET_HEADERS["メンバー"]; // ["社員ID", "所属会社", "氏名", "役割", "基本勤務日数", "メモ"]
  const rows = members.map((m) => [
    m.id,
    m.companyName ?? "",
    m.displayName,
    m.role,
    String(m.weeklyDays ?? 5),
    m.shiftPreference ?? "",
    m.lineId ?? "",
  ]);
  await writeSheet(spreadsheetId, "メンバー", [header, ...rows]);
}

/**
 * シートの基本情報（ID・既存の条件付き書式ルール数）を取得する
 */
async function getSheetInfo(
  spreadsheetId: string,
  sheetName: string
): Promise<{ sheetId: number; conditionalFormatRuleCount: number }> {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    sheets?: {
      properties: { title: string; sheetId: number };
      conditionalFormats?: unknown[];
    }[];
  };
  const sheet = data.sheets?.find((s) => s.properties.title === sheetName);
  return {
    sheetId:                    sheet?.properties.sheetId ?? 0,
    conditionalFormatRuleCount: sheet?.conditionalFormats?.length ?? 0,
  };
}

/**
 * シートが存在しなければ新規作成してシートIDを返す
 */
async function ensureSheetExists(
  spreadsheetId: string,
  sheetName: string
): Promise<{ sheetId: number; conditionalFormatRuleCount: number }> {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    sheets?: {
      properties: { title: string; sheetId: number };
      conditionalFormats?: unknown[];
    }[];
  };
  const existing = data.sheets?.find((s) => s.properties.title === sheetName);
  if (existing) {
    return {
      sheetId:                    existing.properties.sheetId,
      conditionalFormatRuleCount: existing.conditionalFormats?.length ?? 0,
    };
  }

  // シートを新規作成
  const addRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
    }
  );
  const addData = (await addRes.json()) as {
    replies?: [{ addSheet?: { properties?: { sheetId?: number } } }];
  };
  return {
    sheetId:                    addData.replies?.[0]?.addSheet?.properties?.sheetId ?? 0,
    conditionalFormatRuleCount: 0,
  };
}

/** シートIDをシート名から取得する（後方互換用） */
async function getSheetId(spreadsheetId: string, sheetName: string): Promise<number> {
  return (await getSheetInfo(spreadsheetId, sheetName)).sheetId;
}

/** 1-indexed 列番号をアルファベットに変換 (1→A, 26→Z, 27→AA) */
function columnLetter(col: number): string {
  let s = "";
  while (col > 0) {
    const r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}


/**
 * シフト表シートを生成する（2段構成）
 *
 * 【上段：確認ビュー】縦＝シフトパターン×枠数（必要人数分の行＋集計行）、横＝日付
 *   → 入力ビューを集計して自動表示
 * 【下段：入力ビュー】縦＝スタッフ名（1名1行）、横＝日付
 *   → 各セルにシフトパターン名を選択（ドロップダウン）
 *
 * 下段を入力すると上段の確認ビューが自動更新される。
 */
export async function generateShiftTableSheet(
  spreadsheetId: string,
  members: { id: string; displayName: string; companyName?: string | null; role?: string }[],
  shiftPatterns: { name: string; required_count?: number | null; start_time?: string | null; end_time?: string | null; target_role?: string }[],
  year: number,
  month: number,  // 1-12
  approvedHolidays: { staffId: string; requestDate: string }[] = [],
  draftAssign = false,  // true = 仮組（空き枠に自動でパターンを割り当て）
): Promise<void> {
  const daysInMonth = new Date(year, month, 0).getDate();

  // ロールで分割・並び替え（管理者→スタッフ）
  const adminMembers     = members.filter(m => m.role === "project_admin");
  const staffOnlyMembers = members.filter(m => m.role !== "project_admin");
  const orderedMembers   = [...adminMembers, ...staffOnlyMembers];
  const M_admin = adminMembers.length;
  const M_staff = staffOnlyMembers.length;
  const M = M_admin + M_staff;
  const hasBothRoles = M_admin > 0 && M_staff > 0;
  const midSepCount  = hasBothRoles ? 1 : 0; // 管理者↔スタッフ間の区切り行数

  // ── パターン分類（管理者専用 vs スタッフ/全員） ──────────────
  const adminPatterns = shiftPatterns.filter(p => (p.target_role ?? "all") === "admin");
  const staffPatterns = shiftPatterns.filter(p => (p.target_role ?? "all") !== "admin");
  const PA = adminPatterns.length;
  const PS = staffPatterns.length;
  const hasConfirmSplit = PA > 0 && PS > 0; // 確認ビューを2セクションに分割するか

  const adminSlotCounts = adminPatterns.map(p => Math.max(1, p.required_count ?? 1));
  const staffSlotCounts = staffPatterns.map(p => Math.max(1, p.required_count ?? 1));

  // 管理者確認ブロック開始行（0-indexed、行0=確認ヘッダー）
  const adminConfirmBlockStarts: number[] = [];
  let aOff = 1;
  for (let i = 0; i < PA; i++) {
    adminConfirmBlockStarts.push(aOff);
    aOff += adminSlotCounts[i] + 3;
  }
  const totalAdminConfirmRows = aOff - 1;

  // 確認ビュー内の管理者↔スタッフ区切り行（両方あるとき）
  const rConfirmMidSep = hasConfirmSplit ? (1 + totalAdminConfirmRows) : -1;
  const confirmMidCount = hasConfirmSplit ? 1 : 0;

  // スタッフ確認ブロック開始行（0-indexed）
  const staffConfirmBlockStarts: number[] = [];
  let sOff = 1 + totalAdminConfirmRows + confirmMidCount;
  for (let i = 0; i < PS; i++) {
    staffConfirmBlockStarts.push(sOff);
    sOff += staffSlotCounts[i] + 3;
  }
  const totalStaffConfirmRows = sOff - (1 + totalAdminConfirmRows + confirmMidCount);

  const totalConfirmRows = totalAdminConfirmRows + confirmMidCount + totalStaffConfirmRows;

  // 日付セルは DATE 関数で書き込み → 実際の日付値として扱われる
  const dateCells = Array.from({ length: daysInMonth }, (_, i) =>
    `=DATE(${year},${month},${i + 1})`
  );

  // ── 行レイアウト（0-indexed）────────────────────────────
  //
  // 【上段：確認ビュー】
  // Row 0          : 確認ビューヘッダー
  // 管理者パターンブロック（adminConfirmBlockStarts[i] から）
  //   ※ hasConfirmSplit のとき、管理者ブロック後に区切り行（rConfirmMidSep）→ スタッフブロック
  // スタッフパターンブロック（staffConfirmBlockStarts[i] から）
  //   各ブロック: slotCounts[i]枠行 + 必要 + 充足 + 過不足
  //
  // 【区切り】
  // rSep           : 空行
  //
  // 【下段：入力ビュー】
  // rIH            : 入力ビューヘッダー（A=スタッフ名、B-=日付）
  // rI0 〜 rI1     : スタッフ行（A=氏名、B-=シフトパターンドロップダウン）

  // 0-indexed キー行
  const rCH  = 0;
  const rSep = 1 + totalConfirmRows;
  const rIH  = rSep + 1;                              // 入力ヘッダー
  const rI0  = rIH + 1;                               // 管理者行 開始
  const rAdminEnd = rIH + M_admin;                    // 管理者行 終了（管理者0名なら rIH）
  const rMidSep   = rIH + M_admin + 1;                // 入力ビュー 管理者↔スタッフ区切り
  const rStaff0   = rIH + M_admin + midSepCount + 1;  // スタッフ行 開始
  const rI1  = rIH + M + midSepCount;                 // 最終スタッフ行

  // 1-indexed（数式参照用）：FILTER/COUNTIF は区切り行を含む範囲でOK（空行は無視される）
  const iStart1      = rI0 + 1;         // 全行（管理者＋スタッフ）開始
  const iEnd1        = rI1 + 1;         // 全行 終了
  const iAdminStart1 = rI0 + 1;         // 管理者入力行 開始
  const iAdminEnd1   = M_admin > 0 ? rAdminEnd + 1 : rI0 + 1; // 管理者入力行 終了

  // 時刻を "HH:MM" 形式に整形（DB値は "HH:MM:SS" または "HH:MM"）
  const fmtTime = (t?: string | null) => (t ? t.slice(0, 5) : "");

  // ── 確認ビューセクション生成ヘルパー ─────────────────────
  // 列構成: A=パターン名、B=時間帯、C〜=日付
  // filterStart1/filterEnd1 : FILTER/COUNTIF が参照する入力行レンジ（1-indexed）
  const buildConfirmRows = (
    patterns: typeof shiftPatterns,
    blockStarts: number[],
    slotCounts: number[],
    filterStart1: number,
    filterEnd1: number,
  ): string[][] => {
    const rows: string[][] = [];
    patterns.forEach((p, pi) => {
      const req     = p.required_count ?? 0;
      const reqRow1 = blockStarts[pi] + slotCounts[pi] + 1; // 1-indexed 必要行
      const cntRow1 = blockStarts[pi] + slotCounts[pi] + 2; // 1-indexed 充足行
      const s = fmtTime(p.start_time);
      const e = fmtTime(p.end_time);
      const timeRange = (s && e) ? `${s}〜${e}` : "";
      const pNameEsc = (p.name ?? "").replace(/"/g, '""');

      for (let j = 0; j < slotCounts[pi]; j++) {
        rows.push([
          p.name, timeRange, "",
          ...Array.from({ length: daysInMonth }, (_, di) => {
            const col = columnLetter(di + 4);
            return `=IFERROR(INDEX(FILTER($C$${filterStart1}:$C$${filterEnd1},${col}$${filterStart1}:${col}$${filterEnd1}="${pNameEsc}"),${j + 1}),"")`;
          }),
        ]);
      }
      rows.push(["必要", "", "", ...Array.from({ length: daysInMonth }, () => req > 0 ? String(req) : "")]);
      rows.push(["充足", "", "", ...Array.from({ length: daysInMonth }, (_, di) => {
        const col = columnLetter(di + 4);
        return `=COUNTIF(${col}$${filterStart1}:${col}$${filterEnd1},"${pNameEsc}")`;
      })]);
      rows.push(["過不足", "", "", ...Array.from({ length: daysInMonth }, (_, di) => {
        const col = columnLetter(di + 4);
        return `=IF(${col}${reqRow1}="","—",${col}${cntRow1}-${col}${reqRow1})`;
      })]);
    });
    return rows;
  };

  // 管理者パターン → 管理者入力行のみ参照
  const adminConfirmRows = buildConfirmRows(
    adminPatterns, adminConfirmBlockStarts, adminSlotCounts, iAdminStart1, iAdminEnd1,
  );
  // スタッフ/全員パターン → 全入力行を参照（"all" は管理者も含む）
  const staffConfirmRows = buildConfirmRows(
    staffPatterns, staffConfirmBlockStarts, staffSlotCounts, iStart1, iEnd1,
  );

  // ── 入力ビューセクション ──────────────────────────────
  // 列構成: A=会社名、B=スタッフ名、C〜=シフトパターン（ドロップダウン）
  // 承認済み希望休のルックアップマップ: staffId → Set<"YYYY-MM-DD">
  const holidayMap = new Map<string, Set<string>>();
  for (const h of approvedHolidays) {
    if (!holidayMap.has(h.staffId)) holidayMap.set(h.staffId, new Set());
    holidayMap.get(h.staffId)!.add(h.requestDate);
  }

  // 希望休セル位置を収集（背景色適用用）: [rowIndex, colIndex] (0-indexed)
  const holidayCells: { r: number; c: number }[] = [];

  // ── 仮組：日ごとに空きスタッフをシフトパターンへ割り当て ──────────
  // dayAssignments[di] = Map<orderedMembersIndex, patternName>
  const dayAssignments: Map<number, string>[] = [];
  if (draftAssign) {
    for (let di = 0; di < daysInMonth; di++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(di + 1).padStart(2, "0")}`;
      const available: number[] = [];
      for (let mi = 0; mi < orderedMembers.length; mi++) {
        if (!(holidayMap.get(orderedMembers[mi].id) ?? new Set()).has(dateStr)) {
          available.push(mi);
        }
      }
      const offset = di % Math.max(1, available.length);
      const rotated = [...available.slice(offset), ...available.slice(0, offset)];

      const dayMap = new Map<number, string>();
      for (const p of shiftPatterns) {
        const count      = Math.max(0, p.required_count ?? 0);
        const targetRole = p.target_role ?? "all";
        const eligible = rotated.filter(mi => {
          const r = orderedMembers[mi].role ?? "staff";
          if (targetRole === "admin")  return r === "project_admin";
          if (targetRole === "staff")  return r !== "project_admin";
          return true;
        });
        let filled = 0;
        for (const mi of eligible) {
          if (filled >= count) break;
          if (!dayMap.has(mi)) { dayMap.set(mi, p.name); filled++; }
        }
      }
      dayAssignments.push(dayMap);
    }
  }

  // 管理者行・スタッフ行を生成（orderedMembers 順で処理）
  const makeInputRows = (subset: typeof members, startRow: number, indexOffset: number) =>
    subset.map((m, si) => {
      const mi = indexOffset + si; // orderedMembers 内インデックス（仮組用）
      const holidays = holidayMap.get(m.id) ?? new Set<string>();
      return [
        m.id,
        (m.companyName ?? "").trim(),
        (m.displayName ?? "").trim() || m.id,
        ...Array.from({ length: daysInMonth }, (_, di) => {
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(di + 1).padStart(2, "0")}`;
          if (holidays.has(dateStr)) {
            holidayCells.push({ r: startRow + si, c: di + 3 });
            return "公休";
          }
          if (draftAssign) return dayAssignments[di]?.get(mi) ?? "";
          return "";
        }),
      ];
    });

  const adminRows     = makeInputRows(adminMembers, rI0, 0);
  const staffDataRows = makeInputRows(staffOnlyMembers, rStaff0, M_admin);

  // 区切り行（管理者↔スタッフ）：A列にラベル
  const GS_MID = { red:0.827, green:0.827, blue:0.827 }; // 区切りグレー
  const midSepRow = ["スタッフ", "", "", ...Array<string>(daysInMonth).fill("")];

  // 月ごとにタブを分ける: "2026年5月シフト表" など
  const sheetName = `${year}年${month}月シフト表`;

  // シートが無ければ自動作成
  const { sheetId, conditionalFormatRuleCount } =
    await ensureSheetExists(spreadsheetId, sheetName);

  // 確認ビュー内 管理者↔スタッフ区切り行（hasConfirmSplit のときのみ）
  const confirmMidSepRow = hasConfirmSplit
    ? [["スタッフ用", "", "", ...Array<string>(daysInMonth).fill("")]]
    : [];

  await writeSheet(spreadsheetId, sheetName, [
    ["確認ビュー（自動反映）", "", "", ...dateCells],
    ...adminConfirmRows,
    ...confirmMidSepRow,
    ...staffConfirmRows,
    [""],
    ["社員ID", "会社名", "スタッフ名", ...dateCells],
    ...adminRows,
    ...(hasBothRoles ? [midSepRow] : []),
    ...staffDataRows,
  ]);
  const token     = await getAccessToken();
  const totalCols = daysInMonth + 3; // A=ラベル、B=サブラベル、C=スタッフ名、D〜=日付

  // 0-indexed ヘルパー（管理者パターン）
  const rASlotStart = (i: number) => adminConfirmBlockStarts[i];
  const rASlotEnd   = (i: number) => adminConfirmBlockStarts[i] + adminSlotCounts[i] - 1;
  const rAReq  = (i: number) => adminConfirmBlockStarts[i] + adminSlotCounts[i];
  const rACnt  = (i: number) => adminConfirmBlockStarts[i] + adminSlotCounts[i] + 1;
  const rALac  = (i: number) => adminConfirmBlockStarts[i] + adminSlotCounts[i] + 2;

  // 0-indexed ヘルパー（スタッフ/全員パターン）
  const rSSlotStart = (i: number) => staffConfirmBlockStarts[i];
  const rSSlotEnd   = (i: number) => staffConfirmBlockStarts[i] + staffSlotCounts[i] - 1;
  const rSReq  = (i: number) => staffConfirmBlockStarts[i] + staffSlotCounts[i];
  const rSCnt  = (i: number) => staffConfirmBlockStarts[i] + staffSlotCounts[i] + 1;
  const rSLac  = (i: number) => staffConfirmBlockStarts[i] + staffSlotCounts[i] + 2;

  // パターン別カラーパレット（確認ビュー枠行）
  const SLOT_PALETTE = [
    { a: { red:0.729, green:0.808, blue:0.961 }, d: { red:0.878, green:0.914, blue:0.980 } }, // 青
    { a: { red:0.784, green:0.914, blue:0.800 }, d: { red:0.922, green:0.965, blue:0.929 } }, // 緑
    { a: { red:0.988, green:0.894, blue:0.784 }, d: { red:0.996, green:0.949, blue:0.910 } }, // オレンジ
    { a: { red:0.910, green:0.784, blue:0.961 }, d: { red:0.953, green:0.910, blue:0.980 } }, // 紫
    { a: { red:0.961, green:0.808, blue:0.808 }, d: { red:0.980, green:0.906, blue:0.906 } }, // 赤
    { a: { red:0.784, green:0.941, blue:0.933 }, d: { red:0.910, green:0.973, blue:0.969 } }, // シアン
    { a: { red:0.996, green:0.949, blue:0.784 }, d: { red:0.996, green:0.980, blue:0.902 } }, // 黄
    { a: { red:0.851, green:0.851, blue:0.851 }, d: { red:0.937, green:0.937, blue:0.937 } }, // グレー
  ];

  // カラー定数
  const W    = { red:1,     green:1,     blue:1     };
  const BH   = { red:0.114, green:0.337, blue:0.827 }; // 確認ヘッダー（青）
  const BREQ = { red:0.918, green:0.933, blue:0.973 }; // 必要行
  const BCNT = { red:0.918, green:0.933, blue:0.973 }; // 充足行
  const BLAC = { red:0.918, green:0.933, blue:0.973 }; // 過不足行（CF上書き）
  const IH   = { red:0.082, green:0.502, blue:0.239 }; // 入力ヘッダー（緑）
  const IA   = { red:0.851, green:0.918, blue:0.855 }; // 入力A列（スタッフ名）
  const GS   = { red:0.902, green:0.902, blue:0.902 }; // 区切り

  const DATE_FMT = { type: "DATE", pattern: "M/D(aaa)" };

  const rpt = (r0: number, r1: number, c0: number, c1: number, fmt: object) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: r0, endRowIndex: r1 + 1, startColumnIndex: c0, endColumnIndex: c1 + 1 },
      cell: { userEnteredFormat: fmt },
      fields: "userEnteredFormat",
    },
  });

  const requests: object[] = [
    // 既存CF・書式・バリデーションをクリア
    ...Array.from({ length: conditionalFormatRuleCount }, (_, i) => ({
      deleteConditionalFormatRule: { sheetId, index: conditionalFormatRuleCount - 1 - i },
    })),
    {
      setDataValidation: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 200 },
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 200 },
        cell: { userEnteredFormat: {} },
        fields: "userEnteredFormat",
      },
    },

    // ── 確認ビュー ヘッダー ──────────────────────────────
    rpt(rCH, rCH, 0, 2, {  // A・B・C列
      backgroundColor: BH, textFormat: { bold: true, foregroundColor: W, fontSize: 10 },
      horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
    }),
    rpt(rCH, rCH, 3, totalCols - 1, {  // D〜列（日付）
      backgroundColor: BH, textFormat: { bold: true, foregroundColor: W, fontSize: 10 },
      horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", numberFormat: DATE_FMT,
    }),
  ];

  // ── 確認ビュー 各パターン書式（管理者） ────────────────────
  adminPatterns.forEach((_, i) => {
    const palette = SLOT_PALETTE[i % SLOT_PALETTE.length];
    requests.push(
      rpt(rASlotStart(i), rASlotEnd(i), 0, 0, {
        backgroundColor: palette.a, textFormat: { bold: true, fontSize: 10 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rASlotStart(i), rASlotEnd(i), 1, 2, {
        backgroundColor: palette.a, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rASlotStart(i), rASlotEnd(i), 3, totalCols - 1, {
        backgroundColor: { red:0.878, green:0.878, blue:0.878 },
        textFormat: { fontSize: 9, foregroundColor: { red:0.5, green:0.5, blue:0.5 } },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rAReq(i), rAReq(i), 0, 2, {
        backgroundColor: BREQ, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rAReq(i), rAReq(i), 3, totalCols - 1, {
        backgroundColor: BREQ, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rACnt(i), rACnt(i), 0, 2, {
        backgroundColor: BCNT, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rACnt(i), rACnt(i), 3, totalCols - 1, {
        backgroundColor: BCNT, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rALac(i), rALac(i), 0, 2, {
        backgroundColor: BLAC, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rALac(i), rALac(i), 3, totalCols - 1, {
        backgroundColor: BLAC, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
    );
  });

  // 確認ビュー内 管理者↔スタッフ区切り行の書式
  if (hasConfirmSplit) {
    requests.push(
      rpt(rConfirmMidSep, rConfirmMidSep, 0, totalCols - 1, {
        backgroundColor: { red:0.224, green:0.490, blue:0.224 },
        textFormat: { bold: true, fontSize: 9, foregroundColor: W },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
    );
  }

  // ── 確認ビュー 各パターン書式（スタッフ/全員） ───────────────
  staffPatterns.forEach((_, i) => {
    const palette = SLOT_PALETTE[i % SLOT_PALETTE.length];
    requests.push(
      rpt(rSSlotStart(i), rSSlotEnd(i), 0, 0, {
        backgroundColor: palette.a, textFormat: { bold: true, fontSize: 10 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSSlotStart(i), rSSlotEnd(i), 1, 2, {
        backgroundColor: palette.a, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSSlotStart(i), rSSlotEnd(i), 3, totalCols - 1, {
        backgroundColor: { red:0.878, green:0.878, blue:0.878 },
        textFormat: { fontSize: 9, foregroundColor: { red:0.5, green:0.5, blue:0.5 } },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSReq(i), rSReq(i), 0, 2, {
        backgroundColor: BREQ, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSReq(i), rSReq(i), 3, totalCols - 1, {
        backgroundColor: BREQ, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSCnt(i), rSCnt(i), 0, 2, {
        backgroundColor: BCNT, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSCnt(i), rSCnt(i), 3, totalCols - 1, {
        backgroundColor: BCNT, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSLac(i), rSLac(i), 0, 2, {
        backgroundColor: BLAC, textFormat: { bold: true, fontSize: 8 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rSLac(i), rSLac(i), 3, totalCols - 1, {
        backgroundColor: BLAC, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
    );
  });

  requests.push(
    // ── 区切り行 ──────────────────────────────────────────
    rpt(rSep, rSep, 0, totalCols - 1, { backgroundColor: GS }),

    // ── 入力ビュー ヘッダー ──────────────────────────────
    rpt(rIH, rIH, 0, 2, {
      backgroundColor: IH, textFormat: { bold: true, foregroundColor: W, fontSize: 10 },
      horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
    }),
    rpt(rIH, rIH, 3, totalCols - 1, {
      backgroundColor: IH, textFormat: { bold: true, foregroundColor: W, fontSize: 10 },
      horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", numberFormat: DATE_FMT,
    }),

    // ── 入力ビュー A列（社員ID）・B列（会社名）・C列（スタッフ名）────────
    // 管理者セクション（薄紫）
    ...(M_admin > 0 ? [
      rpt(rI0, rAdminEnd, 0, 1, {
        backgroundColor: { red:0.878, green:0.855, blue:0.961 },
        textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rI0, rAdminEnd, 2, 2, {
        backgroundColor: { red:0.878, green:0.855, blue:0.961 },
        textFormat: { bold: true, fontSize: 10 },
        horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE",
      }),
    ] : []),
    // 区切り行（管理者↔スタッフ）
    ...(hasBothRoles ? [
      rpt(rMidSep, rMidSep, 0, totalCols - 1, {
        backgroundColor: GS_MID,
        textFormat: { bold: true, fontSize: 9, foregroundColor: { red:0.3, green:0.3, blue:0.3 } },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
    ] : []),
    // スタッフセクション（薄緑）
    ...(M_staff > 0 ? [
      rpt(rStaff0, rI1, 0, 1, {
        backgroundColor: IA, textFormat: { fontSize: 9 },
        horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE",
      }),
      rpt(rStaff0, rI1, 2, 2, {
        backgroundColor: IA, textFormat: { bold: true, fontSize: 10 },
        horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE",
      }),
    ] : []),

    // ── 列幅 ──────────────────────────────────────────────
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1        }, properties: { pixelSize: 80  }, fields: "pixelSize" } }, // A: 社員ID/パターン名
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2        }, properties: { pixelSize: 100 }, fields: "pixelSize" } }, // B: 会社名/時間帯
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3        }, properties: { pixelSize: 110 }, fields: "pixelSize" } }, // C: スタッフ名
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: totalCols }, properties: { pixelSize: 68  }, fields: "pixelSize" } }, // D〜: 日付

    // ── 行高さ ────────────────────────────────────────────
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rCH, endIndex: rCH + 1 }, properties: { pixelSize: 32 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rIH, endIndex: rIH + 1 }, properties: { pixelSize: 32 }, fields: "pixelSize" } },
    ...(M_admin > 0 ? [{ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rI0,     endIndex: rAdminEnd + 1 }, properties: { pixelSize: 28 }, fields: "pixelSize" } }] : []),
    ...(hasBothRoles  ? [{ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rMidSep, endIndex: rMidSep + 1  }, properties: { pixelSize: 22 }, fields: "pixelSize" } }] : []),
    ...(M_staff > 0  ? [{ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rStaff0, endIndex: rI1 + 1      }, properties: { pixelSize: 28 }, fields: "pixelSize" } }] : []),

    // ── 承認済み希望休セル（ピンク背景＋太字）──────────────
    ...holidayCells.map(({ r, c }) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.988, green: 0.855, blue: 0.902 }, // ピンク
            textFormat: { bold: true, foregroundColor: { red: 0.65, green: 0.10, blue: 0.35 } },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat",
      },
    })),

    // ── 入力ビュー（C列以降）にシフトパターンのドロップダウン（区切り行は除く）
    ...[
      ...(M_admin > 0 ? [{ startRowIndex: rI0,     endRowIndex: rAdminEnd + 1 }] : []),
      ...(M_staff > 0 ? [{ startRowIndex: rStaff0, endRowIndex: rI1 + 1       }] : []),
    ].map(range => ({
      setDataValidation: {
        range: { sheetId, ...range, startColumnIndex: 3, endColumnIndex: totalCols },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [
              { userEnteredValue: "" },
              ...shiftPatterns.map(p => ({ userEnteredValue: p.name })),
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    })),

    // ── A・B列と確認ヘッダー行を固定 ─────────────────────
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenColumnCount: 3, frozenRowCount: 1 },
        },
        fields: "gridProperties.frozenColumnCount,gridProperties.frozenRowCount",
      },
    },
  );

  // CFルール生成ヘルパー
  const cfRule = (ranges: object[], formula: string, bg: object, fg: object) => ({
    addConditionalFormatRule: {
      rule: {
        ranges,
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
          format: { backgroundColor: bg, textFormat: { foregroundColor: fg, bold: true } },
        },
      },
      index: 0,
    },
  });

  // パターングループごとに行高さ + CF を設定する共通ロジック
  const applyPatternRowsAndCF = (
    patterns: typeof shiftPatterns,
    blockStarts: number[],
    slotCounts: number[],
    rSlotStartFn: (i: number) => number,
    rSlotEndFn:   (i: number) => number,
    rReqFn:  (i: number) => number,
    rCntFn:  (i: number) => number,
    rLacFn:  (i: number) => number,
    countifStart1: number,
    countifEnd1:   number,
  ) => {
    patterns.forEach((_, i) => {
      const nameRow1 = blockStarts[i] + 1;
      const reqRow1  = blockStarts[i] + slotCounts[i] + 1;
      const cntRow1  = blockStarts[i] + slotCounts[i] + 2;

      requests.push(
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rSlotStartFn(i), endIndex: rSlotEndFn(i) + 1 }, properties: { pixelSize: 36 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rReqFn(i),       endIndex: rReqFn(i) + 1      }, properties: { pixelSize: 20 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rCntFn(i),       endIndex: rCntFn(i) + 1      }, properties: { pixelSize: 20 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rLacFn(i),       endIndex: rLacFn(i) + 1      }, properties: { pixelSize: 20 }, fields: "pixelSize" } },
      );

      const reqCell = (col: string) => `${col}${reqRow1}`;
      const cntCell = (col: string) => `${col}${cntRow1}`;
      const cntFml  = (col: string) =>
        `COUNTIF(${col}$${countifStart1}:${col}$${countifEnd1},$A$${nameRow1})`;

      const cntRange = { sheetId, startRowIndex: rCntFn(i), endRowIndex: rCntFn(i) + 1, startColumnIndex: 3, endColumnIndex: totalCols };
      const lacRange = { sheetId, startRowIndex: rLacFn(i), endRowIndex: rLacFn(i) + 1, startColumnIndex: 3, endColumnIndex: totalCols };

      const slotRange = {
        sheetId,
        startRowIndex:    rSlotStartFn(i),
        endRowIndex:      rSlotEndFn(i) + 1,
        startColumnIndex: 3,
        endColumnIndex:   totalCols,
      };

      const slotPalette = SLOT_PALETTE[i % SLOT_PALETTE.length];
      const reqRow1s  = rReqFn(i) + 1;
      const slotRow1s = rSlotStartFn(i) + 1;

      requests.push(
        cfRule([slotRange],
          `=AND(LEN(D${slotRow1s})=0,D$${reqRow1s}<>"",D$${reqRow1s}<(ROW()-${rSlotStartFn(i)}))`,
          { red:0.38, green:0.38, blue:0.38 }, { red:0.65, green:0.65, blue:0.65 }),
        cfRule([slotRange],
          `=LEN(D${slotRow1s})>0`,
          slotPalette.d, { red:0.1, green:0.1, blue:0.1 }),

        cfRule([cntRange],
          `=AND(${reqCell("D")}<>"",${cntFml("D")}>=${reqCell("D")})`,
          { red:0.71, green:0.96, blue:0.71 }, { red:0.06, green:0.38, blue:0.06 }),
        cfRule([cntRange],
          `=AND(${reqCell("D")}<>"",${cntFml("D")}<${reqCell("D")})`,
          { red:1.0,  green:0.80, blue:0.80 }, { red:0.72, green:0.07, blue:0.07 }),
        cfRule([lacRange],
          `=AND(${reqCell("D")}<>"",${cntCell("D")}-${reqCell("D")}=0)`,
          { red:0.71, green:0.96, blue:0.71 }, { red:0.06, green:0.38, blue:0.06 }),
        cfRule([lacRange],
          `=AND(${reqCell("D")}<>"",${cntCell("D")}-${reqCell("D")}>0)`,
          { red:1.0,  green:0.95, blue:0.60 }, { red:0.60, green:0.40, blue:0.00 }),
        cfRule([lacRange],
          `=AND(${reqCell("D")}<>"",${cntCell("D")}-${reqCell("D")}<0)`,
          { red:1.0,  green:0.80, blue:0.80 }, { red:0.72, green:0.07, blue:0.07 }),
      );
    });
  };

  // ── 確認ビュー 各パターン：行高さ＋条件付き書式 ─────────
  // 管理者パターン（COUNTIF は管理者入力行のみ）
  applyPatternRowsAndCF(
    adminPatterns, adminConfirmBlockStarts, adminSlotCounts,
    rASlotStart, rASlotEnd, rAReq, rACnt, rALac,
    iAdminStart1, iAdminEnd1,
  );
  // スタッフ/全員パターン（COUNTIF は全入力行）
  applyPatternRowsAndCF(
    staffPatterns, staffConfirmBlockStarts, staffSlotCounts,
    rSSlotStart, rSSlotEnd, rSReq, rSCnt, rSLac,
    iStart1, iEnd1,
  );

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
}

/**
 * 希望休シートをプロジェクトの申請データで上書き同期する
 * シフト表生成時に呼び出す
 */
export async function syncHolidaySheet(
  spreadsheetId: string,
  holidays: { staffId: string; staffName: string; requestDate: string; note: string | null }[]
): Promise<void> {
  const header = SHEET_HEADERS["希望休"]; // ["社員ID", "氏名", "希望日", "備考"]
  const rows = holidays
    .sort((a, b) => a.requestDate.localeCompare(b.requestDate))
    .map((h) => [h.staffId, h.staffName, h.requestDate, h.note ?? ""]);
  await writeSheet(spreadsheetId, "希望休", [header, ...rows]);
}

/**
 * シフトパターンシートを現在の設定で上書き同期する
 */
export async function syncShiftPatternsSheet(
  spreadsheetId: string,
  patterns: {
    name: string;
    short_name: string;
    start_time: string | null;
    end_time: string | null;
    required_count: number | null;
    target_role: string;
  }[]
): Promise<void> {
  const header = SHEET_HEADERS["シフトパターン"];
  const TARGET_LABEL: Record<string, string> = { all: "全員", staff: "スタッフのみ", admin: "管理者のみ" };
  const rows = patterns.map(p => [
    p.name,
    p.short_name,
    p.start_time  ?? "",
    p.end_time    ?? "",
    p.required_count != null ? String(p.required_count) : "",
    TARGET_LABEL[p.target_role] ?? p.target_role,
  ]);
  await writeSheet(spreadsheetId, "シフトパターン", [header, ...rows]);
}

/**
 * 希望休ルールシートを現在の設定で上書き同期する
 */
export async function syncHolidayRulesSheet(
  spreadsheetId: string,
  rules: { rule_type: string; label: string; value: number; unit: string }[]
): Promise<void> {
  const header = SHEET_HEADERS["希望休ルール"];
  const rows = rules.map(r => [r.label, String(r.value), r.unit]);
  await writeSheet(spreadsheetId, "希望休ルール", [header, ...rows]);
}

/** Google Sheets APIが使用可能か確認 */
export function isGSheetsConfigured(): boolean {
  const hasOAuth = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
  return hasOAuth || !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

// 各シートの初期ヘッダー（シフト表は月ごとに動的生成するためここには含まない）
const SHEET_HEADERS: Record<string, string[]> = {
  設定:           ["設定項目", "値"],
  メンバー:       ["社員ID", "所属会社", "氏名", "役割", "週稼働日数", "シフト希望", "LINEID"],
  希望休:         ["社員ID", "氏名", "希望日", "備考"],
  希望休ルール:   ["ルール", "値", "単位"],
  シフトパターン: ["パターン名", "略称", "開始時刻", "終了時刻", "必要人数", "対象"],
  打刻ログ:       ["社員ID", "氏名", "日時", "種別", "区分", "承認者"],
  日別勤怠:       ["社員ID", "所属会社", "氏名", "日付", "出勤", "退勤", "休憩(分)", "実働", "残業", "深夜", "深夜残業"],
  月次集計:       ["社員ID", "所属会社", "氏名", "勤務予定日", "稼働日数", "実働時間", "残業時間", "深夜時間", "深夜残業時間", "欠勤", "遅刻", "早退", "遵守率"],
  シフト変更ログ: ["変更日時", "変更者", "操作", "対象社員ID", "対象氏名", "対象日", "変更前", "変更後"],
  欠勤報告:       ["報告日時", "社員ID", "氏名", "欠勤日", "理由", "翌日出勤", "翌々日出勤"],
};

// メンバーシートの説明行・サンプル行
const MEMBER_DESCRIPTION_ROW = [
  "案件名頭文字ローマ字3文字＋数字3桁 例：ABC001",
  "所属する会社・組織名",
  "氏名（フルネーム）",
  "staff または project_admin",
  "1週間あたりの稼働日数（デフォルト5）",
  "備考・メモ",
];
const MEMBER_SAMPLE_ROW = ["ABC001", "株式会社○○", "田中 太郎", "staff", "5", ""];

// 設定シートのデフォルト値
const DEFAULT_SETTINGS = [
  ["欠勤通知_LINE",    "ON"],
  ["遅刻通知_LINE",    "ON"],
  ["打刻通知_LINE",    "OFF"],
  ["お知らせ通知_LINE", "ON"],
  ["希望休_申請期限日", "20"],
  ["希望休_上限日数",   "3"],
];

/**
 * プロジェクト用スプレッドシートを新規作成
 * 9シートを自動でセットアップしてURLを返す
 */
export async function createSpreadsheet(projectName: string): Promise<string> {
  const token = await getAccessToken();

  const sheetNames = Object.keys(SHEET_HEADERS);

  // スプレッドシート作成
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title: `${projectName} [RAQ Portal]` },
      sheets: sheetNames.map((title, index) => ({
        properties: { title, index },
      })),
    }),
  });

  if (!createRes.ok) {
    const err = (await createRes.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "スプレッドシートの作成に失敗しました");
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };

  const spreadsheetId = created.spreadsheetId;

  // 各シートにヘッダーと初期データを書き込む
  const valueRanges = sheetNames.map((name) => {
    const headerRow = SHEET_HEADERS[name];
    const extraRows =
      name === "設定" ? DEFAULT_SETTINGS :
      name === "メンバー" ? [MEMBER_DESCRIPTION_ROW, MEMBER_SAMPLE_ROW] :
      [];
    return {
      range: `${name}!A1`,
      majorDimension: "ROWS",
      values: [headerRow, ...extraRows],
    };
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: valueRanges,
      }),
    }
  );

  return created.spreadsheetUrl;
}
