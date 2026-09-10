// js/tools/credit-master/index.js — 學分大師。
//
// 北科大工程科技學士班【材資系材料組】的成績與畢業學分管理。自己加課、填分數,
// 算 GPA 與各類學分, 並逐項對照畢業門檻（含「幾選幾」、通識博雅三向度、
// 基礎實驗課程）。
//
// 兩份資料:
//   data/ntut-curriculum.json  自己的課程科目表 + 畢業門檻（一開就載）
//   data/ntut-courses.json     全校 3000 多門課, 給「新增課程」挑（用到才載）
//
// 兩份都是 tools/build-{curriculum,courses}.mjs 從學校網站抓的快照 ——
// 學分數與幾選幾的組合都不是寫死在程式裡。換系所組只要改
// build-curriculum.mjs 的 YEAR / MATRIC / DIVISION 再重跑。

import {
  panel, row, field, segmented, button, numberInput, textInput, select,
  status, note, subhead, actions, copyButton, el, icon,
} from "../kit.js";
import { s } from "../svg.js";
import { notify } from "../../ui/notifications.js";
import { refreshControl } from "../../services/data-refresh.js";
import { summarise, SCALE_KEYS } from "./grades.js";
import {
  loadLocal, saveLocal, clearLocal, readSheet, pullFromScript, pushToScript,
  toTable, APPS_SCRIPT,
} from "./storage.js";

export const styles = new URL("./credit-master.css", import.meta.url).href;

export const meta = { title: "學分大師" };

const CURRICULUM_URL = new URL("../../../data/ntut-curriculum.json", import.meta.url).href;
const POOL_URL = new URL("../../../data/ntut-courses.json", import.meta.url).href;

/** 課表比對用的鍵。同一學期同名課程不會重複, 所以這樣就夠。 */
const keyOf = (semester, name) => `${semester}|${name}`;

const blankState = () => ({
  entries: [], ranks: {},
  scale: "4.3", includeFailed: true, sheetUrl: "", scriptUrl: "",
});

const round = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
};

/** 使用者自己填的類別選項。空值代表課表以外的課, 歸「跨域及自由選修」。 */
const CATEGORY_OPTIONS = [
  { value: "", label: "跨域及自由選修" },
  { value: "校定共同必修", label: "共同必修" },
  { value: "校定專業必修", label: "專業必修" },
  { value: "校定專業選修", label: "專業選修" },
  { value: "校定共同選修", label: "共同選修" },
];

