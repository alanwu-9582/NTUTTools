// js/tools/timetable.js — 14 節 × 7 天的課表格線, 教室資訊與班級課表共用。
//
// 兩個工具的資料來源不一樣（一個是教室, 一個是班級）, 但看到的東西一樣:
// 一格空堂或一格有課。差異只在每一格裡要放什麼字, 所以呼叫端只要給
// 一個 `cell(day, periodKey)` 回傳項目陣列, 版面與配色都在這裡。

import { el } from "../utils/utils.js";

export const timetableStyles = new URL("./timetable.css", import.meta.url).href;

/** 資料裡的星期代碼維持「日 = 0」；畫面統一從週一排到週日。 */
export const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const periodLabel = (key) => `第 ${key} 節`;

/**
 * @param {object} cfg
 * @param {Array<{key:string,start:string,end:string}>} cfg.periods
 * @param {(day:number, periodKey:string) => Array<{title:string, subs?:string[], title2?:string}>} cfg.cell
 * @param {{day:number, period:string}} [cfg.now]  要標記的「現在」那一格
 * @param {(day:number, periodKey:string, entries:Array) => void} [cfg.onPick]  點一格
 * @returns {HTMLElement} 可橫向捲動的容器
 */
export function timetable({ periods, cell, now = null, onPick = null }) {
  const head = el("tr", {},
    el("th", { class: "tt-period" }, "節次"),
    ...DAY_ORDER.map((day) => el("th", {
      class: now && day === now.day ? "tt-day is-today" : "tt-day",
      scope: "col",
    }, `週${DAY_LABELS[day]}`)),
  );

  const rows = periods.map((period) => el("tr", {},
    el("th", { class: "tt-period", scope: "row" },
      el("span", { class: "tt-period-key" }, periodLabel(period.key)),
      el("span", { class: "tt-period-time" }, `${period.start}–${period.end}`),
    ),
    ...DAY_ORDER.map((day) => {
      const entries = cell(day, period.key) || [];
      const busy = entries.length > 0;
      const isNow = now && day === now.day && period.key === now.period;
      const node = el("td", {
        class: [busy ? "is-busy" : "is-free", isNow ? "is-now" : ""].filter(Boolean).join(" "),
        // 空堂沒有內容, 螢幕閱讀器要念得出這一格是什麼。
        ...(busy ? {} : { "aria-label": `週${DAY_LABELS[day]} ${periodLabel(period.key)} 空堂` }),
      }, ...entries.map((entry) => el("div", { class: "tt-item" },
        el("span", { class: "tt-item-name" }, entry.title),
        ...(entry.subs || []).filter(Boolean).map((text) => el("span", { class: "tt-item-sub" }, text)),
      )));
      if (busy && onPick) {
        node.classList.add("is-pickable");
        node.tabIndex = 0;
        node.addEventListener("click", () => onPick(day, period.key, entries));
        node.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onPick(day, period.key, entries);
        });
      }
      return node;
    }),
  ));

  return el("div", { class: "tt-wrap" },
    el("table", { class: "tt-grid" },
      el("thead", {}, head),
      el("tbody", {}, ...rows)));
}

/** 一格的鍵。用來當 Set 的成員, 兩個工具都照這個格式存。 */
export const slotKey = (day, periodKey) => `${day}|${periodKey}`;

/**
 * 挑時段用的格線: 同樣 14 節 × 7 天, 但每一格是可以按的開關。
 *
 * 星期表頭與節次列首也可以按, 一次切換整欄／整列 —— 「整個週三」或
 * 「每天第 3 節」是真的會有人想選的組合, 一格一格點 7 次太慢。
 *
 * @param {object} cfg
 * @param {Array<{key:string,start:string,end:string}>} cfg.periods
 * @param {Set<string>} cfg.selected  已選的格子, 內容是 slotKey() 的字串
 * @param {() => void} cfg.onChange   選擇有變動時呼叫（selected 已經就地改好）
 * @returns {HTMLElement}
 */
export function timetablePicker({ periods, selected, onChange }) {
  const cells = new Map();

  const paint = () => {
    for (const [key, node] of cells) {
      const on = selected.has(key);
      node.classList.toggle("is-picked", on);
      node.setAttribute("aria-pressed", String(on));
    }
  };

  /** 一組格子全開或全關: 只要還有沒選到的就全開, 全選了才全關。 */
  const toggleMany = (keys) => {
    const fill = keys.some((key) => !selected.has(key));
    for (const key of keys) {
      if (fill) selected.add(key);
      else selected.delete(key);
    }
    paint();
    onChange?.();
  };

  const head = el("tr", {},
    el("th", { class: "tt-period" }, "節次"),
    ...DAY_ORDER.map((day) => el("th", { class: "tt-day", scope: "col" },
      el("button", {
        type: "button",
        class: "tt-bulk",
        title: `切換整個週${DAY_LABELS[day]}`,
        onclick: () => toggleMany(periods.map((period) => slotKey(day, period.key))),
      }, `週${DAY_LABELS[day]}`))),
  );

  const rows = periods.map((period) => el("tr", {},
    el("th", { class: "tt-period", scope: "row" },
      el("button", {
        type: "button",
        class: "tt-bulk",
        title: `切換每天的${periodLabel(period.key)}`,
        onclick: () => toggleMany(DAY_ORDER.map((day) => slotKey(day, period.key))),
      },
        el("span", { class: "tt-period-key" }, periodLabel(period.key)),
        el("span", { class: "tt-period-time" }, `${period.start}–${period.end}`),
      ),
    ),
    ...DAY_ORDER.map((day) => {
      const key = slotKey(day, period.key);
      const node = el("td", {
        class: "tt-pick",
        role: "button",
        tabindex: "0",
        "aria-pressed": "false",
        "aria-label": `週${DAY_LABELS[day]} ${periodLabel(period.key)}`,
      });
      const toggle = () => {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        paint();
        onChange?.();
      };
      node.addEventListener("click", toggle);
      node.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggle();
      });
      cells.set(key, node);
      return node;
    }),
  ));

  const wrap = el("div", { class: "tt-wrap is-picker" },
    el("table", { class: "tt-grid" },
      el("thead", {}, head),
      el("tbody", {}, ...rows)));
  paint();
  wrap.repaint = paint;
  return wrap;
}

/** 圖例。空堂／有課的配色不寫在畫面上的話, 第一次看的人會以為深色格是壞掉。 */
export function timetableLegend(...extra) {
  return el("div", { class: "tt-legend" },
    el("span", { class: "tt-legend-item" }, el("span", { class: "tt-swatch is-free" }), "空堂"),
    el("span", { class: "tt-legend-item" }, el("span", { class: "tt-swatch is-busy" }), "有課"),
    ...extra,
  );
}
