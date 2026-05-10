"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] 登録完了:", reg.scope);

        // 新しい SW が待機中なら即アクティブ化
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // 新バージョンあり → ページリロードで即反映
              window.location.reload();
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[SW] 登録失敗:", err);
      });
  }, []);

  return null;
}
