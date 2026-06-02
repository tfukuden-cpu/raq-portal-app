/**
 * LINE Messaging API + LINE Login ユーティリティ
 */

const LINE_API = "https://api.line.me";
const LINE_LOGIN = "https://access.line.me";

// ── LINE Login ────────────────────────────────────────────

/** LINE OAuthの認可URLを生成 */
export function getLineAuthUrl(state: string): string {
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     process.env.LINE_LOGIN_CHANNEL_ID!,
    redirect_uri:  redirectUri,
    state,
    scope:         "profile openid",
    bot_prompt:    "aggressive",
  });
  return `${LINE_LOGIN}/oauth2/v2.1/authorize?${params}`;
}

/** OAuthコードをアクセストークンに交換してプロフィールを返す */
export async function fetchLineProfile(
  code: string
): Promise<{ userId: string; displayName: string; pictureUrl?: string; accessToken: string } | null> {
  const redirectUri = getRedirectUri();

  // トークン取得
  const tokenRes = await fetch(`${LINE_API}/oauth2/v2.1/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri,
      client_id:     process.env.LINE_LOGIN_CHANNEL_ID!,
      client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET!,
    }),
  });
  if (!tokenRes.ok) {
    console.error("LINE token error:", await tokenRes.text());
    return null;
  }
  const { access_token } = await tokenRes.json();

  // プロフィール取得
  const profileRes = await fetch(`${LINE_API}/v2/profile`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) return null;
  const p = await profileRes.json();

  return { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl, accessToken: access_token };
}

/** 公式アカウントを友達追加しているか確認 */
export async function checkLineFriendship(accessToken: string): Promise<boolean> {
  const res = await fetch(`${LINE_API}/friendship/v1/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return false;
  const { friendFlag } = await res.json();
  return friendFlag === true;
}

function getRedirectUri() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  return `${base}/api/auth/line/callback`;
}

// ── LINE Messaging API ────────────────────────────────────

/** 1人にテキストメッセージを送る */
export async function pushLine(lineUserId: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) { console.error("[LINE] LINE_CHANNEL_ACCESS_TOKEN が未設定"); return; }
  if (!lineUserId) { console.error("[LINE] lineUserId が空"); return; }

  const res = await fetch(`${LINE_API}/v2/bot/message/push`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify({
      to:       lineUserId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[LINE] pushLine failed: ${res.status} ${res.statusText} — userId=${lineUserId} — ${body}`);
  }
}

/**
 * ボタン付きFlexメッセージを1人に送る（通知テスト用）
 * スタッフがボタンを押すと postback data="line_test_confirm:<projectId>" が届く
 */
/** 戻り値: true=送信成功 / false=送信失敗 */
export async function pushLineTestButton(
  lineUserId: string,
  staffName: string,
  projectId: string,
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) { console.error("[LINE] LINE_CHANNEL_ACCESS_TOKEN が未設定"); return false; }
  if (!lineUserId) { console.error("[LINE] lineUserId が空"); return false; }

  const res = await fetch(`${LINE_API}/v2/bot/message/push`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{
        type: "flex",
        altText: "【通知テスト】受信確認",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "通知テスト", weight: "bold", size: "lg", color: "#111827" },
              { type: "text", text: `${staffName}さん、LINE通知の受信確認です。受信できていれば下のボタンを押してください。`, wrap: true, size: "sm", color: "#6b7280", margin: "sm" },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [{
              type: "button",
              action: {
                type: "postback",
                label: "✓ 受信確認",
                data: `line_test_confirm:${projectId}`,
                displayText: "受信確認しました ✓",
              },
              style: "primary",
              color: "#10b981",
              height: "sm",
            }],
          },
        },
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[LINE] pushLineTestButton failed: ${res.status} ${res.statusText} — userId=${lineUserId} — ${body}`);
    return false;
  }
  return true;
}

/**
 * テキスト本文 ＋ URIボタン付きFlexメッセージを1人に送る
 * テキストは改行対応、ボタンはURLを開く
 */
export async function pushLineWithButton(
  lineUserId: string,
  text: string,
  buttonLabel: string,
  buttonUrl: string,
  buttonColor: string = "#2563eb",
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) { console.error("[LINE] LINE_CHANNEL_ACCESS_TOKEN が未設定"); return; }
  if (!lineUserId) { console.error("[LINE] lineUserId が空"); return; }

  // テキスト全文＋ボタンを1つのFlex Messageで送信
  const res = await fetch(`${LINE_API}/v2/bot/message/push`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{
        type: "flex",
        altText: text.split("\n")[0].slice(0, 60),
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            paddingAll: "lg",
            contents: [
              {
                type: "text",
                text,
                wrap: true,
                size: "sm",
                color: "#1f2937",
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "md",
            contents: [{
              type: "button",
              action: {
                type: "uri",
                label: buttonLabel,
                uri: buttonUrl,
              },
              style: "primary",
              color: buttonColor,
              height: "sm",
            }],
          },
        },
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[LINE] pushLineWithButton failed: ${res.status} ${res.statusText} — userId=${lineUserId} — ${body}`);
  }
}

/** 複数人に同じメッセージをマルチキャスト（最大500人） */
export async function multicastLine(lineUserIds: string[], text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) { console.error("[LINE] LINE_CHANNEL_ACCESS_TOKEN が未設定"); return; }
  if (lineUserIds.length === 0) return;

  // 500件ずつ分割
  for (let i = 0; i < lineUserIds.length; i += 500) {
    const chunk = lineUserIds.slice(i, i + 500);
    const res = await fetch(`${LINE_API}/v2/bot/message/multicast`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify({
        to:       chunk,
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[LINE] multicastLine failed: ${res.status} ${res.statusText} — ${body}`);
    }
  }
}
