// js/services/tool-loader.js — 把某個工具模組載進一個容器裡。
//
// 一個工具一個資料夾, 裡面要拆成幾個檔案是那個工具自己的事, 外面只認 index.js。
// 工具模組的介面:
//
//     export const meta = { title: "教室資訊" };                        // 選填
//     export const styles = new URL("./x.css", import.meta.url).href;  // 選填
//     export async function mount(host, ctx) { … }                     // 回傳 cleanup（選填）
//
// ctx 是工具與網址之間唯一的接觸面:
//     ctx.params      進站時的 query（URLSearchParams）, 工具可以拿它還原檢視
//     ctx.setParams()  把檢視寫回網址, 不留瀏覽紀錄
//
// 這樣工具不需要知道自己被掛在哪個路由底下, 頁面也不用管工具存了什麼狀態。

import { escapeHtml } from "../utils/utils.js";

/** id 直接參與模組路徑, 只放行安全字元。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 已經插進 <head> 的工具樣式, 每個網址只載一次。 */
const styleLinks = new Map();

/**
 * 載入某個工具自己的樣式表, 並等它真的下載完 ——
 * 不等的話工具已經掛上去了樣式還沒到, 會先閃一下沒排版的樣子。
 * @returns {Promise<void>}
 */
function ensureStyles(href) {
  if (!href) return Promise.resolve();
  if (styleLinks.has(href)) return styleLinks.get(href);

  const pending = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.toolStyle = "1";
    // 樣式載不到就照樣掛工具 —— 難看總比整個不能用好。
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  styleLinks.set(href, pending);
  return pending;
}

/**
 * 把 id 對應的工具掛到 host 上。
 * @param {HTMLElement} host
 * @param {string} id
 * @param {{params?: URLSearchParams, setParams?: Function}} [ctx]
 * @returns {Promise<Function|null>} cleanup
 */
export async function mountTool(host, id, ctx = {}) {
  if (!host) return null;
  if (!ID_PATTERN.test(String(id || ""))) {
    fail(host, id, "id 只能用小寫英數字與連字號");
    return null;
  }

  host.classList.add("tool-slot", "is-loading");
  try {
    const module = await import(`../tools/${id}/index.js`);
    if (typeof module.mount !== "function") throw new Error("模組沒有 export mount()");
    // 樣式先到位再掛。
    await Promise.all([module.styles].flat().filter(Boolean).map(ensureStyles));
    host.replaceChildren();
    host.classList.remove("is-loading");
    host.dataset.toolReady = "1";
    const cleanup = await module.mount(host, ctx);
    return typeof cleanup === "function" ? cleanup : null;
  } catch (err) {
    console.error(err);
    host.classList.remove("is-loading");
    fail(host, id, err.message);
    return null;
  }
}

function fail(host, id, message) {
  host.classList.add("tool-slot", "is-failed");
  host.innerHTML =
    `<div class="banner banner-danger" role="alert">工具「${escapeHtml(String(id ?? ""))}」載入失敗: ${escapeHtml(message)}</div>`;
}
