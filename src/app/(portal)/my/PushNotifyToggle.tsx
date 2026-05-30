"use client";

import { useEffect, useState, useCallback } from "react";

type State = "unsupported" | "loading" | "denied" | "off" | "on";

/** VAPID 公開鍵（Base64url → Uint8Array） */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready.catch(() => null);
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

async function subscribe(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return null;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as any,
  });
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
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

async function removeSubscription(sub: PushSubscription): Promise<void> {
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

export default function PushNotifyToggle() {
  const [state, setState] = useState<State>("loading");

  const checkState = useCallback(async () => {
    if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    const permission = Notification.permission;
    if (permission === "denied") {
      setState("denied");
      return;
    }
    const sub = await getCurrentSubscription();
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => { checkState(); }, [checkState]);

  const handleToggle = async () => {
    setState("loading");
    try {
      if (state === "on") {
        // オフにする
        const sub = await getCurrentSubscription();
        if (sub) await removeSubscription(sub);
        setState("off");
      } else {
        // オンにする（許可ダイアログ）
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const sub = await subscribe();
        if (sub) {
          await saveSubscription(sub);
          setState("on");
        } else {
          setState("off");
        }
      }
    } catch (e) {
      console.error("[push] toggle error:", e);
      await checkState();
    }
  };

  if (state === "unsupported") return null;

  return (
    <div className="px-5 py-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          プッシュ通知
        </p>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          {state === "denied"
            ? "ブラウザの設定から通知を許可してください"
            : state === "on"
            ? "この端末に通知が届きます"
            : "LINEと同じ内容がこの端末に届きます"}
        </p>
      </div>

      {state === "denied" ? (
        <span className="text-xs text-zinc-400">ブロック中</span>
      ) : (
        <button
          type="button"
          onClick={handleToggle}
          disabled={state === "loading"}
          aria-label="プッシュ通知のオン/オフ"
          className={[
            "relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0",
            state === "loading"
              ? "bg-zinc-200 dark:bg-zinc-700 cursor-wait"
              : state === "on"
              ? "bg-blue-600"
              : "bg-zinc-200 dark:bg-zinc-700",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200",
              state === "on" ? "translate-x-5" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      )}
    </div>
  );
}
