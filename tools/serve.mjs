// tools/serve.mjs — 開發用的靜態伺服器。
//
//   node tools/serve.mjs [port]
//
// 跟 `python -m http.server` 的差別只有一件事: 這支回 `Cache-Control: no-store`。
//
// 這個站台沒有打包步驟, 瀏覽器是直接 import 原始的 .js 與 .css。python 的
// http.server 會送 Last-Modified, 瀏覽器就自己啟發式快取了 —— 改完程式重整, 
// 跑的還是舊的那一份, 而且看起來一切正常, 只是行為沒變。除錯時這會讓人
// 一直懷疑錯的地方。開發時一律不要快取比較省事。

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 8788;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const wanted = decodeURIComponent(url.pathname);

  // 只放行 ROOT 底下的檔案。`..` 一律擋掉。
  const target = path.join(ROOT, wanted.endsWith("/") ? `${wanted}index.html` : wanted);
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let file = target;
  try {
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch {
    // 找不到就交給前端路由的 index.html（這個站是 hash 路由, 理論上用不到）。
    file = path.join(ROOT, "index.html");
  }

  let size;
  try {
    size = statSync(file).size;
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": "no-store, must-revalidate",
  });
  createReadStream(file).pipe(response);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`靜態伺服器（不快取）: http://127.0.0.1:${PORT}`);
});
