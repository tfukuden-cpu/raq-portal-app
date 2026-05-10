"use server";

export async function exchangeCodeAction(fd: FormData): Promise<{
  success: boolean;
  refreshToken?: string;
  message?: string;
}> {
  const code         = String(fd.get("code")         ?? "").trim();
  const clientId     = String(fd.get("clientId")     ?? "").trim();
  const clientSecret = String(fd.get("clientSecret") ?? "").trim();
  const redirectUri  = String(fd.get("redirectUri")  ?? "").trim();

  if (!code || !clientId || !clientSecret) {
    return { success: false, message: "すべての項目を入力してください" };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  const data = (await res.json()) as {
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };

  if (!res.ok || !data.refresh_token) {
    return {
      success: false,
      message: data.error_description ?? data.error ?? "トークンの取得に失敗しました",
    };
  }

  return { success: true, refreshToken: data.refresh_token };
}
