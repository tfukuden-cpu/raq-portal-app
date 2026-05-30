"use client";

/**
 * ポータルレイアウトに挿入するプッシュ通知自動登録コンポーネント。
 * - 通知許可が「未設定」→ 許可ダイアログを表示してから購読
 * - 通知許可が「許可済み」→ 既存購読が現在の VAPID キーと一致しているか確認し、
 *   古い購読（キー変更後など）があれば再購読してサーバーに保存する
 * UI は表示しない（副作用のみ）。
 */

import { useEffect } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeAndSave(vapidKey: string) {
  const reg = await navigator.serviceWorker.ready;

  // 既存購読を取得して VAPID キーが一致しているか確認
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // applicationServerKey を base64 に変換して比較
    const existingKey = existing.options.applicationServerKey;
    if (existingKey) {
      const existingKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(existingKey as ArrayBuffer))
      ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const newKeyRaw = btoa(
        String.fromCharCode(...urlBase64ToUint8Array(vapidKey))
      ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      if (existingKeyBase64 === newKeyRaw) return; // 同じキーなら何もしない
    }
    // キーが違う → 古い購読を解除してから再登録
    await existing.unsubscribe();
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as any,
  });

  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint:  sub.endpoint,
      keys:      json.keys,
      userAgent: navigator.userAgent,
    }),
  });
}

export default function PushPermissionRequest() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;

    const perm = Notification.permission;

    if (perm === "denied") return;

    // 少し遅らせてページが落ち着いてから実行
    const timer = setTimeout(async () => {
      try {
        if (perm === "default") {
          // 未設定 → 許可ダイアログを表示
          const granted = await Notification.requestPermission();
          if (granted !== "granted") return;
        }
        // 許可済み or 今許可された → 購読を確認・登録
        await subscribeAndSave(vapidKey);
      } catch (e) {
        console.warn("[push] auto-subscribe failed:", e);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
