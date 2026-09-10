// js/services/data-refresh.js — 重新抓站台上的資料快照, 附進度。
//
// 這裡「最新」的意思是「站台上最新已發佈的快照」, 不是「此刻的學校網站」——
// aps.ntut.edu.tw 沒有回 Access-Control-Allow-Origin, 瀏覽器直接抓一定被擋
// （no-cors 只拿得到 opaque response, body 讀不到）, 所以資料一律在建置階段
// 由 tools/build-*.mjs 抓成快照跟著站台發佈。
//
// 那這顆按鈕在解決什麼: service worker 對同源請求是 network-first, 但每個
// 工具自己還有一層 module 層級的快取（抓過就不再抓）, 而瀏覽器的 HTTP 快取
// 也可能壓著舊的 JSON。重新整理頁面不見得會拿到剛發佈的資料, 這裡用
// cache: "reload" 強制回源, 再把工具的快取清掉重畫。

import { el } from "../utils/utils.js";

/**
 * 抓一個 JSON, 邊抓邊回報進度。
 *
 * 有 content-length 就用讀到的位元組算真實百分比；沒有的話（分塊傳輸）
 * 只能回報 null, 讓進度條改成不確定的樣子 —— 假裝有進度比沒有更糟。
 *
 * @param {string} url
 * @param {(loaded:number, total:number|null) => void} [onProgress]
 * @returns {Promise<any>}
 */
export async function fetchJSONWithProgress(url, onProgress) {
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) throw new Error(`載入失敗 (${response.status}): ${url}`);

  const header = Number(response.headers.get("content-length"));
  const total = Number.isFinite(header) && header > 0 ? header : null;

  // 沒有 body reader（很舊的瀏覽器）就退回一次讀完, 只是沒有進度。
  if (!response.body?.getReader) {
    onProgress?.(total ?? 0, total);
    return response.json();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  const merged = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) { merged.set(chunk, at); at += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8").decode(merged));
}

/**
 * 依序抓好幾份資料, 進度是「所有檔案加起來」的百分比。
 *
 * 每一份的大小要抓完才知道, 所以未知的部分先用已完成檔案的平均值頂著 ——
 * 進度條會微微跳一下, 但總比每抓完一個檔就從 0 重來好。
 *
 * @param {Array<{url:string, label?:string}>} items
 * @param {(pct:number|null, label:string) => void} [onProgress]
 * @returns {Promise<any[]>} 依序對應 items 的解析結果
 */
export async function fetchAllWithProgress(items, onProgress) {
  const sizes = new Array(items.length).fill(null);
  const loaded = new Array(items.length).fill(0);

  const estimate = () => {
    const known = sizes.filter((size) => size != null);
    const average = known.length
      ? known.reduce((sum, size) => sum + size, 0) / known.length
      : 512 * 1024;
    const total = sizes.reduce((sum, size) => sum + (size ?? average), 0);
    const got = loaded.reduce((sum, value) => sum + value, 0);
    return total > 0 ? Math.min(1, got / total) : 0;
  };

  const out = [];
  for (const [at, item] of items.entries()) {
    const label = item.label || item.url;
    out.push(await fetchJSONWithProgress(item.url, (got, size) => {
      loaded[at] = got;
      if (size != null) sizes[at] = size;
      onProgress?.(estimate(), label);
    }));
    // 抓完就把大小定下來, 沒有 content-length 的檔案才不會一直被估。
    sizes[at] = loaded[at];
    onProgress?.(estimate(), label);
  }
  return out;
}

/* ---------------- 進度條 ---------------- */

/**
 * 「重新載入資料」按鈕 + 進度條。
 *
 * @param {object} cfg
 * @param {() => Array<{url:string, label?:string}>} cfg.items  這次要重抓哪些檔案
 * @param {(results:any[]) => void|Promise<void>} cfg.onDone    抓完之後（清快取、重畫）
 * @param {string} [cfg.label]
 * @returns {HTMLElement}
 */
export function refreshControl({ items, onDone, label = "重新載入資料" }) {
  const bar = el("span", { class: "dr-bar-fill" });
  const track = el("div", { class: "dr-bar", role: "progressbar", "aria-hidden": "true" }, bar);
  const note = el("span", { class: "dr-note" });
  const progress = el("div", { class: "dr-progress", hidden: true }, track, note);

  const button = el("button", { type: "button", class: "btn btn-sm btn-ghost dr-button" },
    el("span", { class: "dr-button-label" }, label));

  const setPct = (pct) => {
    const known = pct != null && Number.isFinite(pct);
    track.classList.toggle("is-indeterminate", !known);
    bar.style.width = known ? `${(pct * 100).toFixed(1)}%` : "";
    if (known) {
      track.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
    }
  };

  let running = false;
  button.addEventListener("click", async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    progress.hidden = false;
    progress.setAttribute("aria-live", "polite");
    setPct(0);
    note.textContent = "連線中…";

    try {
      const results = await fetchAllWithProgress(items(), (pct, name) => {
        setPct(pct);
        note.textContent = pct == null
          ? `讀取 ${name}…`
          : `${Math.round(pct * 100)}%　${name}`;
      });
      setPct(1);
      note.textContent = "已是最新";
      await onDone(results);
      // 成功的訊息留一下再收, 不然畫面一閃什麼都沒看到。
      setTimeout(() => { progress.hidden = true; }, 1600);
    } catch (error) {
      console.error(error);
      progress.classList.add("is-failed");
      note.textContent = `更新失敗: ${error.message}`;
    } finally {
      running = false;
      button.disabled = false;
    }
  });

  return el("div", { class: "dr-wrap" }, button, progress);
}
