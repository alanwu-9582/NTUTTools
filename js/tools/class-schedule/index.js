// js/tools/class-schedule/index.js — 班級課表。
//
// 搜尋或依學院瀏覽班級 → 看那一班的一週課表與完整課程清單。
//
// 資料是 data/ntut-classes.json, 由 tools/build-classes.mjs 從課程系統抓的快照。
// 課表格線與空／忙配色跟教室資訊共用 ../timetable.js。

import { panel, row, field, select, textInput, status, note, el, icon } from "../kit.js";
import { normalizeText, debounce, highlightTerms, queryTerms } from "../../utils/utils.js";
import { timetable, timetableStyles, timetableLegend } from "../timetable.js";
import { refreshControl } from "../../services/data-refresh.js";
import {
  loadClasses, adoptClasses, CLASSES_URL, coursesOf, gridOf, deptLabel, byCollege,
  colleges, collegeOf, depts, totals, slotText, REQ_LABELS, isRequired,
} from "./classes.js";

export const styles = [timetableStyles, new URL("./class-schedule.css", import.meta.url).href];

export const meta = { title: "班級課表" };

export async function mount(host, { params, setParams } = {}) {
  const info = status();
  const board = el("div", { class: "cs-board" });

  let data;
  try {
    data = await loadClasses();
  } catch (error) {
    host.appendChild(panel(el("div", { class: "banner banner-danger" }, error.message)));
    return null;
  }

  const state = {
    query: params?.get("q") || "",
    college: colleges(data).includes(params?.get("college")) ? params.get("college") : "",
    dept: data.deptByCode.has(params?.get("dept")) ? params.get("dept") : "",
    item: data.classByCode.get(params?.get("class")) || null,
  };
  // 網址上的系所如果不屬於網址上的學院, 學院說了算 —— 兩個對不起來的話
  // 系所那個下拉根本不會有那個選項。
  if (state.dept && !depts(data, state.college).some((dept) => dept.code === state.dept)) {
    state.dept = "";
  }

  function syncUrl() {
    setParams?.({
      class: state.item?.code || "",
      q: state.item ? "" : state.query,
      college: state.item ? "" : state.college,
      dept: state.item ? "" : state.dept,
    });
  }

  function setStatus() {
    info.set(
      `${data.classes.length} 個班級　·　${data.year} 學年度第 ${data.sem} 學期・抓取日 ${data.generated}`,
      "ok",
    );
  }

  /* ============================ 班級清單 ============================ */

  /** 搜尋比對班名與系所名, 「車輛二」與「車輛系」都找得到。 */
  function matches(item, terms) {
    if (state.college && collegeOf(data, item) !== state.college) return false;
    if (state.dept && item.dept !== state.dept) return false;
    if (!terms.length) return true;
    const hay = normalizeText(`${item.name} ${deptLabel(data, item.dept)}`);
    return terms.every((term) => hay.includes(term));
  }

  function classChip(item, terms) {
    return el("button", {
      type: "button",
      class: "cs-chip",
      title: deptLabel(data, item.dept),
      onclick: () => { state.item = item; paint(); },
    }, el("span", { html: highlightTerms(item.name, terms) }));
  }

  function renderList() {
    const search = textInput({
      value: state.query,
      placeholder: "搜尋班級, 例如「車輛二」或「資工」…",
      onInput: debounce(() => { state.query = search.value; repaint(); }, 80),
    });

    const results = el("div", { class: "cs-results" });
    const count = el("span", { class: "cs-count" });

    // 系所那一格會隨學院重建, 所以放個容器讓它自己換內容, 不用整塊重畫。
    const deptSlot = el("div", { class: "cs-dept-slot" });

    const collegeSelect = select({
      options: [
        { value: "", label: "請選擇學院" },
        ...colleges(data).map((college) => ({ value: college, label: college })),
      ],
      value: state.college,
      onChange: () => {
        state.college = collegeSelect.value;
        // 換學院時舊的系所大多不在新學院底下, 一律清掉比留著一個矛盾的條件好。
        state.dept = "";
        paintDept();
        repaint();
      },
    });

    function paintDept() {
      const options = depts(data, state.college);
      const deptSelect = select({
        options: [
          { value: "", label: state.college ? "請選擇系所" : "請先選擇學院" },
          ...options.map((dept) => ({ value: dept.code, label: dept.name })),
        ],
        value: state.dept,
        onChange: () => { state.dept = deptSelect.value; repaint(); },
      });
      deptSelect.disabled = !state.college;
      deptSlot.replaceChildren(deptSelect);
    }

    function repaint() {
      const terms = queryTerms(state.query);
      const ready = Boolean(state.college && state.dept);
      const found = ready ? data.classes.filter((item) => matches(item, terms)) : [];
      count.hidden = !ready;
      if (ready) count.replaceChildren(el("strong", {}, String(found.length)), " 個班級");
      results.replaceChildren(...(!ready
        ? [el("div", { class: "state-block" },
          el("span", { class: "ico", html: icon("calendar", { size: "30px" }) }),
          el("div", { class: "st-title" }, state.college ? "請選擇系所" : "請先選擇學院與系所"),
          el("div", { class: "st-msg" }, "選好後會顯示該系所的班級。"))]
        : found.length
        ? byCollege(data, found).map((group) => el("div", { class: "cs-group" },
          el("div", { class: "cs-group-head" }, group.college,
            el("span", { class: "cs-group-count" }, `${group.items.length} 班`)),
          el("div", { class: "cs-chips" }, ...group.items.map((item) => classChip(item, terms))),
        ))
        : [el("div", { class: "state-block" },
          el("span", { class: "ico", html: icon("search", { size: "30px" }) }),
          el("div", { class: "st-title" }, "沒有符合的班級"),
          el("div", { class: "st-msg" }, "換個關鍵字, 例如班級或年級。"))]));
      syncUrl();
    }

    // 搜尋框重畫時焦點會掉, 所以只有結果那塊自己重畫。
    const view = el("div", {},
      field("搜尋班級", search),
      row(field("學院", collegeSelect), field("系所", deptSlot)),
      el("div", { class: "cs-meta" }, count),
      results,
    );
    paintDept();
    repaint();
    return view;
  }

  /* ============================ 單一班級 ============================ */

  function renderDetail(item) {
    const grid = gridOf(data, item);
    const courses = coursesOf(data, item);
    const sum = totals(data, item);
    const unscheduled = courses.filter((course) => !Object.keys(course.slots || {}).length);

    const table = el("table", { class: "cs-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "課號"), el("th", {}, "課程名稱"), el("th", {}, "修別"),
        el("th", { class: "is-num" }, "學分"), el("th", {}, "時間"),
        el("th", {}, "教師"), el("th", {}, "教室"))),
      el("tbody", {}, ...courses.map((course) => el("tr", {},
        el("td", { class: "cs-snum" }, course.snum || "—"),
        el("td", {},
          course.name,
          course.note ? el("span", { class: "cs-note" }, course.note) : null,
          course.lang ? el("span", { class: "cs-lang" }, course.lang) : null),
        el("td", {}, course.req
          ? el("span", {
            class: isRequired(course.req) ? "cs-req is-must" : "cs-req",
          }, REQ_LABELS[course.req] || course.req)
          : ""),
        el("td", { class: "is-num" }, course.credit != null ? String(course.credit) : "—"),
        el("td", { class: "cs-when" }, slotText(course)),
        el("td", {}, (course.teachers || []).join("、") || "—"),
        el("td", {}, (course.rooms || []).join("、") || "—"),
      ))),
    );

    return el("div", { class: "cs-detail" },
      el("button", {
        type: "button",
        class: "cs-back",
        onclick: () => { state.item = null; paint(); },
      }, el("span", { "aria-hidden": "true" }, "←"), "返回班級清單"),

      el("div", { class: "cs-detail-head" },
        el("h3", { class: "cs-detail-name" }, item.name),
        el("span", { class: "cs-detail-dept" }, deptLabel(data, item.dept)),
        el("span", { class: "cs-detail-stats" },
          `${sum.count} 門課・${sum.credits} 學分`
          + (sum.unscheduled ? `・${sum.unscheduled} 門未排時間` : "")),
      ),

      el("div", { class: "tool-subhead" }, "一週課表"),
      timetable({
        periods: data.periods,
        cell: (day, key) => (grid.get(`${day}|${key}`) || []).map((course) => ({
          title: course.name,
          subs: [(course.rooms || []).join("、"), (course.teachers || []).join("、")],
        })),
      }),
      timetableLegend(),

      el("div", { class: "tool-subhead" }, "課程清單"),
      el("div", { class: "cs-table-wrap" }, table),
      unscheduled.length
        ? note(`未排定上課時間: ${unscheduled.map((course) => course.name).join("、")}`)
        : null,
    );
  }

  /* ============================ 組裝 ============================ */

  function paint() {
    board.replaceChildren(state.item ? renderDetail(state.item) : renderList());
    setStatus();
    syncUrl();
  }

  const refresh = refreshControl({
    items: () => [{ url: CLASSES_URL, label: "班級課表" }],
    onDone: ([raw]) => {
      data = adoptClasses(raw);
      // 選到的班級是舊物件, 用代號重新指到新的那一份。
      if (state.item) state.item = data.classByCode.get(state.item.code) || null;
      paint();
    },
  });

  host.appendChild(panel(
    board,
    info,
    refresh,
    note(
      "資料取自北科大 ",
      el("a", { href: data.source, target: "_blank", rel: "noopener" }, "上課時間表"),
      "。加退選後的異動以課程系統為準。「重新載入資料」抓的是本站最新已發佈的快照。",
    ),
  ));

  paint();
  return null;
}
