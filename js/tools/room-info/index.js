// js/tools/room-info/index.js — 教室資訊。
//
// 兩件事:
//   查教室    搜尋教室 → 點開看一週課表、空堂區間, 以及現在是不是空的
//   找空教室  指定星期與節次（預設是現在）→ 列出那一格空著的教室
//
// 資料是 data/ntut-rooms.json, 由 tools/build-rooms.mjs 從課程系統抓的快照。
// 學校網站沒有 CORS 標頭, 所以不能在瀏覽器裡即時查, 只能定期重抓。

import {
  panel, row, field, segmented, select, textInput, button, status, note, el, icon,
} from "../kit.js";
import { normalizeText, debounce, highlightTerms, queryTerms } from "../../utils/utils.js";
import { openModal, closeModal } from "../../ui/modal.js";
import {
  timetable, timetablePicker, timetableStyles, timetableLegend,
  DAY_LABELS, DAY_ORDER, periodLabel, slotKey,
} from "../timetable.js";
import {
  loadRooms, entriesAt, isFree, currentSlot, freeRooms, freeRoomsAtAll, freeRanges,
  usage, courseLine, byBuilding, sortSlots, slotLabel,
} from "./rooms.js";

export const styles = [timetableStyles, new URL("./room-info.css", import.meta.url).href];

export const meta = { title: "教室資訊" };

/**
 * 一次最多畫幾棟樓。
 *
 * 分頁是按「棟」而不是按「間」: 用總間數截斷會把某一棟切成一半, 看起來
 * 像那棟只有 3 間教室。20 棟裡先給 6 棟, 剩下的一鍵展開。
 */
const PAGE = 6;

