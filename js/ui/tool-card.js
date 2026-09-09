// js/ui/tool-card.js — 工具在首頁與列表頁的兩種樣子。
//
// 首頁按分類排成卡片（掃視用）, 工具頁排成一條一條的列表（比較與搜尋用）。
// 兩種都連到同一個地方, 所以連結行為集中在 linkAttrs()。

import { el, icon, highlightTerms } from "../utils/utils.js";
import { categoryTag, tagList } from "./labels.js";

function linkAttrs(tool, routeTo, className) {
  const params = { id: tool.id };
  return {
    class: className,
    href: `#/tool?${new URLSearchParams(params)}`,
    onclick: (e) => {
      if (!routeTo || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      routeTo("tool", params);
    },
  };
}

/**
 * 一張工具卡。
 * @param {object} tool     data/tools.json 裡的一筆
 * @param {object} config   { categories, tags }
 * @param {{terms?: string[], routeTo?: Function, showCategory?: boolean}} opts
 *   terms 有值時, 標題與說明裡命中的字會被標起來。
 */
export function toolCard(tool, config, { terms = [], routeTo, showCategory = true } = {}) {
  return el("a", linkAttrs(tool, routeTo, "entry-card"),
    el("div", { class: "entry-card-top" },
      // 首頁把卡片按分類分組了, 那時候卡片上再標一次分類只是重複。
      showCategory ? categoryTag(tool.category, config) : null,
      el("div", { class: "row-tags" }, tagList(tool.tags || [], config)),
    ),
    el("h3", { class: "entry-card-title" },
      el("span", { class: "entry-card-ico", html: icon(tool.icon || "tool", { size: "16px" }) }),
      el("span", { html: highlightTerms(tool.title || tool.id, terms) }),
    ),
    tool.description
      ? el("p", { class: "entry-card-desc", html: highlightTerms(tool.description, terms) })
      : null,
  );
}

/** 一格工具卡的網格。 */
export function toolGrid(tools, config, opts = {}) {
  return el("div", { class: "entry-grid" }, tools.map((tool) => toolCard(tool, config, opts)));
}

/** 列表裡的一列工具。 */
export function toolItem(tool, config, { terms = [], routeTo } = {}) {
  return el("a", linkAttrs(tool, routeTo, "catalog-item"),
    el("span", { class: "catalog-item-ico", html: icon(tool.icon || "tool", { size: "20px" }) }),
    el("span", { class: "catalog-item-main" },
      el("span", { class: "catalog-item-title", html: highlightTerms(tool.title || tool.id, terms) }),
      tool.description
        ? el("span", { class: "catalog-item-desc", html: highlightTerms(tool.description, terms) })
        : null,
    ),
    // 寬螢幕下這一層是 display: contents, 子元素直接對齊共用格線；
    // 窄螢幕時它變成會換行的 flex 列。
    el("span", { class: "catalog-item-meta" },
      el("span", { class: "catalog-item-cat" }, categoryTag(tool.category, config)),
      el("span", { class: "catalog-item-tags" }, tagList(tool.tags || [], config)),
    ),
  );
}

/** 一條一條的工具列表。 */
export function toolList(tools, config, opts = {}) {
  return el("div", { class: "catalog-list" }, tools.map((tool) => toolItem(tool, config, opts)));
}
