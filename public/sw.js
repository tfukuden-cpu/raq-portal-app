/**
 * Raq ポータル Service Worker
 *
 * 戦略:
 * - Next.js 静的アセット (_next/static/) → Cache First（永続キャッシュ・URLにハッシュ付きのため安全）
 * - ページ → Network First（オフライン時はキャッシュにフォールバック）
 * - 画像・フォント → Stale While Revalidate（即キャッシュ表示＋裏で更新。同一URLで差し替えても次回反映される）
 *
 * キャッシュ名にバージョンを付けているので、SW 更新時に古いキャッシュを自動削除する。
 * ※ public/ 配下の画像を同一URLのまま差し替えたら CACHE_VERSION を上げること
 */

const CACHE_VERSION = "v4";
const STATIC_CACHE  = `raq-static-${CACHE_VERSION}`;
const PAGES_CACHE   = `raq-pages-${CACHE_VERSION}`;
const KNOWN_CACHES  = [STATIC_CACHE, PAGES_CACHE];

// ── インストール: 基本ページを事前キャッシュ ──
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PAGES_CACHE).then((cache) =>
      cache.addAll(["/dashboard", "/login"]).catch(() => {})
    )
  );
});

// ── アクティベート: 古いキャッシュを削除 ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !KNOWN_CACHES.includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── フェッチ: リクエスト種別に応じた戦略 ──
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 同一オリジンのみ処理（外部APIは素通し）
  if (url.origin !== self.location.origin) return;

  // Next.js 静的アセット: Cache First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 画像・フォント: Stale While Revalidate（キャッシュ即返し＋裏で最新を取得）
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?)$/)
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Supabase API: 素通し（キャッシュしない）
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // サーバーアクション（POST）: 素通し
  if (request.method !== "GET") return;

  // ページ: Network First（オフライン時はキャッシュ）
  event.respondWith(networkFirst(request, PAGES_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const fetchAndUpdate = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await fetchAndUpdate;
  return fresh ?? new Response("Offline", { status: 503 });
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

// ── プッシュ通知受信 ──────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Raq ポータル", body: "", url: "/dashboard", icon: "/icons/icon-192.png" };
  try {
    if (event.data) Object.assign(data, event.data.json());
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  data.icon,
      badge: "/icons/icon-192.png",
      tag:   "raq-notify",
      renotify: true,
      data:  { url: data.url },
    })
  );
});

// ── 通知タップでページを開く ──────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