export async function mount(host) {
  let curriculum = null;
  let pool = null;
  let state = { ...blankState(), ...(loadLocal() || {}) };
  let view = "summary";
  let openSemester = null;
  let picker = null;   // { source, query } 開著的時候才有值

  // 重新載入資料時要跟著重建的索引。
  let bySemester = new Map();
  let curriculumIndex = new Map();

  // 圖表的互動狀態。放在 mount 這一層, 重畫（換 GPA 級距、加課）之後
  // 使用者剛剛切掉的線與釘住的那一塊還在。
  const trendSeries = { gpa: true, score: true };
  let trendFocus = null;
  let pinnedBucket = null;

  const info = status();
  const board = el("div", { class: "cm-board" });

  /** 把課表接上去: 重建索引。載入與重新載入都走這裡。 */
  function adoptCurriculum(next) {
    curriculum = next;
    bySemester = new Map(curriculum.semesters.map((label) => [label, []]));
    for (const course of curriculum.courses) bySemester.get(course.semester)?.push(course);
    curriculumIndex = new Map(
      curriculum.courses.map((course) => [keyOf(course.semester, course.name), course]),
    );
    if (!curriculum.semesters.includes(openSemester)) openSemester = curriculum.semesters[0];
    picker = null;
  }

  /* ---------- 課程科目表 ---------- */
  try {
    const response = await fetch(CURRICULUM_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    adoptCurriculum(await response.json());
  } catch (error) {
    host.appendChild(panel(
      el("div", { class: "banner banner-danger" }, `讀不到課程標準: ${error.message}`),
    ));
    return null;
  }

  /**
   * 有沒有畢業門檻。
   *
   * 目前這份（四技材資材料組）一定有, 但 build-curriculum.mjs 換成學程、
   * 第二專長、微學程那些系所組時就沒有 —— 學校那些表本來就只列課, 不寫
   * 「最低畢業學分」。把沒有的門檻當成 0 會算出「已經畢業」這種假答案,
   * 所以那時候畢業進度整塊不畫。
   */
  const hasGraduation = () => curriculum?.requirements?.total != null;

  /**
   * 全校課程清單。321 KB, 只有按下「新增課程」才載 ——
   * 大部分時候使用者只是來看自己的進度, 不該為此多下載一份。
   */
  async function ensurePool() {
    if (pool) return pool;
    const response = await fetch(POOL_URL);
    if (!response.ok) throw new Error(`讀不到全校課程清單（HTTP ${response.status}）`);
    const data = await response.json();
    data.divisionByCode = new Map(data.divisions.map((division) => [division.code, division]));
    pool = data;
    return pool;
  }

  /* ---------- 狀態 ---------- */

  const namedEntries = () => state.entries.filter((entry) => String(entry.name || "").trim());

  /**
   * 這一輪畫面上成績列的參考, 還有學期下拉與狀態列。
   * 只更新衍生數字時要靠它們, 不用整塊重建。
   */
  let liveRows = [];
  let liveSemesterSelect = null;

  const save = () => saveLocal(state);

  /** 存檔並整塊重畫。只給「離散」的操作用（加課、刪課、換類別）。 */
  function persist() {
    save();
    paint();
  }

  /**
   * 只重算衍生數字, 不重建 DOM。
   *
   * 打字時一定要走這條。原本每按一個鍵都呼叫 paint(), 而 paint() 是
   * board.replaceChildren(...) —— 正在打字的那個 input 會被換成一個新的節點, 
   * 焦點與游標位置就跟著消失, 變成每打一個字就跳開一次。
   */
  function refreshDerived() {
    const result = summarise(namedEntries(), curriculum, {
      includeFailed: state.includeFailed,
      ranks: state.ranks,
    });
    for (const item of liveRows) {
      const resolved = result.rows.find(
        (candidate) => candidate.semester === item.entry.semester && candidate.name === item.entry.name,
      );
      item.row.className = resolved ? (resolved.passed ? "is-pass" : "is-fail") : "";
      item.points.textContent = resolved ? round(resolved.points[state.scale]) : "";
    }
    if (liveSemesterSelect) {
      for (const option of liveSemesterSelect.options) {
        option.textContent = semesterOptionLabel(option.value, result);
      }
    }
    setStatus(result);
    return result;
  }

  /** 學期下拉的一行字, 附帶該學期的進度。 */
  function semesterOptionLabel(label, result) {
    const own = result.semesters.find((semester) => semester.label === label);
    const taken = state.entries.filter((entry) => entry.semester === label).length;
    return taken ? `${label}　${taken} 門・${round(own?.credits ?? 0)} 學分` : `${label}　（還沒加課）`;
  }

  function setStatus(result) {
    info.set(
      `${curriculum.program.heading}　·　課程標準抓取日 ${curriculum.generated}`
      + `　·　已輸入 ${result.overall.graded} 科`
      + (result.overall.failed ? `（${result.overall.failed} 科不及格）` : ""),
      "ok",
    );
  }

  /** 這門課在自己的課表裡嗎（決定學分與類別要不要讓使用者改）。 */
  const curriculumCourse = (entry) => curriculumIndex.get(keyOf(entry.semester, entry.name)) || null;

  function addEntry(entry) {
    const exists = state.entries.some(
      (item) => item.semester === entry.semester && item.name === entry.name,
    );
    if (exists) { notify.warning(`${entry.semester} 已經有「${entry.name}」了`); return false; }
    state.entries.push({ score: "", ...entry });
    return true;
  }

  function removeEntry(entry) {
    state.entries = state.entries.filter((item) => item !== entry);
    persist();
  }

  /* ============================ 共用小塊 ============================ */

  function bar(earned, need) {
    const ratio = need > 0 ? Math.min(1, earned / need) : (earned > 0 ? 1 : 0);
    return el("div", { class: "cm-bar", role: "img", "aria-label": `${earned} / ${need}` },
      el("span", { class: "cm-bar-fill", style: `width:${(ratio * 100).toFixed(1)}%` }));
  }

  const flag = (met) => el("span", {
    class: met ? "cm-flag is-ok" : "cm-flag",
    "aria-label": met ? "已達成" : "未達成",
    html: icon(met ? "check" : "x", { size: "14px" }),
  });

  /* ============================ 總覽 ============================ */

  function renderSummary(result) {
    const cards = el("div", { class: "cm-cards" },
      ...SCALE_KEYS.map((scale) => el("div", { class: "cm-card" },
        el("div", { class: "cm-card-label" }, `累進 GPA (${scale})`),
        el("div", { class: "cm-card-value" }, round(result.overall.gpa[scale])))),
      el("div", { class: "cm-card" },
        el("div", { class: "cm-card-label" }, "已取得學分"),
        el("div", { class: "cm-card-value" }, `${round(result.total.earned)}`),
        el("div", { class: "cm-card-note" }, `／ ${result.total.need}`)),
      el("div", { class: "cm-card" },
        el("div", { class: "cm-card-label" }, "加權平均"),
        el("div", { class: "cm-card-value" }, round(result.overall.weighted))),
    );

    const thresholds = el("table", { class: "cm-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "類別"), el("th", { class: "is-num" }, "已修"), el("th", { class: "is-num" }, "應修"),
        el("th", {}, "進度"), el("th", {}, ""))),
      el("tbody", {},
        ...result.buckets.map((bucket) => el("tr", {},
          el("td", {}, bucket.label,
            bucket.note ? el("span", { class: "cm-hint" }, ` ${bucket.note}`) : null),
          el("td", { class: "is-num" }, round(bucket.earned)),
          el("td", { class: "is-num" }, String(bucket.need)),
          el("td", {}, bar(bucket.earned, bucket.need)),
          el("td", {}, flag(bucket.met)))),
        el("tr", { class: "cm-total" },
          el("td", {}, "總學分"),
          el("td", { class: "is-num" }, round(result.total.earned)),
          el("td", { class: "is-num" }, String(result.total.need)),
          el("td", {}, bar(result.total.earned, result.total.need)),
          el("td", {}, flag(result.total.met)))),
    );

    const picks = el("div", { class: "cm-rules" }, ...result.picks.map((group) => el("div", {
      class: group.met ? "cm-rule is-ok" : "cm-rule",
    },
      el("div", { class: "cm-rule-head" },
        flag(group.met), el("strong", {}, group.label),
        el("span", { class: "cm-hint" }, `${group.have} / ${group.need} 門`)),
      el("div", { class: "cm-chips" }, ...group.courses.map((course) => el("span", {
        class: course.passed ? "cm-chip is-ok" : course.taken ? "cm-chip is-taken" : "cm-chip",
        title: course.passed ? "已通過" : course.taken ? "已修但未及格" : "尚未修",
      }, course.name))),
    )));

    const liberal = el("div", { class: "cm-rules" },
      el("div", { class: result.liberal.met ? "cm-rule is-ok" : "cm-rule" },
        el("div", { class: "cm-rule-head" },
          flag(result.liberal.met), el("strong", {}, "通識博雅"),
          el("span", { class: "cm-hint" }, `${round(result.liberal.earned)} / ${result.liberal.need} 學分`)),
        bar(result.liberal.earned, result.liberal.need),
        el("div", { class: "cm-dims" }, ...result.liberal.dimensions.map((dimension) => el("div", {
          class: "cm-dim",
        },
          flag(dimension.met),
          el("span", { class: "cm-dim-name" }, dimension.name),
          el("span", { class: "cm-hint" }, `${round(dimension.earned)}/${dimension.need}`)))),
        result.liberal.unassigned > 0
          ? el("div", { class: "cm-hint" }, `不分向度 ${round(result.liberal.unassigned)} 學分`)
          : null),
    );

    const others = el("div", { class: "cm-rules" },
      result.coreLabs ? el("div", { class: result.coreLabs.met ? "cm-rule is-ok" : "cm-rule" },
        el("div", { class: "cm-rule-head" },
          flag(result.coreLabs.met), el("strong", {}, "基礎實驗課程"),
          el("span", { class: "cm-hint" }, `${result.coreLabs.have} / ${result.coreLabs.need} 門`)),
        el("div", { class: "cm-chips" }, ...result.coreLabs.items.map((item) => el("span", {
          class: item.passed ? "cm-chip is-ok" : "cm-chip", title: item.semester,
        }, item.name)))) : null,
      result.mustPass.length ? el("div", {
        class: result.mustPass.every((item) => item.passed) ? "cm-rule is-ok" : "cm-rule",
      },
        el("div", { class: "cm-rule-head" },
          flag(result.mustPass.every((item) => item.passed)), el("strong", {}, "必須修習")),
        el("div", { class: "cm-chips" }, ...result.mustPass.map((item) => el("span", {
          class: item.passed ? "cm-chip is-ok" : "cm-chip",
        }, item.name)))) : null,
    );

    const semesterTable = el("table", { class: "cm-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "學期"), el("th", { class: "is-num" }, `GPA (${state.scale})`),
        el("th", { class: "is-num" }, "平均"), el("th", { class: "is-num" }, "加權平均"),
        el("th", { class: "is-num" }, "學分"), el("th", { class: "is-num" }, "排名"),
        el("th", { class: "is-num" }, "排名%"))),
      el("tbody", {}, ...result.semesters.map((semester) => el("tr", {},
        el("td", {}, semester.label),
        el("td", { class: "is-num" }, round(semester.gpa[state.scale])),
        el("td", { class: "is-num" }, round(semester.average)),
        el("td", { class: "is-num" }, round(semester.weighted)),
        el("td", { class: "is-num" }, round(semester.credits)),
        el("td", { class: "is-num" }, semester.rank ?? "—"),
        el("td", { class: "is-num" }, semester.rankPercent == null ? "—" : `${semester.rankPercent}%`)))),
    );

    const blockers = result.graduated
      ? el("div", { class: "banner banner-success" }, "所有畢業門檻都達成了。")
      : el("div", { class: "cm-blockers" },
        el("div", { class: "cm-blockers-head" }, `還差 ${result.blockers.length} 項`),
        el("ul", {}, ...result.blockers.map((text) => el("li", {}, text))));

    // 學程、第二專長、微學程那些表沒有「最低畢業學分」, 硬畫進度條
    // 只會得到一堆 0/0 全部達標的假畫面, 所以整塊跳過。
    const grad = hasGraduation();
    return el("div", {},
      cards,
      grad ? blockers : null,
      grad ? subhead("畢業門檻") : null, grad ? thresholds : null,
      grad && result.picks.length ? subhead("必選修群組") : null,
      grad && result.picks.length ? picks : null,
      grad && result.liberal.need ? subhead("通識博雅") : null,
      grad && result.liberal.need ? liberal : null,
      grad && (result.coreLabs || result.mustPass.length) ? subhead("其他門檻") : null,
      grad && (result.coreLabs || result.mustPass.length) ? others : null,
      subhead("各學期"), semesterTable,
      subhead("歷年趨勢"), trendChart(result),
      subhead("各類學分占比"), creditPie(result),
      curriculum.rules ? subhead("學校的規定事項") : null,
      curriculum.rules ? rulesBlock() : null,
    );
  }

  /**
   * 學校規定事項的原文。
   *
   * 解析得出結構的部分上面都畫成進度了, 但解析不出來的（英文畢業門檻、
   * 校外實習抵免、中五生加修…）只有這段文字說得清楚, 而沒有畢業門檻的
   * 課表更是只剩這一段可看。預設收起來, 它很長。
   */
  function rulesBlock() {
    const body = el("p", { class: "cm-rules-text" }, curriculum.rules);
    return el("details", { class: "cm-rules-raw" },
      el("summary", {}, "展開原文"),
      body,
    );
  }

  /**
   * 環圈的一塊。
   *
   * 每段都切成不超過 90 度再畫, 這樣 large-arc-flag 永遠是 0, 
   * 也順便解決「只有一類學分時要畫整圈」的問題 ——
   * 起點與終點重合的單一弧線, SVG 會什麼都不畫。
   */
  function ringSlice(from, to, inner, outer, cx, cy) {
    const at = (angle, radius) => [
      (cx + Math.cos(angle) * radius).toFixed(2),
      (cy + Math.sin(angle) * radius).toFixed(2),
    ];
    const steps = Math.max(2, Math.ceil((to - from) / (Math.PI / 2)));
    const step = (to - from) / steps;

    let d = `M${at(from, outer).join(" ")}`;
    for (let i = 1; i <= steps; i++) d += `A${outer} ${outer} 0 0 1 ${at(from + step * i, outer).join(" ")}`;
    d += `L${at(to, inner).join(" ")}`;
    for (let i = steps - 1; i >= 0; i--) d += `A${inner} ${inner} 0 0 0 ${at(from + step * i, inner).join(" ")}`;
    return `${d}Z`;
  }

  /**
   * 各類學分占比。環圈中間預設放總學分, 指到（或點到）某一類時換成那一類。
   *
   * 滑鼠、鍵盤、觸控三種都要能用: hover 在觸控裝置上不存在, 所以「點一下釘住」
   * 才是手機上唯一的查看方式；釘住之後再點同一塊就放開。
   */
  function creditPie(result) {
    const slices = result.buckets
      .map((bucket, index) => ({ ...bucket, index }))
      .filter((slice) => slice.earned > 0);
    const total = slices.reduce((sum, slice) => sum + slice.earned, 0);
    if (!total) {
      return el("p", { class: "tool-note" }, "填了成績之後這裡會出現各類學分的占比。");
    }

    const size = 210;
    const cx = size / 2;
    const cy = size / 2;
    let angle = -Math.PI / 2;   // 從十二點鐘方向開始

    const centreValue = el("span", { class: "cm-pie-total" });
    const centreUnit = el("span", { class: "cm-pie-unit" });
    const paths = new Map();
    const rows = new Map();

    const share = (value) => Math.round((value / total) * 100);

    /** index 為 null 就回到總計。 */
    function focusSlice(index) {
      const slice = slices.find((item) => item.index === index) || null;
      centreValue.textContent = round(slice ? slice.earned : total);
      centreUnit.textContent = slice ? `${slice.label}　${share(slice.earned)}%` : "總學分";
      centreUnit.classList.toggle("is-detail", Boolean(slice));
      for (const [key, node] of paths) node.classList.toggle("is-active", key === index);
      for (const [key, node] of rows) {
        const on = key === index;
        node.classList.toggle("is-active", on);
        node.setAttribute("aria-pressed", String(on));
      }
      svg.classList.toggle("has-active", slice != null);
    }

    /** 點一下切換釘住；釘住的時候滑鼠移開不會恢復成總計。 */
    function togglePin(index) {
      pinnedBucket = pinnedBucket === index ? null : index;
      focusSlice(pinnedBucket);
    }

    for (const slice of slices) {
      const from = angle;
      angle += (slice.earned / total) * Math.PI * 2;
      const path = s("path", {
        class: `cm-slice cm-slice-${slice.index}`,
        d: ringSlice(from, angle, 56, 92, cx, cy),
        tabindex: "0",
        role: "button",
        "aria-label": `${slice.label} ${round(slice.earned)} 學分, 佔 ${share(slice.earned)}%`,
      });
      path.addEventListener("pointerenter", () => { if (pinnedBucket == null) focusSlice(slice.index); });
      path.addEventListener("focus", () => { if (pinnedBucket == null) focusSlice(slice.index); });
      path.addEventListener("click", () => togglePin(slice.index));
      path.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        togglePin(slice.index);
      });
      paths.set(slice.index, path);
    }

    const svg = s("svg", {
      class: "cm-pie", viewBox: `0 0 ${size} ${size}`,
      "aria-label": `各類學分占比, 總共 ${round(total)} 學分`,
    }, ...paths.values());
    svg.addEventListener("pointerleave", () => { if (pinnedBucket == null) focusSlice(null); });

    // 中間的數字用 HTML 疊上去而不是 SVG <text>: 類別名稱長度差很多,
    // <text> 不會自動換行, 長的名稱會直接衝出環圈。
    const ring = el("div", { class: "cm-pie-ring" },
      svg,
      el("div", { class: "cm-pie-centre" }, centreValue, centreUnit),
    );

    const legend = el("div", { class: "cm-pie-legend" }, ...result.buckets.map((bucket, index) => {
      const has = bucket.earned > 0;
      const node = el(has ? "button" : "div", {
        class: "cm-pie-item" + (has ? "" : " is-empty"),
        ...(has ? { type: "button", "aria-pressed": "false" } : {}),
      },
        el("span", { class: `cm-pie-dot cm-slice-${index}` }),
        el("span", { class: "cm-pie-name" }, bucket.label),
        el("span", { class: "cm-hint" },
          `${round(bucket.earned)} / ${bucket.need}　${share(bucket.earned)}%`),
      );
      if (!has) return node;
      node.addEventListener("pointerenter", () => { if (pinnedBucket == null) focusSlice(index); });
      node.addEventListener("pointerleave", () => { if (pinnedBucket == null) focusSlice(null); });
      node.addEventListener("focus", () => { if (pinnedBucket == null) focusSlice(index); });
      node.addEventListener("click", () => togglePin(index));
      rows.set(index, node);
      return node;
    }));

    // 上一輪釘住的那一塊如果學分歸零了就放開 —— 不然會指向一塊畫不出來的扇形。
    if (pinnedBucket != null && !slices.some((slice) => slice.index === pinnedBucket)) {
      pinnedBucket = null;
    }
    focusSlice(pinnedBucket);

    return el("div", { class: "cm-pie-wrap" }, ring, legend);
  }

  /**
   * GPA 與加權平均的趨勢圖。
   * 兩條線量級差很多（GPA 0–4.3、分數 0–100）, 各自用自己的軸: 左 GPA、右分數。
   *
   * 互動的部分: 圖例可以切掉某一條線, 指到（或用左右方向鍵移到）某個學期會
   * 出現那一學期的完整數字 —— 線圖只看得出趨勢, 要讀值還是得有這個。
   */
  function trendChart(result) {
    const points = result.semesters
      .map((semester, index) => ({ ...semester, index }))
      .filter((semester) => semester.gpa[state.scale] != null || semester.weighted != null);
    if (!points.length) {
      return el("p", { class: "tool-note" }, "填了成績之後這裡會出現歷年趨勢。");
    }

    const width = 640;
    const height = 220;
    const pad = { top: 16, right: 44, bottom: 28, left: 40 };
    const count = result.semesters.length;
    const maxGpa = Number(state.scale);
    const x = (index) => pad.left + (index / Math.max(1, count - 1)) * (width - pad.left - pad.right);
    const yGpa = (value) => height - pad.bottom - (value / maxGpa) * (height - pad.top - pad.bottom);
    const yScore = (value) => height - pad.bottom - (value / 100) * (height - pad.top - pad.bottom);

    /** 每條線的資料點, 指到某個學期時要把對應的點放大。 */
    const dots = { gpa: new Map(), score: new Map() };

    const line = (accessor, scaler, className, key) => {
      const usable = points.filter((item) => accessor(item) != null);
      if (!usable.length) return null;
      return s("g", { class: className },
        // 只有一個學期就只畫點: polyline 至少要兩個點才連得起來。
        usable.length > 1 ? s("polyline", {
          points: usable.map((item) => `${x(item.index).toFixed(1)},${scaler(accessor(item)).toFixed(1)}`).join(" "),
        }) : null,
        ...usable.map((item) => {
          const dot = s("circle", {
            cx: x(item.index).toFixed(1), cy: scaler(accessor(item)).toFixed(1), r: 3,
          });
          dots[key].set(item.index, dot);
          return dot;
        }),
      );
    };

    const guide = s("line", {
      class: "cm-guide", y1: pad.top, y2: height - pad.bottom, x1: 0, x2: 0,
    });
    const tip = el("div", { class: "cm-tip" });

    function tipRow(kind, label, value) {
      return el("div", { class: kind ? `cm-tip-row ${kind}` : "cm-tip-row" },
        el("span", { class: "cm-tip-label" }, label),
        el("span", { class: "cm-tip-value" }, value),
      );
    }

    /** 指到第 index 個學期。null = 收起來。 */
    function showAt(index) {
      trendFocus = index;
      const semester = index == null ? null : result.semesters[index];
      chart.classList.toggle("has-focus", semester != null);
      for (const key of ["gpa", "score"]) {
        for (const [at, dot] of dots[key]) dot.classList.toggle("is-active", at === index);
      }
      if (!semester) return;
      guide.setAttribute("x1", x(index).toFixed(1));
      guide.setAttribute("x2", x(index).toFixed(1));
      // 靠邊的學期把提示往內收, 不然會被容器切掉。
      const ratio = x(index) / width;
      tip.style.left = `${(ratio * 100).toFixed(2)}%`;
      tip.style.transform = `translateX(${ratio < 0.2 ? "-12%" : ratio > 0.8 ? "-88%" : "-50%"})`;
      tip.replaceChildren(
        el("div", { class: "cm-tip-head" }, semester.label),
        el("div", { class: "cm-tip-rows" },
          tipRow("is-gpa", `GPA (${state.scale})`, round(semester.gpa[state.scale])),
          tipRow("is-score", "加權平均", round(semester.weighted)),
          tipRow("", "平均", round(semester.average)),
          tipRow("", "學分", round(semester.credits)),
        ),
      );
    }

    /** 每個學期一塊透明的觸發區, 佔滿它那一欄 —— 不用精準指到那個 3px 的點。 */
    const hits = result.semesters.map((semester, index) => {
      const half = (width - pad.left - pad.right) / Math.max(1, (count - 1) * 2);
      const left = index === 0 ? pad.left : x(index) - half;
      const right = index === count - 1 ? width - pad.right : x(index) + half;
      const rect = s("rect", {
        class: "cm-hit",
        x: left.toFixed(1), y: pad.top,
        width: Math.max(1, right - left).toFixed(1),
        height: height - pad.top - pad.bottom,
      });
      rect.addEventListener("pointerenter", () => showAt(index));
      return rect;
    });

    const chart = s("svg", {
      class: "cm-chart", viewBox: `0 0 ${width} ${height}`, width: "100%",
      role: "img", tabindex: "0",
      "aria-label": "各學期 GPA 與加權平均趨勢, 用左右方向鍵逐學期查看",
    },
      ...[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = pad.top + fraction * (height - pad.top - pad.bottom);
        return s("g", {},
          s("line", { class: "cm-grid", x1: pad.left, y1: y, x2: width - pad.right, y2: y }),
          s("text", { class: "cm-axis", x: pad.left - 6, y: y + 3, "text-anchor": "end" },
            round(maxGpa * (1 - fraction), 1)),
          s("text", { class: "cm-axis", x: width - pad.right + 6, y: y + 3 },
            String(Math.round(100 * (1 - fraction)))));
      }),
      ...result.semesters.map((semester, index) => s("text", {
        class: "cm-axis", x: x(index), y: height - 8, "text-anchor": "middle",
      }, semester.label.replace("大", ""))),
      guide,
      trendSeries.score ? line((item) => item.weighted, yScore, "cm-line-score", "score") : null,
      trendSeries.gpa ? line((item) => item.gpa[state.scale], yGpa, "cm-line-gpa", "gpa") : null,
      // 觸發區疊在最上面, 才不會被線與點擋掉。
      ...hits,
    );

    chart.addEventListener("pointerleave", () => showAt(null));
    chart.addEventListener("blur", () => showAt(null));
    chart.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { showAt(null); return; }
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const from = trendFocus == null ? (step > 0 ? -1 : count) : trendFocus;
      showAt(Math.max(0, Math.min(count - 1, from + step)));
    });

    /** 圖例兼開關。最後一條線不讓它被關掉, 免得整張圖變空白。 */
    const toggle = (key, label, className) => {
      const on = trendSeries[key];
      const last = on && !Object.entries(trendSeries).some(([other, value]) => other !== key && value);
      return el("button", {
        type: "button",
        class: `cm-legend-item ${className}` + (on ? "" : " is-off"),
        "aria-pressed": String(on),
        title: last ? "至少要留一條線" : (on ? "點一下隱藏" : "點一下顯示"),
        onclick: () => {
          if (last) return;
          trendSeries[key] = !on;
          paint();
        },
      }, label);
    };

    // 進到這一輪畫面時把上次指著的學期還原。
    if (trendFocus != null && trendFocus >= count) trendFocus = null;

    const view = el("div", { class: "cm-chart-wrap" },
      el("div", { class: "cm-legend" },
        toggle("gpa", `GPA (${state.scale})`, "is-gpa"),
        toggle("score", "加權平均", "is-score"),
        el("span", { class: "cm-legend-hint" }, "點圖例切換線條, 指到圖上看單一學期")),
      el("div", { class: "cm-chart-plot" }, chart, tip),
    );
    showAt(trendFocus);
    return view;
  }

  /* ============================ 成績輸入 ============================ */

  function renderInput(result) {
    const semesterPicker = select({
      options: curriculum.semesters.map((label) => ({
        value: label,
        label: semesterOptionLabel(label, result),
      })),
      value: openSemester,
      onChange: () => { openSemester = semesterPicker.value; picker = null; paint(); },
    });
    liveSemesterSelect = semesterPicker;

    const mine = state.entries.filter((entry) => entry.semester === openSemester);
    const rows = mine.map((entry) => {
      const course = curriculumCourse(entry);
      const resolved = result.rows.find(
        (candidate) => candidate.semester === entry.semester && candidate.name === entry.name,
      );

      const score = numberInput({
        value: entry.score ?? "", min: "0", max: "100", step: "1",
        placeholder: "分數",
        onInput: () => { entry.score = score.value; save(); refreshDerived(); },
      });
      score.classList.add("cm-score");
      // 自己加的課那一列會有兩個數字輸入框（學分、分數）緊鄰著, 
      // 沒有標籤的話很容易把分數打進學分欄。
      score.setAttribute("aria-label", `${entry.name} 的分數`);
      score.dataset.field = "score";

      // 課表上的課, 學分與類別是學校定的, 不讓改；自己加的才給編輯。
      let creditCell;
      let categoryCell;
      if (course) {
        creditCell = el("td", { class: "is-num" }, String(course.credit));
        categoryCell = el("td", { class: "cm-cat" }, course.category);
      } else {
        const credit = numberInput({
          value: entry.credit ?? "", min: "0", step: "0.5",
          placeholder: "學分",
          onInput: () => { entry.credit = credit.value; save(); refreshDerived(); },
        });
        credit.classList.add("cm-score");
        credit.setAttribute("aria-label", `${entry.name} 的學分`);
        credit.dataset.field = "credit";
        const category = select({
          options: CATEGORY_OPTIONS,
          value: entry.category || "",
          onChange: () => { entry.category = category.value || undefined; persist(); },
        });
        category.classList.add("cm-mini");
        creditCell = el("td", { class: "is-num" }, credit);
        categoryCell = el("td", {}, category);
      }

      const isLiberal = /向度|^博雅/.test(entry.name) || entry.dimension;
      const dimension = isLiberal
        ? select({
          options: [
            { value: "", label: "不分向度" },
            ...curriculum.liberal.dimensions.map((name) => ({ value: name, label: name })),
          ],
          value: entry.dimension || "",
          onChange: () => { entry.dimension = dimension.value || undefined; persist(); },
        })
        : null;
      if (dimension) dimension.classList.add("cm-mini");

      const points = el("td", { class: "is-num cm-cat" }, resolved ? round(resolved.points[state.scale]) : "");
      const tr = el("tr", { class: resolved ? (resolved.passed ? "is-pass" : "is-fail") : "" },
        el("td", {},
          entry.name,
          course?.mark ? el("span", { class: "cm-mark", title: "必選修群組" }, course.mark) : null,
          dimension ? el("div", { class: "cm-row-extra" }, dimension) : null),
        categoryCell,
        creditCell,
        el("td", {}, score),
        points,
        el("td", {}, el("button", {
          type: "button", class: "cm-remove", title: "移除這門課", "aria-label": `移除 ${entry.name}`,
          onclick: () => removeEntry(entry),
        }, el("span", { html: icon("x", { size: "13px" })}))),
      );
      liveRows.push({ entry, row: tr, points });
      return tr;
    });

    const rank = state.ranks[openSemester] || {};
    const rankInput = numberInput({
      value: rank.rank ?? "", min: "1", step: "1",
      onInput: () => {
        state.ranks[openSemester] = { ...state.ranks[openSemester], rank: rankInput.value || null };
        save();
      },
    });
    const percentInput = numberInput({
      value: rank.percent ?? "", min: "0", max: "100", step: "0.1",
      onInput: () => {
        state.ranks[openSemester] = { ...state.ranks[openSemester], percent: percentInput.value || null };
        save();
      },
    });

    return el("div", {},
      row(field("學期", semesterPicker)),

      mine.length
        ? el("table", { class: "cm-table cm-input" },
          el("thead", {}, el("tr", {},
            el("th", {}, "課程"), el("th", {}, "類別"), el("th", { class: "is-num" }, "學分"),
            el("th", {}, "分數"), el("th", { class: "is-num" }, `積點 (${state.scale})`), el("th", {}, ""))),
          el("tbody", {}, ...rows))
        : el("p", { class: "tool-note" }, `${openSemester}還沒有課。按下面的「新增課程」加。`),

      picker ? renderPicker() : actions(button("＋ 新增課程", {
        variant: "primary",
        onClick: () => { picker = { source: "semester", query: "" }; paint(); },
      })),

      subhead("學期排名"),
      note("排名是學校公布的, 工具算不出來, 填進來只是跟成績放在一起看。"),
      row(field("班排名", rankInput), field("排名百分比", percentInput)),
    );
  }

  /* ============================ 新增課程 ============================ */

