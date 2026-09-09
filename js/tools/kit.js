// js/tools/kit.js — 工具共用的小元件。
//
// 每個工具都會用到同一批東西: 一排有標籤的輸入、一塊結果、一顆複製鈕。
// 集中在這裡, 工具模組就只剩下自己的邏輯, 長相也不會各做各的。

import { el, icon } from "../utils/utils.js";
import { copyText } from "../utils/clipboard.js";
import { notify } from "../ui/notifications.js";

/** 工具的最外層外框。 */
export function panel(...children) {
  return el("div", { class: "tool-panel" }, children);
}

/** 一排會自動換行的欄位。 */
export function row(...children) {
  return el("div", { class: "tool-row" }, children);
}

/** 靠右對齊的按鈕列。 */
export function actions(...children) {
  return el("div", { class: "tool-actions" }, children);
}

/**
 * 幫控制項加上標籤與說明。控制項本身要先建好再傳進來, 
 * 這樣呼叫端才拿得到它的參考去讀值。
 */
export function field(label, control, hint) {
  // 只有真正的表單元件才配 <label for>；分頁鈕那種自製控制項用 div 包, 
  // 免得 label 把點擊事件轉給一個沒有值的元素。
  const formal = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);
  const parts = [
    el("span", { class: "tool-field-label" }, label),
    control,
    hint ? el("span", { class: "tool-field-hint" }, hint) : null,
  ];
  if (!formal) return el("div", { class: "tool-field" }, parts);
  control.id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  return el("label", { class: "tool-field", for: control.id }, parts);
}

export function textInput({ value = "", placeholder = "", mono = false, onInput } = {}) {
  return el("input", {
    type: "text",
    class: mono ? "tool-input is-mono" : "tool-input",
    value,
    placeholder,
    autocomplete: "off",
    spellcheck: "false",
    oninput: onInput,
  });
}

export function numberInput({ value = "", step = "any", min, max, placeholder = "", onInput } = {}) {
  return el("input", {
    type: "number",
    class: "tool-input is-mono",
    value,
    step,
    min,
    max,
    placeholder,
    inputmode: "decimal",
    oninput: onInput,
  });
}

export function textArea({ value = "", placeholder = "", rows = 8, mono = true, onInput } = {}) {
  return el("textarea", {
    class: mono ? "tool-textarea is-mono" : "tool-textarea",
    rows: String(rows),
    placeholder,
    spellcheck: "false",
    oninput: onInput,
  }, value);
}

/**
 * 下拉選單。
 * @param {{options: Array<{value:string,label:string,group?:string}>}} cfg
 */
export function select({ options = [], value = "", onChange } = {}) {
  const node = el("select", { class: "tool-input", onchange: onChange });
  const groups = new Map();
  for (const opt of options) {
    const child = el("option", { value: opt.value }, opt.label);
    if (!opt.group) { node.appendChild(child); continue; }
    if (!groups.has(opt.group)) {
      const g = el("optgroup", { label: opt.group });
      groups.set(opt.group, g);
      node.appendChild(g);
    }
    groups.get(opt.group).appendChild(child);
  }
  node.value = value;
  return node;
}

export function button(label, { variant = "ghost", onClick, iconName } = {}) {
  return el("button", { type: "button", class: `btn btn-sm btn-${variant}`, onclick: onClick },
    iconName ? el("span", { class: "btn-ico", html: icon(iconName, { size: "14px" }) }) : null,
    label,
  );
}

/** 一組互斥的分頁鈕（例如「編碼／解碼」）。 */
export function segmented(items, { value, onChange } = {}) {
  const host = el("div", { class: "tool-segmented", role: "tablist" });
  const buttons = new Map();
  const paint = (next) => {
    for (const [key, node] of buttons) {
      const active = key === next;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
    }
  };
  for (const item of items) {
    const node = el("button", {
      type: "button",
      class: "tool-seg",
      role: "tab",
      onclick: () => { paint(item.value); onChange?.(item.value); },
    }, item.label);
    buttons.set(item.value, node);
    host.appendChild(node);
  }
  paint(value ?? items[0]?.value);
  host.select = paint;
  return host;
}

/** 一顆會短暫變成打勾的複製鈕。 */
export function copyButton(getText, { label = "複製" } = {}) {
  const node = el("button", { type: "button", class: "tool-copy", title: label, "aria-label": label },
    el("span", { class: "tool-copy-ico", html: icon("copy", { size: "14px" }) }),
    el("span", { class: "tool-copy-label" }, label),
  );
  let timer = null;
  node.addEventListener("click", async () => {
    const text = String(getText() ?? "");
    if (!text) { notify.warning("沒有可以複製的內容。"); return; }
    if (!(await copyText(text))) { notify.danger("複製失敗, 請手動選取。"); return; }
    notify.success("已複製");
    node.classList.add("is-copied");
    node.querySelector(".tool-copy-ico").innerHTML = icon("check", { size: "14px" });
    node.querySelector(".tool-copy-label").textContent = "已複製";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      node.classList.remove("is-copied");
      node.querySelector(".tool-copy-ico").innerHTML = icon("copy", { size: "14px" });
      node.querySelector(".tool-copy-label").textContent = label;
    }, 1600);
  });
  return node;
}

/**
 * 唯讀的結果列: 標籤、值、複製鈕。
 * 回傳的節點上掛了 `set(value)`, 更新時直接呼叫。
 */
export function outputRow(label, { value = "", mono = true } = {}) {
  const text = el("div", { class: mono ? "tool-out-value is-mono" : "tool-out-value" }, value);
  const node = el("div", { class: "tool-out" },
    el("div", { class: "tool-out-label" }, label),
    text,
    copyButton(() => text.textContent),
  );
  node.set = (next) => {
    text.textContent = next == null || next === "" ? "" : String(next);
    node.classList.toggle("is-empty", !text.textContent);
  };
  node.set(value);
  return node;
}

/** 一行狀態訊息: ok / warn / error。 */
export function status() {
  const node = el("p", { class: "tool-status", role: "status" });
  node.set = (message, kind = "ok") => {
    node.textContent = message || "";
    node.className = `tool-status is-${kind}`;
    node.hidden = !message;
  };
  node.set("");
  return node;
}

/** 補充說明。 */
export function note(...children) {
  return el("p", { class: "tool-note" }, children);
}

/** 小標題, 把一個工具切成幾段。 */
export function subhead(text) {
  return el("div", { class: "tool-subhead" }, text);
}

export { el, icon };
