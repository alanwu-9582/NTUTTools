// js/core/main.js — 啟動整個靜態網站。

import { initSidebarToggle } from "../ui/sidebar.js";
import { startRouter, renderNavigation } from "./router.js";
import { registerServiceWorker } from "./offline.js";
import { getSite } from "../services/data-service.js";
import { el } from "../utils/utils.js";

initSidebarToggle();
renderNavigation();
startRouter();
registerServiceWorker();

/** 側邊欄底部: 站名與幾個外部連結, 資料同樣來自 site.json。 */
getSite().then((site) => {
  const foot = document.getElementById("nav-foot");
  if (!foot) return;
  const links = (site.links || []).slice(0, 3);
  foot.replaceChildren(
    el("div", {}, site.title || "NTUTTools"),
    el("div", {}, site.tagline || ""),
    links.length
      ? el("div", { class: "nav-foot-links" },
        links.map((link) => el("a", {
          href: link.url,
          target: "_blank",
          rel: "noopener noreferrer",
        }, link.label)))
      : null,
  );
}).catch((err) => console.warn("side-nav 資訊載入失敗: ", err));
