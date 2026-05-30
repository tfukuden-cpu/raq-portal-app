"use client";

/**
 * ポータルレイアウトに挿入するプッシュ通知自動登録コンポーネント。
 * ページロード後に通知許可が未設定の場合のみ許可リクエストを行い、
 * 許可されたら購読情報をサーバーに保存する。
 * UI は表示しない（副作用のみ）。
 */

import { useEffect } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PushPermissionRequest() {
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      Notification.permission !== "default"
    ) return;

    // 少し遅らせてページが落ち着いてから許可ダイアログを表示
    const timer = setTimeout(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const reg = await navigator.serviceWorker.ready;
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;

        // 既に購読済みならスキップ
        const existing = await reg.pushManager.getSubscription();
        if (existing) return;

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
      } catch (e) {
        console.warn("[push] auto-subscribe failed:", e);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
