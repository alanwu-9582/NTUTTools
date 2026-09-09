// js/utils/utils.js — 共用小工具與 DOM 輔助函式。

/* ---------------- 圖示 ---------------- */
const ICON_NAMES = new Set([
  "home", "book", "calendar", "search", "x", "alert", "check", "info", "copy", "tool", "grid",
]);

/** 以獨立 SVG 檔作為遮罩，讓圖示沿用文字顏色。未知名稱回傳空字串。 */
export function icon(name, { size = "1em" } = {}) {
  if (!ICON_NAMES.has(name)) return "";
  return `<span class="svg-icon icon-${name}" style="width:${size};height:${size}" aria-hidden="true"></span>`;
}

/** 把文字轉義後才放進 innerHTML。 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 正規化文字, 供不分大小寫的比較使用。 */
export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** 取 JSON, 失敗時給出清楚的訊息。 */
export async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`載入失敗 (${res.status}): ${path}`);
  return res.json();
}

/** 把函式節流成 wait 毫秒後才執行。 */
export function debounce(fn, wait = 120) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, wait);
  };
}

/** 把搜尋字串切成正規化後的詞。 */
export function queryTerms(query) {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

/**
 * 轉義 text 之後, 把命中的 terms 包上 <mark>, 不分大小寫。
 */
export function highlightTerms(text, terms = []) {
  const raw = String(text ?? "");
  const list = terms.filter(Boolean);
  if (!raw || !list.length) return escapeHtml(raw);
  const pattern = list
    // 長的排前面, 避免互相蓋住。
    .slice().sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) return escapeHtml(raw);
  const re = new RegExp(`(${pattern})`, "gi");
  // 有一個捕捉群組時, split() 會是「文字、命中、文字、命中…」交錯。
  return raw
    .split(re)
    .map((piece, i) => (i % 2 === 1
      ? `<mark class="hl">${escapeHtml(piece)}</mark>`
      : escapeHtml(piece)))
    .join("");
}

/** querySelector 縮寫。 */
export const $ = (sel, root = document) => root.querySelector(sel);

/** 建立元素, 可帶屬性與子節點。 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
