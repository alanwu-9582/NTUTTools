// js/tools/svg.js — 建 SVG 節點與把 SVG 存成檔案。跨工具共用。

export const SVG_NS = "http://www.w3.org/2000/svg";

/** 建 SVG 節點。utils 的 el() 走 createElement, 對 SVG 不管用。 */
export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * 把一個 SVG 元素存成檔案。
 * 標了 mm 單位的 SVG 這樣下載下來, 列印選「實際大小」就是 1:1。
 */
export function downloadSvg(svg, filename) {
  const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻釋放會讓部分瀏覽器來不及讀, 等一拍再收。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
