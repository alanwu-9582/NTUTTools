// tools/build-rooms.mjs — 抓全校教室課表, 產生 data/ntut-rooms.json。
//
//   node tools/build-rooms.mjs             重新抓、寫檔
//   node tools/build-rooms.mjs --check     只比對, 有落差就以非 0 結束
//   node tools/build-rooms.mjs --dry       只印摘要, 不寫檔
//   node tools/build-rooms.mjs --limit=5   只抓前 5 間（開發用, 不寫檔）
//
// 資料來源是課程系統的「教室使用情形一覽表」:
//   Croom.jsp?format=-2            全校教室清單（簡稱、全名、座位數）
//   Croom.jsp?format=-3&code=…     單一教室的一週課表
//
// 231 間教室要各打一次頁面（約 1 分鐘）, 所以這是 build 時的快照, 而不是
// 前端即時查詢 —— 學校網站沒有 CORS 標頭, 瀏覽器直接抓會被瀏覽器擋掉。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "ntut-rooms.json");

const BASE = "https://aps.ntut.edu.tw/course/tw/Croom.jsp";
const YEAR = process.env.NTUT_YEAR || "115";
const SEM = process.env.NTUT_SEM || "1";

const CHECK_ONLY = process.argv.includes("--check");
const DRY_RUN = process.argv.includes("--dry");
const LIMIT = Number(/--limit=(\d+)/.exec(process.argv.join(" "))?.[1] || 0);

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; NTUTTools room-info builder)",
  "Accept-Language": "zh-TW,zh;q=0.9",
};

/** 頁面沒宣告編碼, 實際送的是 UTF-8；萬一哪天換回 Big5 也接得住。 */
async function page(query) {
  const response = await fetch(`${BASE}?${query}`, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("big5").decode(buffer) : utf8;
}

/**
 * 抓一頁。很少數情況下學校網站會斷一下, 而整份快照要打幾百個頁面 ——
 * 不重試的話, 一次偶發的錯誤就讓這份資料少了一筆, 而且 --check
 * 之後永遠比不起來。
 */
async function withRetry(work, label, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= tries) throw error;
      console.warn(`  ~ ${label} 第 ${attempt} 次失敗（${error.message}）, 重試…`);
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

/** 全角空白與 &nbsp; 都代表「這一格沒東西」。 */
const blank = (text) => !String(text).replace(/[\s　]|&nbsp;/g, "");

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/* ---------------- 教室清單 ---------------- */

/**
 * format=-2 那一頁的每一列: 簡稱（帶 code 的連結）、全名、座位數。
 * 使用率不收 —— 有了完整課表就自己算得出來, 算法也還能跟著需求改。
 */
function parseRoomList(html) {
  const rooms = [];
  for (const chunk of html.split(/<tr>/i).slice(1)) {
    const link = /<A href="Croom\.jsp\?format=-3[^"]*?code=(\d+)"[^>]*>([^<]*)<\/A>/i.exec(chunk);
    if (!link) continue;
    // 連結那一格之後的兩格是全名與座位數。
    const cells = chunk.split(/<td[^>]*>/i).slice(1)
      .map((cell) => clean(cell.replace(/<[^>]+>/g, " ")));
    const seats = Number(cells[2]);
    rooms.push({
      code: link[1],
      name: clean(link[2]),
      full: cells[1] || "",
      seats: Number.isFinite(seats) && seats > 0 ? seats : null,
    });
  }
  return rooms;
}

/* ---------------- 單一教室的課表 ---------------- */

/**
 * 一格裡可能有好幾門課（同時段不同班級）, 每門課從「(選課號碼) [人數]」開始。
 *
 * 人數刻意不收: 它是即時的選課人數, 每天都在動, 收進快照只會讓 --check
 * 永遠報「跟學校網站不同」, 而教室能不能用跟修課人數也無關。
 */
