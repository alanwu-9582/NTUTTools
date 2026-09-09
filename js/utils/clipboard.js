// js/utils/clipboard.js — 複製到剪貼簿, 並在不安全來源（http、file）下有備援。

/**
 * 複製文字。navigator.clipboard 只在 secure context 有, 
 * 用 http 開區網預覽時就會失敗, 所以留一條舊路。
 * @returns {Promise<boolean>} 成功與否
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* 落到下面的備援 */ }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
