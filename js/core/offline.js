// js/core/offline.js — service worker 註冊與連線狀態提示。

import { notify } from "../ui/notifications.js";

/** file:// 與區網 http 都沒辦法註冊 service worker。 */
function supported() {
  if (!("serviceWorker" in navigator)) return false;
  return window.isSecureContext;
}

export function registerServiceWorker() {
  if (!supported()) return;

  navigator.serviceWorker.register("sw.js").catch((err) => {
    console.warn("離線功能註冊失敗: ", err);
  });

  // 網站悄悄切到快取版本時要講一聲, 不然讀者會以為是壞掉而不是離線。
  let wasOffline = !navigator.onLine;
  window.addEventListener("offline", () => {
    wasOffline = true;
    notify.warning("目前離線, 顯示的是先前已載入的內容。", { duration: 4000 });
  });
  window.addEventListener("online", () => {
    if (!wasOffline) return;
    wasOffline = false;
    notify.success("已恢復連線。");
  });
}
