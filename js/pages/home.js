// js/pages/home.js — 首頁: 站台簡介, 然後依分類列出工具。

import { $, el, icon, escapeHtml } from "../utils/utils.js";
import { getSite, getTools, getConfig } from "../services/data-service.js";
import { toolGrid } from "../ui/tool-card.js";

/** data/tools.json 裡分類不在 site.json 的工具, 都收在這一組。 */
const OTHER = { id: "", label: "其他", color: "" };

export async function mountPage({ routeTo }) {
  const host = $("#home");
  if (!host) return null;

  try {
    const [site, tools, config] = await Promise.all([getSite(), getTools(), getConfig()]);
    host.replaceChildren(
      heroCard(site),
      ...(tools.length
        ? groupsOf(tools, config).flatMap((group) => categorySection(group, config, routeTo))
        : [el("div", { class: "state-block" },
          el("span", { class: "ico", html: icon("tool", { size: "34px" }) }),
          el("div", { class: "st-title" }, "還沒有工具"),
          el("div", { class: "st-msg" }, "在 data/tools.json 加一筆, 並建好 js/tools/<id>/index.js。"))]),
    );
  } catch (err) {
    console.error(err);
    host.innerHTML =
      `<div class="banner banner-danger" role="alert">首頁資料載入失敗: ${escapeHtml(err.message)}。請以 HTTP 伺服器開啟（不要用 file://）後重新整理。</div>`;
  }
  return null;
}

function heroCard(site) {
  return el("section", { class: "card hero-card" },
    site.logo ? el("img", { class: "hero-logo", src: site.logo, alt: "" }) : null,
    el("div", { class: "hero-body" },
      el("p", { class: "hero-eyebrow" }, site.tagline || "北科大工具箱"),
      el("h1", { class: "hero-title" }, site.title || "NTUTTools"),
      site.description ? el("p", { class: "hero-intro" }, site.description) : null,
    ),
  );
}

/**
 * 依分類分組。順序跟著 site.json 裡 categories 的順序走 ——
 * 分類的排序是編輯上的決定, 不該讓工具的新增順序決定。
 */
function groupsOf(tools, config) {
  const groups = [];
  const claimed = new Set();
  for (const [id, meta] of Object.entries(config.categories || {})) {
    const items = tools.filter((tool) => tool.category === id);
    if (!items.length) continue;
    for (const tool of items) claimed.add(tool);
    groups.push({ id, label: meta.label || id, color: meta.color || "", items });
  }
  const rest = tools.filter((tool) => !claimed.has(tool));
  if (rest.length) groups.push({ ...OTHER, items: rest });
  return groups;
}

function categorySection(group, config, routeTo) {
  const head = el("div", { class: "section-head cat-head" },
    el("div", { class: "cat-head-main" },
      group.color
        ? el("span", { class: "cat-dot", style: `--chip-color:${group.color}` })
        : null,
      el("h2", { class: "section-title" }, group.label),
    ),
    el("span", { class: "section-desc" }, `${group.items.length} 個工具`),
  );
  return [head, toolGrid(group.items, config, { routeTo, showCategory: false })];
}