function parseCell(html) {
  if (blank(html.replace(/<[^>]+>/g, ""))) return [];
  const out = [];
  for (const piece of html.split(/(?=\(\d{4,}\)\s*(?:<[^>]+>\s*)*\[)/)) {
    const id = /\((\d{4,})\)/.exec(piece);
    if (!id) continue;
    // 課程概述的 code 不一定是純數字（「14E3094」、「AA04019」都有）。
    const curr = /<A href="Curr\.jsp\?format=-2&(?:amp;)?code=([0-9A-Za-z]+)"[^>]*>([^<]*)<\/A>/i.exec(piece);
    const classes = [...piece.matchAll(/<A href="Subj\.jsp[^"]*"[^>]*>([^<]*)<\/A>/gi)]
      .map((found) => clean(found[1]))
      .filter(Boolean);
    out.push({
      id: id[1],
      curr: curr ? curr[1] : "",
      // 有些課程（跨領域英文、國際觀培養…）沒有課程概述連結, 課名是純文字。
      // 這時要先把班級連結整段拆掉, 不然班級名稱會被接到課名後面。
      name: curr
        ? clean(curr[2])
        : clean(piece
          .replace(/<A[^>]*>[\s\S]*?<\/A>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\(\d+\)|\[\d+人\]/g, "")),
      classes,
    });
  }
  return out;
}

/**
 * 課表表格。回傳 { periods, slots }:
 *   periods  [{ key, start, end }]        節次與時間, 順序就是頁面上的順序
 *   slots    Map<"day|period", entry[]>   day 0 = 週日, 6 = 週六
 */
function parseTimetable(html) {
  // 第一個表格是那間教室的基本資料, 課表是第二個。
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  const table = tables[1];
  if (!table) return null;

  const periods = [];
  const slots = new Map();

  for (const chunk of table.split(/<tr>/i).slice(1)) {
    const head = /<td[^>]*>\s*第\s*(\S+)\s*節\s*<BR>\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/i.exec(chunk);
    if (!head) continue;
    const key = head[1];
    periods.push({ key, start: head[2], end: head[3] });

    // 節次那一格之後, 依序是週日到週六共 7 格。
    const cells = chunk.split(/<td[^>]*>/i).slice(2);
    cells.forEach((cell, day) => {
      if (day > 6) return;
      const entries = parseCell(cell);
      if (entries.length) slots.set(`${day}|${key}`, entries);
    });
  }
  return periods.length ? { periods, slots } : null;
}

/* ---------------- 主流程 ---------------- */

const listQuery = `format=-2&year=${YEAR}&sem=${SEM}`;
let rooms;
try {
  rooms = parseRoomList(await page(listQuery));
} catch (error) {
  console.error(`x 拿不到教室清單: ${error.message}`);
  process.exit(2);
}
if (!rooms.length) {
  console.error("x 教室清單是空的, 頁面格式可能變了");
  process.exit(2);
}
console.log(`  ${rooms.length} 間教室`);
if (LIMIT) rooms = rooms.slice(0, LIMIT);

/** 課程資訊去重: 同一門課會出現在很多格, 存一次就好。 */
const courseIndex = new Map();
function courseRef(entry) {
  const key = `${entry.id}|${entry.curr}|${entry.name}|${entry.classes.join("/")}`;
  if (!courseIndex.has(key)) {
    courseIndex.set(key, {
      at: courseIndex.size,
      value: {
        id: entry.id,
        name: entry.name,
        ...(entry.curr ? { curr: entry.curr } : {}),
        ...(entry.classes.length ? { classes: entry.classes } : {}),
      },
    });
  }
  return courseIndex.get(key).at;
}

let periods = null;
let failures = 0;
const out = [];

for (const [i, room] of rooms.entries()) {
  try {
    const parsed = await withRetry(
      async () => parseTimetable(await page(`format=-3&year=${YEAR}&sem=${SEM}&code=${room.code}`)),
      room.name,
    );
    if (!parsed) throw new Error("找不到課表表格");
    // 所有教室的節次表都一樣, 只存一份在最外層。
    if (!periods) periods = parsed.periods;
    const slots = {};
    for (const [key, entries] of parsed.slots) slots[key] = entries.map(courseRef);
    out.push({ ...room, slots });
  } catch (error) {
    console.warn(`  ! ${room.name}: ${error.message}`);
    failures++;
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rooms.length}`);
}

const courses = [...courseIndex.values()].sort((a, b) => a.at - b.at).map((item) => item.value);

const data = {
  generated: new Date().toISOString().slice(0, 10),
  year: Number(YEAR),
  sem: Number(SEM),
  source: `${BASE}?${listQuery}`,
  periods: periods || [],
  courses,
  rooms: out,
};

/** 抓壞了就不要覆蓋舊檔 —— 空白的資料比過期的資料難用得多。 */
const problems = [];
if (out.length < rooms.length / 2) problems.push(`只抓到 ${out.length}/${rooms.length} 間教室`);
if (!periods?.length) problems.push("找不到節次表");
if (courses.length < 100) problems.push(`只有 ${courses.length} 門課`);
if (!LIMIT && problems.length) {
  for (const problem of problems) console.error(`x ${problem}`);
  process.exit(2);
}

const output = `${JSON.stringify(data)}\n`;
const used = out.reduce((sum, room) => sum + Object.keys(room.slots).length, 0);
console.log(`v ${out.length} 間教室${failures ? `, ${failures} 間失敗` : ""}`
  + `・${periods?.length ?? 0} 個節次・${courses.length} 門課・${used} 個佔用時段`);

if (DRY_RUN || LIMIT) {
  console.log(`  （沒有寫檔）${(Buffer.byteLength(output) / 1024).toFixed(0)} KB`);
} else {
  const previous = (() => {
    try { return readFileSync(OUT, "utf8"); } catch { return ""; }
  })();
  const stripDate = (text) => text.replace(/"generated":"[^"]*",/, "");
  const changed = stripDate(previous.trim()) !== stripDate(output.trim());

  if (CHECK_ONLY) {
    if (changed) {
      console.error("x data/ntut-rooms.json 與學校網站不同, 請執行: node tools/build-rooms.mjs");
      process.exitCode = 1;
    } else {
      console.log("v 教室課表已是最新");
    }
  } else {
    writeFileSync(OUT, output);
    console.log(`v ${(Buffer.byteLength(output) / 1024).toFixed(0)} KB -> data/ntut-rooms.json`);
  }
}
