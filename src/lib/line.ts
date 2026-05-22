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

/** 1人にテキストメッセージを送る（失敗は握りつぶす） */
export async function pushLine(lineUserId: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineUserId) return;

  await fetch(`${LINE_API}/v2/bot/message/push`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify({
      to:       lineUserId,
      messages: [{ type: "text", text }],
    }),
  }).catch(() => {/* best-effort */});
}

/**
 * ボタン付きFlexメッセージを1人に送る（通知テスト用）
 * スタッフがボタンを押すと postback data="line_test_confirm:<projectId>" が届く
 */
export async function pushLineTestButton(
  lineUserId: string,
  staffName: string,
  projectId: string,
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineUserId) return;

  await fetch(`${LINE_API}/v2/bot/message/push`, {
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
  }).catch(() => {/* best-effort */});
}

/** 複数人に同じメッセージをマルチキャスト（最大500人） */
export async function multicastLine(lineUserIds: string[], text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || lineUserIds.length === 0) return;

  // 500件ずつ分割
  for (let i = 0; i < lineUserIds.length; i += 500) {
    const chunk = lineUserIds.slice(i, i + 500);
    await fetch(`${LINE_API}/v2/bot/message/multicast`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify({
        to:       chunk,
        messages: [{ type: "text", text }],
      }),
    }).catch(() => {});
  }
}
