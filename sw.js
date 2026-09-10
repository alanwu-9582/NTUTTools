// sw.js — 離線支援。
//
// 策略刻意偏向「拿到最新的」:
//
//   同源的所有東西  → 先走網路, 失敗才用快取
//   圖片            → 先用快取（圖片只會新增, 不會就地改內容）
//   CDN 字型        → 先用快取（網址都鎖了版本）
//
// 如果程式碼也先走快取, 改過的工具或修好的 bug 就要等第二次造訪才看得到。
// 有網路的人一律拿到目前的檔案；快取只是為了完全沒網路的時候。
//
// 改動下面的 SHELL 清單時, 記得把 CACHE_VERSION 往上加一版, 舊快取才會被丟掉。

const CACHE_VERSION = "ntuttools-v5";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, CDN_CACHE]);

/** 預先快取, 讓第一次離線造訪也還能開得起來。 */
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/theme.css",
  "css/layout.css",
  "css/components.css",
  "css/catalog.css",
  "css/tools.css",
  "css/pages.css",
  "js/core/main.js",
  "js/core/router.js",
  "js/core/offline.js",
  "js/services/data-service.js",
  "js/services/tool-loader.js",
  "js/services/data-refresh.js",
  "js/pages/home.js",
  "js/pages/tools.js",
  "js/pages/tool.js",
  "js/pages/not-found.js",
  "js/ui/labels.js",
  "js/ui/modal.js",
  "js/ui/sidebar.js",
  "js/ui/notifications.js",
  "js/ui/tool-card.js",
  "js/utils/utils.js",
  "js/utils/clipboard.js",
  // 工具模組與它們自己的樣式都是動態載入的, 沒先快取起來,
  // 離線時工具會變成錯誤訊息。加新工具時這裡要一起補。
  "js/tools/kit.js",
  "js/tools/svg.js",
  "js/tools/timetable.js",
  "js/tools/timetable.css",
  "js/tools/room-info/index.js",
  "js/tools/room-info/rooms.js",
  "js/tools/room-info/room-info.css",
  "js/tools/class-schedule/index.js",
  "js/tools/class-schedule/classes.js",
  "js/tools/class-schedule/class-schedule.css",
  "js/tools/credit-master/index.js",
  "js/tools/credit-master/curriculum.js",
  "js/tools/credit-master/grades.js",
  "js/tools/credit-master/storage.js",
  "js/tools/credit-master/credit-master.css",
  "pages/home.html",
  "pages/tools.html",
  "pages/tool.html",
  "pages/not-found.html",
  "data/site.json",
  "data/tools.json",
  "data/ntut-rooms.json",
  "data/ntut-classes.json",
  "data/ntut-curriculum.json",
  "data/ntut-courses.json",
  "assets/images/icon.png",
  "assets/icons/alert.svg",
  "assets/icons/book.svg",
  "assets/icons/calendar.svg",
  "assets/icons/check.svg",
  "assets/icons/chevron-left.svg",
  "assets/icons/copy.svg",
  "assets/icons/grid.svg",
  "assets/icons/home.svg",
  "assets/icons/info.svg",
  "assets/icons/menu.svg",
  "assets/icons/search.svg",
  "assets/icons/tool.svg",
  "assets/icons/x.svg",
];

const CDN_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 不讓單一個 404 把整個 install 弄失敗。
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!KEEP.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** 走網路, 順手留一份；網路不通時再拿出來用。 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

/** 優先用快取；沒存過才去打網路。 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // 背景更新, 不讓這次請求等它。
    fetch(request).then((r) => { if (r.ok) cache.put(request, r.clone()); }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 圖片檔案大, 而且都是「新增一張」而不是就地改掉, 快取那份永遠是對的。
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith((async () => {
    const cacheName = url.pathname.includes("/assets/") ? ASSET_CACHE : SHELL_CACHE;
    const response = await networkFirst(request, cacheName);
    // 整個 miss 掉的導覽請求, 至少要落到一個能用的頁面。
    if (response.type === "error" && request.mode === "navigate") {
      const shell = await caches.match("index.html");
      if (shell) return shell;
    }
    return response;
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
