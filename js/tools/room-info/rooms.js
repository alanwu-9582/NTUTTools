// js/tools/room-info/rooms.js — 教室課表的查詢邏輯。
//
// 資料是 tools/build-rooms.mjs 從課程系統的「教室使用情形一覽表」抓下來的快照。
// 這裡不碰 DOM, 只把那份 JSON 變成「這一格有沒有課」「哪些教室現在空著」。

import { DAY_LABELS, DAY_ORDER } from "../timetable.js";

const DATA_URL = new URL("../../../data/ntut-rooms.json", import.meta.url).href;

const minutesOf = (time) => {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
};

let pending = null;

/** 載入並索引課表。同一頁裡只會真的抓一次。 */
export function loadRooms() {
  if (!pending) {
    pending = fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`讀不到教室課表（HTTP ${response.status}）`);
        return response.json();
      })
      .then((data) => ({
        ...data,
        periodAt: new Map(data.periods.map((period, at) => [period.key, at])),
        roomByCode: new Map(data.rooms.map((room) => [room.code, room])),
      }))
      .catch((error) => { pending = null; throw error; });
  }
  return pending;
}

/** 某間教室在某一格上的課。空堂就是空陣列。 */
export function entriesAt(data, room, day, period) {
  const indices = room.slots[`${day}|${period}`];
  if (!indices) return [];
  return indices.map((at) => data.courses[at]).filter(Boolean);
}

export const isFree = (data, room, day, period) => !entriesAt(data, room, day, period).length;

/**
 * 「現在」對應到哪一格。
 *
 * 正在上課就是那一節（live）。下課時間或還沒開始上課, 就往後找待會的那一節 ——
 * 使用者在下課空檔查空教室, 想知道的是接下來那節能不能用, 而不是剛結束的那節。
 * 一天的課都上完了就跳到隔天第一節。
 *
 * @returns {{ day: number, period: string, live: boolean }}
 */
export function currentSlot(data, now = new Date()) {
  const day = now.getDay();
  const at = now.getHours() * 60 + now.getMinutes();

  const inside = data.periods.find(
    (period) => at >= minutesOf(period.start) && at < minutesOf(period.end),
  );
  if (inside) return { day, period: inside.key, live: true };

  const next = data.periods.find((period) => minutesOf(period.start) > at);
  if (next) return { day, period: next.key, live: false };

  return { day: (day + 1) % 7, period: data.periods[0].key, live: false };
}

/** 某一格空著的所有教室, 依教室簡稱排序（資料本身就是這個順序）。 */
export function freeRooms(data, day, period) {
  return data.rooms.filter((room) => isFree(data, room, day, period));
}

/**
 * 一整天裡連續的空堂區間, 例如「第 3–5 節」。
 * 一節一節列出來太碎, 併成區間才看得出「這段時間都能用」。
 * @returns {Array<{ from: object, to: object }>} 節次物件（含時間）
 */
export function freeRanges(data, room, day) {
  const ranges = [];
  let open = null;
  for (const period of data.periods) {
    if (isFree(data, room, day, period.key)) {
      if (!open) open = { from: period, to: period };
      else open.to = period;
    } else if (open) {
      ranges.push(open);
      open = null;
    }
  }
  if (open) ranges.push(open);
  return ranges;
}

/** 一週有排課的節數, 給教室詳情用。 */
export function usage(room) {
  return { used: Object.keys(room.slots).length };
}

/* ---------------- 大樓 ---------------- */

/**
 * 幾間名字裡沒有樓名的教室。它們的全名（綜合科館第二演講廳、共同科館演講廳、
 * 科技研究大樓EMBA…）證實跟哪一棟是同一棟, 所以直接指定。
 */
const BUILDING_ALIAS = {
  綜二演講廳: "綜科",
  綜三演講廳: "綜科",
  共同演講廳: "共同",
  科研哈佛講堂: "科研大樓",
};

/** 有把握的正式樓名（來自資料裡的教室全名）。其餘就用大家在講的簡稱。 */
const BUILDING_LABEL = {
  一教: "第一教學大樓",
  二教: "第二教學大樓",
  三教: "第三教學大樓",
  四教: "第四教學大樓",
  五教: "第五教學大樓",
  六教: "第六教學大樓",
  綜科: "綜合科館",
  共同: "共同科館",
  科研大樓: "科技研究大樓",
};

/**
 * 教室簡稱切到第一個房號之前, 剩下的就是樓名: 「二教201(e)」→「二教」。
 * 房號可能是 201、B02、1F, 後面還可能黏著 (e)、_1、字母, 所以尾巴的
 * 英數與符號要再刮一次（「分子BR6」→「分子」）。
 */
export function buildingOf(room) {
  if (BUILDING_ALIAS[room.name]) return BUILDING_ALIAS[room.name];
  const head = /^(.*?)(?=B?\d|\dF)/.exec(room.name)?.[1] ?? room.name;
  return head.replace(/[A-Za-z_\s()（）]+$/, "") || room.name;
}

/** 大樓的顯示名稱。 */
export const buildingLabel = (key) => BUILDING_LABEL[key] || key;

/** 所有大樓, 依教室清單裡第一次出現的順序（學校頁面本來就從一教排到六教）。 */
export function buildings(data) {
  const seen = [];
  for (const room of data.rooms) {
    const key = buildingOf(room);
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** 教室依大樓分組, 順序跟 buildings() 一致。 */
export function byBuilding(data, rooms) {
  const groups = new Map();
  for (const room of rooms) {
    const key = buildingOf(room);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(room);
  }
  return buildings(data)
    .filter((key) => groups.has(key))
    .map((key) => ({ key, label: buildingLabel(key), rooms: groups.get(key) }));
}

/* ---------------- 多時段 ---------------- */

/**
 * 在「全部」指定的時段都空著的教室。
 * 傳進來的是 timetable.js 的 slotKey 字串（"3|1" = 週三第 1 節）,
 * 跟 room.slots 的鍵剛好同一個格式, 所以直接查就好。
 */
export function freeRoomsAtAll(data, slotKeys) {
  const keys = [...slotKeys];
  if (!keys.length) return [];
  return data.rooms.filter((room) => keys.every((key) => !room.slots[key]));
}

/** 一個 slotKey 讀成人看得懂的字: 「週三 第 1 節」。 */
export function slotLabel(key) {
  const [day, period] = String(key).split("|");
  return `週${DAY_LABELS[Number(day)]} 第 ${period} 節`;
}

/** 把選到的時段排成畫面上的順序: 先依星期, 再依節次。 */
export function sortSlots(data, slotKeys) {
  const order = new Map(data.periods.map((period, at) => [period.key, at]));
  const dayOrder = new Map(DAY_ORDER.map((day, at) => [day, at]));
  return [...slotKeys].sort((a, b) => {
    const [dayA, periodA] = a.split("|");
    const [dayB, periodB] = b.split("|");
    return dayOrder.get(Number(dayA)) - dayOrder.get(Number(dayB))
      || order.get(periodA) - order.get(periodB);
  });
}

/** 這門課要顯示成一行字: 課名 + 班級。 */
export function courseLine(course) {
  const classes = (course.classes || []).join("、");
  return classes ? `${course.name}・${classes}` : course.name;
}