/**
   * 挑選清單的來源。
   *
   * 博雅那幾項是固定列出來的, 不是等全校清單載進來才長出來 ——
   * 選項要靠載入才出現的話, 想加博雅課的人根本看不到這個入口。
   * 向度名稱課程標準裡就有, 真正需要全校清單的是課程本身, 選到才載。
   */
  function pickerSources() {
    return [
      { value: "semester", label: `${openSemester}課表` },
      { value: "curriculum", label: "我的課表（全部學期）" },
      { value: "liberal:*", label: "通識博雅（全部）" },
      ...curriculum.liberal.dimensions.map((name) => ({
        value: `liberal:${name}`,
        label: `通識博雅－${name}`,
      })),
      { value: "all", label: "全校課程" },
    ];
  }

  /** 這個來源要不要用到全校課程清單。 */
  const needsPool = (source) => source === "all" || source.startsWith("liberal:");

  /** 依來源與關鍵字算出候選課程。 */
  function pickerResults() {
    const query = picker.query.trim().toLowerCase();
    const already = new Set(
      state.entries.filter((entry) => entry.semester === openSemester).map((entry) => entry.name),
    );
    const match = (name, code) => !query
      || name.toLowerCase().includes(query) || String(code || "").includes(query);

    if (picker.source === "semester" || picker.source === "curriculum") {
      const scope = picker.source === "semester"
        ? (bySemester.get(openSemester) || [])
        : curriculum.courses;
      return scope
        .filter((course) => match(course.name, course.code))
        .filter((course) => !(picker.source === "semester" && already.has(course.name)))
        .map((course) => ({
          name: course.name, credit: course.credit, code: course.code,
          meta: `${course.category}${picker.source === "curriculum" ? `・${course.semester}` : ""}`,
          category: course.category, mark: course.mark,
          fromCurriculum: course.semester === openSemester,
        }));
    }

    if (!pool) return [];

    /** 選了某個向度時, 只留掛在那個向度底下的課。 */
    const wantedDimension = picker.source.startsWith("liberal:") ? picker.source.slice(8) : null;
    const liberalOf = (course) => course.divisions
      .map((code) => pool.divisionByCode.get(code))
      .find((division) => division?.liberal);

    return pool.courses
      .filter((course) => {
        if (!wantedDimension) return true;
        const liberal = liberalOf(course);
        if (!liberal) return false;
        return wantedDimension === "*" || liberal.dimension === wantedDimension;
      })
      .filter((course) => match(course.name, course.code))
      .map((course) => {
        // 博雅課程的向度就是它掛在哪個通識中心的系所底下。
        const liberal = course.divisions
          .map((code) => pool.divisionByCode.get(code))
          .find((division) => division?.liberal);
        const owner = pool.divisionByCode.get(course.divisions[0]);
        return {
          name: course.name, credit: course.credit, code: course.code,
          meta: liberal ? `博雅・${liberal.dimension || "不分向度"}` : (owner?.name || ""),
          category: liberal ? "校定共同必修" : "",
          dimension: liberal ? (liberal.dimension || "") : "",
          fromCurriculum: curriculumIndex.has(keyOf(openSemester, course.name)),
        };
      });
  }

  function renderPicker() {
    const source = select({
      options: pickerSources(),
      value: picker.source,
      onChange: async () => {
        const next = source.value;
        // 全校與博雅都要那份大清單, 第一次用到才載。
        if (needsPool(next) && !pool) {
          source.disabled = true;
          try { await ensurePool(); } catch (error) { notify.danger(error.message); source.value = picker.source; return; }
          finally { source.disabled = false; }
        }
        picker.source = next;
        paint();
      },
    });

    const search = textInput({
      value: picker.query,
      placeholder: "搜尋課名或課號…",
      onInput: () => { picker.query = search.value; refreshList(); },
    });

    const list = el("div", { class: "cm-picker-list" });
    const count = el("span", { class: "cm-hint" });

    function refreshList() {
      const found = pickerResults();
      count.textContent = `${found.length} 門`;
      list.replaceChildren(...found.slice(0, 200).map((course) => el("button", {
        type: "button",
        class: "cm-picker-row",
        onclick: () => {
          const added = addEntry({
            semester: openSemester,
            name: course.name,
            // 課表上的課不存學分與類別, 交給課表查 —— 學校改了學分數, 
            // 使用者的資料會自動跟著更新。
            ...(course.fromCurriculum ? {} : {
              credit: String(course.credit ?? ""),
              ...(course.category ? { category: course.category } : {}),
              ...(course.dimension ? { dimension: course.dimension } : {}),
            }),
            ...(course.code ? { code: course.code } : {}),
          });
          if (added) { picker = null; persist(); }
        },
      },
        el("span", { class: "cm-picker-name" }, course.name,
          course.mark ? el("span", { class: "cm-mark" }, course.mark) : null),
        el("span", { class: "cm-picker-meta" }, course.meta),
        el("span", { class: "cm-picker-credit" }, `${course.credit} 學分`),
        el("span", { class: "cm-picker-add" }, "＋"),
      )));
      if (!found.length) {
        list.appendChild(el("p", { class: "tool-note" },
          picker.query ? "沒有符合的課程。" : "這個來源沒有課程。"));
      }
    }

    refreshList();

    return el("div", { class: "cm-picker" },
      el("div", { class: "cm-picker-head" },
        el("strong", {}, `新增課程到 ${openSemester}`),
        count,
        el("button", {
          type: "button", class: "cm-remove", title: "關閉", "aria-label": "關閉",
          onclick: () => { picker = null; paint(); },
        }, el("span", { html: icon("x", { size: "13px" }) }))),
      row(field("來源", source), field("搜尋", search)),
      list,
      note("挑「全校課程」或「博雅」時會載入一份 3000 多門課的清單（約 320 KB）, 只載一次。"),
    );
  }

  /* ============================ 同步 ============================ */

  function renderSync() {
    const sheetInput = textInput({
      value: state.sheetUrl,
      placeholder: "https://docs.google.com/spreadsheets/d/…",
      onInput: () => { state.sheetUrl = sheetInput.value; saveLocal(state); },
    });
    const scriptInput = textInput({
      value: state.scriptUrl,
      placeholder: "https://script.google.com/macros/s/…/exec",
      onInput: () => { state.scriptUrl = scriptInput.value; saveLocal(state); },
    });

    const task = (label, variant, work) => {
      const node = button(label, { variant, onClick: async () => {
        node.disabled = true;
        const original = node.textContent;
        node.textContent = "處理中…";
        try { await work(); } finally { node.disabled = false; node.textContent = original; }
      } });
      return node;
    };

    const adopt = (entries, ranks) => {
      state.entries = (entries || []).map((entry) => ({ ...entry, score: String(entry.score ?? "") }));
      if (ranks) state.ranks = ranks;
      persist();
    };

    return el("div", {},
      subhead("① 讀取  Google Sheet"),
      note("Sheet 的共用權限要設成「知道連結的人」可以檢視。只會讀取資料。"),
      field("Google Sheet 連結", sheetInput),
      actions(task("從 Sheet 讀取", "ghost", async () => {
        try {
          const entries = await readSheet(state.sheetUrl);
          adopt(entries, null);
          notify.success(`讀進 ${entries.length} 筆成績`);
        } catch (error) { notify.danger(`讀取失敗: ${error.message}`); }
      })),

      subhead("② 寫入 Google Sheet"),
      note("使用 Apps Script 來寫入 Sheet。第一次要部署一次, 之後就可以直接存取。"),
      el("ol", { class: "cm-steps" },
        el("li", {}, "在 Sheet 上開「擴充功能 → Apps Script」"),
        el("li", {}, "把下面整段程式貼進去, 取代原本的內容, 存檔"),
        el("li", {}, "按「部署 → 新增部署作業 → 類型選『網頁應用程式』」"),
        el("li", {}, "「執行身分」選 我, 「誰可以存取」選 ", el("strong", {}, "任何人")),
        el("li", {}, "按部署、授權, 複製最後那個 ", el("code", {}, "/exec"), " 網址貼到下面")),
      el("div", { class: "cm-code" },
        actions(copyButton(() => APPS_SCRIPT, { label: "複製程式碼" })),
        el("pre", {}, el("code", {}, APPS_SCRIPT))),
      field("Apps Script 部署網址", scriptInput),
      actions(
        task("儲存到 Sheet", "primary", async () => {
          try {
            const result = await pushToScript(state.scriptUrl, { ...state, entries: namedEntries() });
            notify.success(`已存 ${result.saved ?? namedEntries().length} 筆到你的 Sheet`);
          } catch (error) { notify.danger(`儲存失敗: ${error.message}`); }
        }),
        task("從 Sheet 讀回", "ghost", async () => {
          try {
            const result = await pullFromScript(state.scriptUrl);
            adopt(result.entries, result.ranks);
            notify.success(`讀回 ${(result.entries || []).length} 筆成績`);
          } catch (error) { notify.danger(`讀回失敗: ${error.message}`); }
        }),
      ),

      subhead("其他"),
      actions(
        copyButton(() => toTable(namedEntries()), { label: "複製成表格" }),
        button("清除這台瀏覽器的資料", {
          onClick: () => {
            if (!confirm("會清掉這台瀏覽器裡的成績（Sheet 上的不會動）。要繼續嗎？")) return;
            clearLocal();
            state = blankState();
            paint();
            notify.success("已清除");
          },
        }),
      ),
      note("「複製成表格」複製的是定位字元分隔的表格, 直接貼進 Sheet 就會自動分欄。"),
    );
  }

  /* ============================ 組裝 ============================ */

  const viewTabs = segmented([
    { value: "summary", label: "總覽" },
    { value: "input", label: "成績輸入" },
    { value: "sync", label: "同步" },
  ], { value: view, onChange: (next) => { view = next; picker = null; paint(); } });
  viewTabs.classList.add("cm-seg");

  const scaleTabs = segmented(SCALE_KEYS.map((scale) => ({ value: scale, label: `GPA ${scale}` })), {
    value: state.scale,
    onChange: (next) => { state.scale = next; persist(); },
  });
  scaleTabs.classList.add("cm-seg");

  /**
   * 只有一顆鈕的分頁鈕, 當開關用。
   * 外框與選到時翻白的樣式都跟上面的「檢視」「GPA 級距」共用 .tool-seg, 
   * 一眼看得出是同一類控制項。用 <button aria-pressed> 而不是
   * <input type=checkbox>, 螢幕閱讀器照樣讀得到按下與否。
   */
  const failedButton = el("button", {
    type: "button",
    class: state.includeFailed ? "tool-seg is-active" : "tool-seg",
    "aria-pressed": String(state.includeFailed),
    onclick: () => {
      state.includeFailed = !state.includeFailed;
      failedButton.classList.toggle("is-active", state.includeFailed);
      failedButton.setAttribute("aria-pressed", String(state.includeFailed));
      persist();
    },
  }, "含不及格科目");
  const failedToggle = el("div", { class: "tool-segmented cm-seg" }, failedButton);

  function paint() {
    // 上一輪的節點都要丟掉了, 參考也一起清掉, 免得抓著已經不在畫面上的東西。
    liveRows = [];
    liveSemesterSelect = null;

    const result = summarise(namedEntries(), curriculum, {
      includeFailed: state.includeFailed,
      ranks: state.ranks,
    });
    board.replaceChildren(
      view === "summary" ? renderSummary(result)
        : view === "input" ? renderInput(result)
          : renderSync(),
    );
    setStatus(result);
  }

  const refresh = refreshControl({
    items: () => [{ url: CURRICULUM_URL, label: "課程標準" }],
    onDone: ([raw]) => {
      adoptCurriculum(raw);
      paint();
    },
  });

  host.appendChild(panel(
    row(
      field("檢視", viewTabs),
      field("GPA 級距", scaleTabs),
      field("平均分數", failedToggle),
    ),
    board,
    info,
    refresh,
    note(
      "課程與畢業門檻取自北科大 ",
      el("a", { href: curriculum.source, target: "_blank", rel: "noopener" }, "課程標準"),
      "。目前的課表是 ",
      el("strong", {}, curriculum.program.heading.replace(" 課程科目表", "")),
      ", 「新增課程」可以挑全校任何一門課。",
      "「重新載入資料」抓的是本站最新已發佈的快照。",
    ),
  ));

  paint();
  return null;
}
