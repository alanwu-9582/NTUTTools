// js/tools/class-schedule/classes.js — 班級課表的查詢邏輯。
//
// 資料是 tools/build-classes.mjs 從課程系統的「上課時間表」抓下來的快照。
// 這裡不碰 DOM, 只把那份 JSON 變成「這個班在這一格上什麼課」。

import { DAY_LABELS, DAY_ORDER } from "../timetable.js";

const DATA_URL = new URL("../../../data/ntut-classes.json", import.meta.url).href;

/** 課程標準的必選修符號, 對照表在 Cprog.jsp?format=-5。 */
export const REQ_LABELS = {
  "○": "部訂共同必修",
  "△": "校定共同必修",
  "☆": "校定共同選修",
  "●": "部訂專業必修",
  "▲": "校定專業必修",
  "★": "校定專業選修",
};

/** 必修的符號是實心與三角, 選修是空心與星 —— 用來上不同顏色。 */
export const isRequired = (req) => "○△●▲".includes(req);

/** 沒有掛在任何學院底下的系所（教務處、體育室、通識中心…）。 */
const NO_COLLEGE = "校級單位";

/** 給「重新載入資料」用: 它要知道去抓哪一個檔。 */
export const CLASSES_URL = DATA_URL;

let pending = null;

/** 建索引。載入與重新載入都走這裡, 兩條路才不會長出不一樣的資料形狀。 */
function index(data) {
  return {
    ...data,
    deptByCode: new Map(data.depts.map((dept) => [dept.code, dept])),
    classByCode: new Map(data.classes.map((item) => [item.code, item])),
    // 課表頁沒有節次時間表（它在頁尾另一個小表格裡）, 這裡自己定義,
    // 順序與代號都跟 data/ntut-rooms.json 一致。
    periods: PERIODS,
  };
}

/** 載入並索引班級課表。同一頁裡只會真的抓一次。 */
export function loadClasses() {
  if (!pending) {
    pending = fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`讀不到班級課表（HTTP ${response.status}）`);
        return response.json();
      })
      .then(index)
      .catch((error) => { pending = null; throw error; });
  }
  return pending;
}

/**
 * 用剛抓回來的資料換掉模組快取。
 * 重新載入時外面已經抓過（而且是 cache: "reload" 那一次）, 這裡不要再抓。
 */
export function adoptClasses(raw) {
  const data = index(raw);
  pending = Promise.resolve(data);
  return data;
}

/**
 * 節次與時間。跟教室課表用的是同一套（學校頁尾就是這樣列的）,
 * 寫死在這裡是因為班級課表頁沒有把它放進主表格。
 */
const PERIODS = [
  { key: "1", start: "08:10", end: "09:00" },
  { key: "2", start: "09:10", end: "10:00" },
  { key: "3", start: "10:10", end: "11:00" },
  { key: "4", start: "11:10", end: "12:00" },
  { key: "N", start: "12:10", end: "13:00" },
  { key: "5", start: "13:10", end: "14:00" },
  { key: "6", start: "14:10", end: "15:00" },
  { key: "7", start: "15:10", end: "16:00" },
  { key: "8", start: "16:10", end: "17:00" },
  { key: "9", start: "17:10", end: "18:00" },
  { key: "A", start: "18:30", end: "19:20" },
  { key: "B", start: "19:20", end: "20:10" },
  { key: "C", start: "20:20", end: "21:10" },
  { key: "D", start: "21:10", end: "22:00" },
];

/** 一個班級修的所有課（已經展開成課程物件）。 */
export function coursesOf(data, item) {
  return item.courses.map((at) => data.courses[at]).filter(Boolean);
}

/**
 * 把一個班級的課攤成 Map<"day|period", course[]>。
 * 每次重畫課表都要查 98 格, 先建索引比每格都掃一遍全部課程快得多。
 */
export function gridOf(data, item) {
  const grid = new Map();
  for (const course of coursesOf(data, item)) {
    for (const [day, keys] of Object.entries(course.slots || {})) {
      for (const key of keys) {
        const at = `${day}|${key}`;
        if (!grid.has(at)) grid.set(at, []);
        grid.get(at).push(course);
      }
    }
  }
  return grid;
}

/** 系所的顯示名稱, 附上學院。 */
export function deptLabel(data, code) {
  const dept = data.deptByCode.get(code);
  if (!dept) return "";
  return dept.college ? `${dept.college}・${dept.name}` : dept.name;
}

/** 一個班級算在哪個學院下。 */
export const collegeOf = (data, item) => data.deptByCode.get(item.dept)?.college || NO_COLLEGE;

/**
 * 所有學院, 依學校頁面上的順序。「校級單位」排最後 ——
 * 體育、博雅、跨校選課這些不是使用者在找的班級。
 */
export function colleges(data) {
  const seen = [];
  for (const dept of data.depts) {
    const college = dept.college || NO_COLLEGE;
    if (!seen.includes(college)) seen.push(college);
  }
  return [...seen.filter((name) => name !== NO_COLLEGE), ...seen.filter((name) => name === NO_COLLEGE)];
}

/** 班級清單依學院分組, 給瀏覽用。順序跟 colleges() 一致。 */
export function byCollege(data, classes) {
  const groups = new Map();
  for (const item of classes) {
    const college = collegeOf(data, item);
    if (!groups.has(college)) groups.set(college, []);
    groups.get(college).push(item);
  }
  return colleges(data)
    .filter((college) => groups.has(college))
    .map((college) => ({ college, items: groups.get(college) }));
}

/**
 * 有開班的系所, 可以限定某個學院。
 * 只列真的有班級的系所 —— 選了之後結果是 0 筆的選項只會讓人以為壞了。
 */
export function depts(data, college = "") {
  const used = new Set(data.classes.map((item) => item.dept));
  return data.depts.filter((dept) => used.has(dept.code)
    && (!college || (dept.college || NO_COLLEGE) === college));
}

/** 學分與時數小計。學校頁面有「小計」那一列, 但我們沒收, 自己加。 */
export function totals(data, item) {
  const courses = coursesOf(data, item);
  const credits = courses.reduce((sum, course) => sum + (Number(course.credit) || 0), 0);
  const scheduled = courses.filter((course) => Object.keys(course.slots || {}).length);
  return {
    count: courses.length,
    credits: Math.round(credits * 10) / 10,
    unscheduled: courses.length - scheduled.length,
  };
}

/** 這門課的上課時間, 寫成「一 3 4　三 6」。 */
export function slotText(course) {
  return DAY_ORDER
    .filter((day) => course.slots?.[day]?.length)
    .map((day) => `${DAY_LABELS[day]} ${course.slots[day].join(" ")}`)
    .join("　") || "未排定";
}
