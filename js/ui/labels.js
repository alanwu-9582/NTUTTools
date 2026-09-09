// js/ui/labels.js — 類別／標籤 chip, 顏色來自 data/site.json。

import { el } from "../utils/utils.js";

/**
 * 類別 chip。顏色取自 site.json 的 categories[id].color
 * (a CSS value, e.g. "var(--cffy-theme-info-a0)" or "#87d1ff").
 */
export function categoryTag(categoryId, config, { plain = false } = {}) {
  const meta = config?.categories?.[categoryId] || {};
  const label = meta.label || categoryId || "未分類";
  const color = meta.color || "var(--text-muted)";
  const node = el("span", { class: "cat-tag", title: `類別: ${label}` }, label);
  // Tinted background + solid text, all driven by the configured colour.
  node.style.color = color;
  node.style.background = `color-mix(in srgb, ${color} 16%, transparent)`;
  node.style.border = `1px solid color-mix(in srgb, ${color} 34%, transparent)`;
  if (plain) node.style.background = "transparent";
  return node;
}

/** A single tag chip. */
export function tagChip(tagId, config, { onClick = null, active = false } = {}) {
  const meta = config?.tags?.[tagId] || {};
  const label = meta.label || tagId;
  const color = meta.color || "var(--text-muted)";
  const node = el("span", {
    class: "doc-tag" + (active ? " is-active" : ""),
    title: `標籤: ${label}`,
  }, label);
  node.style.setProperty("--chip-color", color);
  if (onClick) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.style.cursor = "pointer";
    node.addEventListener("click", () => onClick(tagId));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(tagId); }
    });
  }
  return node;
}

/** Convenience: a list of tag chips for a document. */
export function tagList(tags = [], config) {
  const wrap = el("span", { class: "tag-list" });
  for (const t of tags) wrap.appendChild(tagChip(t, config));
  return wrap;
}