export async function mount(host, { params, setParams } = {}) {
  const info = status();
  const board = el("div", { class: "ri-board" });

  let data;
  try {
    data = await loadRooms();
  } catch (error) {
    host.appendChild(panel(el("div", { class: "banner banner-danger" }, error.message)));
    return null;
  }

  const now = currentSlot(data);
  const state = {
    mode: params?.get("mode") === "free" ? "free" : "rooms",
    query: params?.get("q") || "",
    day: clampDay(params?.get("d")) ?? now.day,
    period: data.periodAt.has(params?.get("p")) ? params.get("p") : now.period,
    room: data.roomByCode.get(params?.get("room")) || null,
    // 多時段查詢。有東西的時候就蓋掉上面的單一星期／節次。
    slots: readSlots(params?.get("slots")),
    limit: PAGE,
  };

  /** 網址上的 "3|1,3|2" → Set。認不出來的格子直接丟掉。 */
  function readSlots(raw) {
    const out = new Set();
    for (const piece of String(raw || "").split(",")) {
      const [day, period] = piece.split("|");
      if (clampDay(day) == null || !data.periodAt.has(period)) continue;
      out.add(slotKey(Number(day), period));
    }
    return out;
  }

  /** 網址上的星期。缺值要回 null 而不是 0 —— Number(null) 是 0, 就變成週日了。 */
  function clampDay(raw) {
    if (raw == null || raw === "") return null;
    const day = Number(raw);
    return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
  }

  /** 把目前的檢視寫回網址, 一間教室的課表就能直接分享。 */
  function syncUrl() {
    setParams?.({
      mode: state.mode === "rooms" ? "" : state.mode,
      room: state.room?.code || "",
      q: state.room ? "" : state.query,
      d: state.mode === "free" && !state.room && !state.slots.size ? String(state.day) : "",
      p: state.mode === "free" && !state.room && !state.slots.size ? state.period : "",
      slots: state.mode === "free" && !state.room
        ? sortSlots(data, state.slots).join(",")
        : "",
    });
  }

  const periodOf = (key) => data.periods[data.periodAt.get(key)];

  /** 「現在」那一格的說明, 兩種模式的狀態列都用它。 */
  function nowLine() {
    const period = periodOf(now.period);
    const when = `週${DAY_LABELS[now.day]} ${periodLabel(now.period)}（${period.start}–${period.end}）`;
    return now.live ? `現在是 ${when}` : `現在是下課時間, 接下來是 ${when}`;
  }

  function setStatus() {
    info.set(`${nowLine()}　·　${data.year} 學年度第 ${data.sem} 學期・抓取日 ${data.generated}`, "ok");
  }

  /* ============================ 教室清單 ============================ */

  /** 搜尋比對簡稱與全名, 兩個都常用（「二教201」與「第二教學大樓」）。 */
  function matches(room, terms) {
    if (!terms.length) return true;
    const hay = normalizeText(`${room.name} ${room.full}`);
    return terms.every((term) => hay.includes(term));
  }

  /** 一列教室。右邊那塊隨模式換: 查教室看現在狀態, 找空教室看座位數。 */
  function roomRow(room, terms) {
    const entries = entriesAt(data, room, now.day, now.period);
    const free = !entries.length;
    return el("button", {
      type: "button",
      class: "ri-row",
      onclick: () => { state.room = room; paint(); },
    },
      el("span", { class: "ri-row-main" },
        el("span", { class: "ri-row-name", html: highlightTerms(room.name, terms) }),
        el("span", { class: "ri-row-full", html: highlightTerms(room.full, terms) }),
      ),
      el("span", { class: "ri-row-side" },
        room.seats ? el("span", { class: "ri-seats" }, `${room.seats} 座`) : null,
        state.mode === "rooms"
          ? el("span", { class: free ? "ri-pill is-free" : "ri-pill is-busy" },
            free ? "現在空著" : entries[0].name)
          : null,
      ),
    );
  }

  /**
   * 清單依大樓分組 + 「全部顯示」。
   *
   * 231 間教室平鋪成一片時, 名字長得都很像, 眼睛沒有落腳的地方。分組之後
   * 「二教有幾間空的」這種問題才看得出答案。
   */
  function roomList(rooms, terms) {
    const groups = byBuilding(data, rooms);
    const shown = groups.slice(0, state.limit);
    const hidden = groups.length - shown.length;
    return el("div", { class: "ri-groups" },
      ...shown.map((group) => el("div", { class: "ri-group" },
        el("div", { class: "ri-group-head" },
          group.label,
          el("span", { class: "ri-group-count" }, groupCount(group.rooms)),
        ),
        el("div", { class: "ri-list" }, ...group.rooms.map((room) => roomRow(room, terms))),
      )),
      hidden > 0
        ? el("div", { class: "ri-more" }, button(`還有 ${hidden} 棟, 全部顯示`, {
          onClick: () => { state.limit = Infinity; paint(); },
        }))
        : null,
    );
  }

  /** 一組的計數。查教室時順便報這一棟現在空幾間。 */
  function groupCount(rooms) {
    if (state.mode !== "rooms") return `${rooms.length} 間`;
    const free = rooms.filter((room) => isFree(data, room, now.day, now.period)).length;
    return `${rooms.length} 間・現在空 ${free}`;
  }

  function emptyBlock(message) {
    return el("div", { class: "state-block" },
      el("span", { class: "ico", html: icon("search", { size: "30px" }) }),
      el("div", { class: "st-title" }, "沒有符合的教室"),
      el("div", { class: "st-msg" }, message),
    );
  }

  /* ============================ 查教室 ============================ */

  function renderRooms() {
    const search = textInput({
      value: state.query,
      placeholder: "搜尋教室, 例如「二教201」或「第二教學大樓」…",
      onInput: debounce(() => {
        state.query = search.value;
        state.limit = PAGE;
        repaintResults();
      }, 80),
    });

    const results = el("div", { class: "ri-results" });
    const count = el("span", { class: "ri-count" });

    function repaintResults() {
      const terms = queryTerms(state.query);
      const found = data.rooms.filter((room) => matches(room, terms));
      const free = found.filter((room) => isFree(data, room, now.day, now.period)).length;
      count.replaceChildren(
        el("strong", {}, String(found.length)),
        ` 間教室・現在空著 `,
        el("strong", {}, String(free)),
        " 間",
      );
      results.replaceChildren(found.length
        ? roomList(found, terms)
        : emptyBlock("換個關鍵字, 例如樓名或房號。"));
      syncUrl();
    }

    // 搜尋框重畫時焦點會掉, 所以只有結果那塊自己重畫。
    const view = el("div", {},
      field("搜尋教室", search),
      el("div", { class: "ri-meta" }, count),
      results,
    );
    repaintResults();
    return view;
  }

  /* ============================ 找空教室 ============================ */

  /** 目前查的是哪些時段。單一時段時就是一格。 */
  function activeSlots() {
    return state.slots.size ? sortSlots(data, state.slots) : [slotKey(state.day, state.period)];
  }

  /**
   * 挑時段的對話框。改的是一份副本, 按「查詢」才套用 ——
   * 按 Esc 或關閉不應該動到已經查出來的結果。
   */
  function openSlotPicker() {
    const draft = new Set(state.slots.size ? state.slots : [slotKey(state.day, state.period)]);
    const summary = el("p", { class: "tool-note" });
    const apply = el("button", { type: "button", class: "btn btn-primary" }, "查詢");

    const sync = () => {
      summary.textContent = draft.size
        ? `已選 ${draft.size} 個時段: ${sortSlots(data, draft).map(slotLabel).join("、")}`
        : "還沒選任何時段。";
      apply.disabled = draft.size === 0;
    };

    const grid = timetablePicker({ periods: data.periods, selected: draft, onChange: sync });
    const clear = el("button", { type: "button", class: "btn btn-ghost" }, "全部清除");
    clear.addEventListener("click", () => { draft.clear(); grid.repaint(); sync(); });
    apply.addEventListener("click", () => {
      state.slots = new Set(draft);
      state.limit = PAGE;
      closeModal();
      paint();
    });

    sync();
    openModal({
      title: "選擇多個時段",
      body: el("div", { class: "ri-picker" },
        note("點格子選時段, 點星期或節次可以切換一整欄／一整列。"),
        grid,
        summary,
      ),
      footer: el("div", { class: "ri-picker-foot" }, clear, apply),
      maxWidth: "760px",
    });
  }

  function renderFree() {
    const daySelect = select({
      options: DAY_ORDER.map((day) => ({ value: String(day), label: `週${DAY_LABELS[day]}` })),
      value: String(state.day),
      onChange: () => { state.day = Number(daySelect.value); state.limit = PAGE; paint(); },
    });

    const periodSelect = select({
      options: data.periods.map((period) => ({
        value: period.key,
        label: `${periodLabel(period.key)}　${period.start}–${period.end}`,
      })),
      value: state.period,
      onChange: () => { state.period = periodSelect.value; state.limit = PAGE; paint(); },
    });

    const search = textInput({
      value: state.query,
      placeholder: "只看某棟樓, 例如「二教」…",
      onInput: debounce(() => {
        state.query = search.value;
        state.limit = PAGE;
        repaintResults();
      }, 80),
    });

    const atNow = state.day === now.day && state.period === now.period;
    const jump = button(atNow ? "已是現在" : "回到現在", {
      variant: atNow ? "ghost" : "primary",
      onClick: () => {
        state.day = now.day;
        state.period = now.period;
        state.limit = PAGE;
        paint();
      },
    });
    jump.disabled = atNow;

    const multi = state.slots.size > 0;
    const pick = button(multi ? "改選時段" : "選多個時段", {
      variant: multi ? "ghost" : "primary",
      onClick: openSlotPicker,
    });
    const clearSlots = button("回到單一時段", {
      onClick: () => { state.slots = new Set(); state.limit = PAGE; paint(); },
    });

    const results = el("div", { class: "ri-results" });
    const count = el("span", { class: "ri-count" });

    function repaintResults() {
      const terms = queryTerms(state.query);
      const slots = activeSlots();
      const found = (multi
        ? freeRoomsAtAll(data, slots)
        : freeRooms(data, state.day, state.period)
      ).filter((room) => matches(room, terms));

      if (multi) {
        count.replaceChildren(
          `${slots.length} 個時段都空著 `,
          el("strong", {}, String(found.length)),
          " 間",
        );
      } else {
        const period = periodOf(state.period);
        count.replaceChildren(
          `週${DAY_LABELS[state.day]} ${periodLabel(state.period)}（${period.start}–${period.end}）空著 `,
          el("strong", {}, String(found.length)),
          " 間",
        );
      }

      results.replaceChildren(found.length
        ? roomList(found, terms)
        : emptyBlock(multi
          ? "沒有教室在這些時段全部都空著。少選幾個時段試試。"
          : "這個時段沒有空教室, 換個節次看看。"));
      syncUrl();
    }

    // 多時段時把單一星期／節次收起來 —— 兩套條件同時擺著只會讓人猜哪個在生效。
    const view = el("div", {},
      multi
        ? el("div", { class: "ri-slots" },
          el("div", { class: "ri-slots-head" }, "查詢時段",
            el("span", { class: "ri-group-count" }, `${state.slots.size} 個`)),
          el("div", { class: "ri-slots-chips" },
            ...activeSlots().map((key) => el("span", { class: "ri-chip" }, slotLabel(key)))),
          el("div", { class: "tool-actions" }, pick, clearSlots),
        )
        : el("div", {},
          row(
            field("星期", daySelect),
            field("節次", periodSelect),
            field("快速跳回", jump),
            field("多時段查詢", pick),
          ),
        ),
      field("篩選", search),
      el("div", { class: "ri-meta" }, count),
      results,
    );
    repaintResults();
    return view;
  }

  /* ============================ 單一教室 ============================ */

  function renderDetail(room) {
    const entries = entriesAt(data, room, now.day, now.period);
    const period = periodOf(now.period);
    const stats = usage(room);

    const nowCard = el("div", { class: entries.length ? "ri-now is-busy" : "ri-now is-free" },
      el("div", { class: "ri-now-head" },
        el("span", { class: entries.length ? "ri-pill is-busy" : "ri-pill is-free" },
          entries.length ? "有課" : "空著"),
        el("span", { class: "ri-now-when" },
          `${now.live ? "現在" : "接下來"}・週${DAY_LABELS[now.day]} ${periodLabel(now.period)} ${period.start}–${period.end}`),
      ),
      entries.length
        ? el("div", { class: "ri-now-body" }, ...entries.map((course) => el("div", {}, courseLine(course))))
        : el("div", { class: "ri-now-body" }, now.live ? "這一節沒有排課。" : "下一節沒有排課。"),
    );

    // 一天一列, 把連續的空堂併成區間 —— 一節一節列出來太碎。
    const freeList = el("div", { class: "ri-free-days" }, ...DAY_ORDER.map((day) => {
      const label = DAY_LABELS[day];
      const ranges = freeRanges(data, room, day);
      return el("div", { class: "ri-free-day" },
        el("span", { class: "ri-free-label" }, `週${label}`),
        ranges.length
          ? el("span", { class: "ri-free-chips" }, ...ranges.map((range) => el("span", {
            class: "ri-chip",
            title: `${range.from.start}–${range.to.end}`,
          }, range.from === range.to
            ? periodLabel(range.from.key)
            : `第 ${range.from.key}–${range.to.key} 節`)))
          : el("span", { class: "ri-free-none" }, "整天都有課"),
      );
    }));

    return el("div", { class: "ri-detail" },
      el("button", {
        type: "button",
        class: "ri-back",
        onclick: () => { state.room = null; paint(); },
      }, el("span", { class: "ri-back-ico", "aria-hidden": "true" }, "←"), "返回教室清單"),

      el("div", { class: "ri-detail-head" },
        el("h3", { class: "ri-detail-name" }, room.name),
        el("span", { class: "ri-detail-full" }, room.full),
        // 空堂數不寫出來 —— 週末與深夜的節次沒人在算, 寫了反而誤導。
        el("span", { class: "ri-detail-stats" },
          room.seats ? `${room.seats} 座・` : "",
          `一週 ${stats.used} 節有課`),
      ),

      nowCard,
      el("div", { class: "tool-subhead" }, "空堂"),
      freeList,
      el("div", { class: "tool-subhead" }, "一週課表"),
      timetable({
        periods: data.periods,
        now,
        cell: (day, key) => entriesAt(data, room, day, key).map((course) => ({
          title: course.name,
          subs: [(course.classes || []).join("、")],
        })),
      }),
      timetableLegend(el("span", { class: "tt-legend-item" })),
    );
  }

  /* ============================ 組裝 ============================ */

  const modeTabs = segmented([
    { value: "rooms", label: "查教室" },
    { value: "free", label: "找空教室" },
  ], {
    value: state.mode,
    onChange: (next) => {
      state.mode = next;
      state.room = null;
      state.query = "";
      state.slots = new Set();
      state.limit = PAGE;
      paint();
    },
  });

  function paint() {
    modeTabs.select(state.mode);
    board.replaceChildren(state.room
      ? renderDetail(state.room)
      : state.mode === "free" ? renderFree() : renderRooms());
    setStatus();
    syncUrl();
  }

  host.appendChild(panel(
    row(field("查詢方式", modeTabs)),
    board,
    info,
    note(
      "資料取自北科大 ",
      el("a", { href: data.source, target: "_blank", rel: "noopener" }, "教室使用情形一覽表"),
      "。實際借用狀況以教務處公告為準。",
    ),
  ));

  paint();
  // 離開工具頁時對話框要跟著收 —— 不然它會留在畫面上, 而它的按鈕已經沒有主人。
  return () => closeModal();
}
