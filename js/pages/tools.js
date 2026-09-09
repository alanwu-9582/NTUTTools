// js/pages/tools.js — 工具列表: 即時搜尋 + 類別篩選。

import {
  $, el, icon, escapeHtml, debounce, normalizeText, queryTerms,
} from "../utils/utils.js";
import { getTools, getConfig } from "../services/data-service.js";
import { toolList } from "../ui/tool-card.js";
import { replaceParams } from "../core/router.js";

let navigate = null;
const state = {
  tools: [], config: { categories: {}, tags: {} },
  query: "", category: "",
};

/** 一筆工具可以被搜到的所有文字。 */
function haystack(tool, config) {
  return [
    tool.title,
    tool.description,
    config.categories?.[tool.category]?.label,
    ...(tool.tags || []).map((id) => config.tags?.[id]?.label || id),
  ].map(normalizeText).join(" ");
}

function matches(tool) {
  if (state.category && tool.category !== state.category) return false;
  const terms = queryTerms(state.query);
  if (!terms.length) return true;
  const hay = haystack(tool, state.config);
  return terms.every((term) => hay.includes(term));
}

export async function mountPage({ params, routeTo }) {
  navigate = routeTo;
  state.query = params?.get("q") || "";
  state.category = params?.get("cat") || "";

  const searchIco = $("#search-ico");
  if (searchIco) searchIco.innerHTML = icon("search", { size: "18px" });

  const input = $("#tool-search");
  if (input) input.value = state.query;
  input?.addEventListener("input", debounce(() => {
    state.query = input.value;
    render();
  }, 80));

  document.addEventListener("keydown", onKeydown);

  const grid = $("#tool-grid");
  if (grid) grid.innerHTML = '<div class="state-block" role="status"><div class="spinner" aria-hidden="true"></div>載入中…</div>';

  try {
    const [tools, config] = await Promise.all([getTools(), getConfig()]);
    state.tools = tools;
    state.config = config;
    const sub = $("#tools-sub");
    if (sub) sub.textContent = "各種常用前端工具";
    render();
  } catch (err) {
    console.error(err);
    if (grid) grid.innerHTML =
      `<div class="banner banner-danger" role="alert">工具清單載入失敗: ${escapeHtml(err.message)}。請以 HTTP 伺服器開啟（不要用 file://）後重新整理。</div>`;
  }

  return () => document.removeEventListener("keydown", onKeydown);
}

/* ---------------- 鍵盤 ---------------- */

function onKeydown(e) {
  const input = $("#tool-search");
  if (!input) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")
    || document.activeElement?.isContentEditable;

  if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }
  if (e.key === "Escape" && document.activeElement === input && input.value) {
    input.value = "";
    state.query = "";
    render();
  }
}

/* ---------------- 畫面 ---------------- */

function render() {
  const grid = $("#tool-grid");
  if (!grid) return;

  replaceParams("tools", { q: state.query, cat: state.category });
  renderFilters();

  const kbd = $("#search-kbd");
  if (kbd) kbd.hidden = Boolean(state.query);

  const found = state.tools.filter(matches);
  const count = $("#result-count");
  if (count) count.textContent = String(found.length);

  if (!found.length) {
    grid.replaceChildren(el("div", { class: "state-block" },
      el("span", { class: "ico", html: icon("search", { size: "34px" }) }),
      el("div", { class: "st-title" }, "沒有符合的工具"),
      el("div", { class: "st-msg" }, "換個關鍵字, 或把類別篩選清掉。"),
    ));
    return;
  }

  grid.replaceChildren(toolList(found, state.config, {
    terms: queryTerms(state.query),
    routeTo: navigate,
  }));
}

/** 只列真的有工具在用的類別, 免得篩到 0 筆。 */
function renderFilters() {
  const host = $("#cat-filters");
  if (!host) return;
  const used = new Set(state.tools.map((tool) => tool.category).filter(Boolean));
  if (used.size < 2) { host.replaceChildren(); return; }

  // id 為空字串的那顆就是「全部」, 它在沒有選類別時自然是選中的狀態。
  const chip = (label, id, color) => {
    const active = state.category === id;
    const node = el("button", {
      type: "button",
      class: "filter-chip" + (color ? " filter-chip-color" : "") + (active ? " is-active" : ""),
      "aria-pressed": String(active),
      onclick: () => { state.category = active ? "" : id; render(); },
    }, label);
    if (color) node.style.setProperty("--chip-color", color);
    return node;
  };

  host.replaceChildren(
    chip("全部", "", null),
    ...Object.entries(state.config.categories)
      .filter(([id]) => used.has(id))
      .map(([id, meta]) => chip(meta.label || id, id, meta.color)),
  );
}
