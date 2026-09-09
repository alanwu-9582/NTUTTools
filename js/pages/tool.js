// js/pages/tool.js — 單一工具頁。
//
// 這裡只負責標題那幾行與外框, 工具本體由 tool-loader 動態載入 ——
// 頁面不知道工具長什麼樣, 工具也不需要知道自己被掛在哪。

import { $, el, escapeHtml } from "../utils/utils.js";
import { getToolById, getConfig, getSite } from "../services/data-service.js";
import { categoryTag, tagList } from "../ui/labels.js";
import { mountTool } from "../services/tool-loader.js";
import { replaceParams } from "../core/router.js";

export async function mountPage({ params }) {
  const id = params.get("id");
  const head = $("#tool-head");
  const mount = $("#tool-mount");

  const [tool, config, site] = await Promise.all([
    getToolById(id).catch(() => null),
    getConfig().catch(() => ({ categories: {}, tags: {} })),
    getSite().catch(() => ({})),
  ]);

  if (!tool) {
    head?.replaceChildren();
    if (mount) {
      mount.innerHTML =
        `<div class="banner banner-danger" role="alert">找不到這個工具（id: ${escapeHtml(id || "")}）。<a href="#/tools">回到工具列表</a>看看其他的。</div>`;
    }
    return null;
  }

  document.title = `${tool.title} · ${site.title || "NTUTTools"}`;
  head?.replaceChildren(
    el("div", { class: "tool-head-meta" },
      categoryTag(tool.category, config),
      tagList(tool.tags || [], config),
    ),
    el("h1", { class: "page-title" }, tool.title),
    tool.description ? el("p", { class: "page-sub" }, tool.description) : null,
  );

  // 工具自己的檢視狀態寫回網址, 但 id 永遠留著 —— 少了它整頁就找不到工具了。
  const cleanup = await mountTool(mount, tool.id, {
    params,
    setParams: (extra = {}) => replaceParams("tool", { id: tool.id, ...extra }),
  });
  return () => cleanup?.();
}
