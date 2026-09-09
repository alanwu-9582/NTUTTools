// tools/build-classes.mjs — 抓全校班級課表, 產生 data/ntut-classes.json。
//
//   node tools/build-classes.mjs             重新抓、寫檔
//   node tools/build-classes.mjs --check     只比對, 有落差就以非 0 結束
//   node tools/build-classes.mjs --dry       只印摘要, 不寫檔
//   node tools/build-classes.mjs --limit=5   只抓前 5 個系所（開發用, 不寫檔）
//
// 資料來源是課程系統的「上課時間表」, 三層:
//   Subj.jsp?format=-2            系所清單（依學院分組）
//   Subj.jsp?format=-3&code=<系所>  該系所底下的班級
//   Subj.jsp?format=-4&code=<班級>  該班級的完整課表
//
// 跟 build-rooms.mjs 一樣是 build 時的快照 —— 學校網站沒有 CORS 標頭,
// 瀏覽器直接抓會被擋掉。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "ntut-classes.json");

const BASE = "https://aps.ntut.edu.tw/course/tw/Subj.jsp";
const YEAR = process.env.NTUT_YEAR || "115";
const SEM = process.env.NTUT_SEM || "1";

const CHECK_ONLY = process.argv.includes("--check");
const DRY_RUN = process.argv.includes("--dry");
const LIMIT = Number(/--limit=(\d+)/.exec(process.argv.join(" "))?.[1] || 0);

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; NTUTTools class-schedule builder)",
  "Accept-Language": "zh-TW,zh;q=0.9",
};

/** 合法的節次代號。日期欄位裡就是這些字元用空白隔開, 例如「 3 4」。 */
const PERIOD_KEYS = new Set(["1", "2", "3", "4", "N", "5", "6", "7", "8", "9", "A", "B", "C", "D"]);

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

const clean = (text) => String(text ?? "")
  .replace(/&nbsp;/g, " ")
  .replace(/[\s　]+/g, " ")
  .trim();

/** 去掉標籤只留文字。多個 <BR> 分隔的項目要保留成分行。 */
const textOf = (html) => clean(String(html ?? "").replace(/<[^>]+>/g, " "));

/* ---------------- 系所與班級 ---------------- */

/**
 * format=-2 那一頁把系所排成表格, 第一欄是學院名稱（rowspan 跨幾列）。
 * 學院只當分組標籤用, 抓不到就留空 —— 它不影響查課表。
 */
function parseDepartments(html) {
  const depts = [];
  const seen = new Set();
  let college = "";
  for (const chunk of html.split(/<tr>/i).slice(1)) {
    // 「<td rowspan=3>機電學院」這種才是學院名稱: 它後面緊接著的是文字而不是連結。
    const label = /<td[^>]*rowspan=\d+[^>]*>\s*([^<\s][^<]*)/i.exec(chunk);
    if (label) college = clean(label[1]);
    for (const found of chunk.matchAll(/format=-3&year=\d+&sem=\d+&code=([A-Z0-9]+)"[^>]*>([^<]+)</gi)) {
      const code = found[1];
      if (seen.has(code)) continue;
      seen.add(code);
      depts.push({ code, name: clean(found[2]), college });
    }
  }
  return depts;
}

/** format=-3: 一個系所底下的班級。 */
function parseClasses(html) {
  const out = [];
  const seen = new Set();
  for (const found of html.matchAll(/format=-4&year=\d+&sem=\d+&code=(\d+)"[^>]*>([^<]+)</gi)) {
    const code = found[1];
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: clean(found[2]) });
  }
  return out;
}

/* ---------------- 一個班級的課表 ---------------- */

/**
 * 表頭的欄位名稱 → 欄位索引。硬寫死索引的話, 學校加一欄就全錯,
 * 而且錯得很安靜（課名變成學分之類）, 所以每次都從表頭讀。
 */
function columnMap(headerRow) {
  const cells = headerRow.split(/<th[^>]*>/i).slice(1).map(textOf);
  const at = {};
  cells.forEach((label, i) => {
    const key = label.replace(/\s/g, "");
    if (!(key in at)) at[key] = i;
  });
  return { at, cells };
}

/** 「 3 4」→ ["3","4"]。 */
const periodsIn = (cell) => textOf(cell).split(/\s+/).filter((token) => PERIOD_KEYS.has(token));

/** 一欄裡的連結文字（教師、教室都可能有好幾個）。 */
const linkTexts = (cell, file) => [
  ...String(cell ?? "").matchAll(new RegExp(`<A href="${file}[^"]*"[^>]*>([^<]*)</A>`, "gi")),
].map((found) => clean(found[1])).filter(Boolean);

/**
 * 課表表格。回傳 { name, courses }, courses 的 slots 是 { day: [periodKey] },
 * day 0 = 週日。
 *
 * 修課人數（「人」那一欄）刻意不收: 它每天都在動, 收進快照只會讓 --check
 * 永遠報「跟學校網站不同」, 而看課表的人要的是時間與教室。
 */
function parseSchedule(html) {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[0];
  if (!table) return null;

  const rows = table.split(/<tr>/i).slice(1);
  const name = /<th[^>]*colspan=\d+[^>]*>\s*([^<\s][^<]*)/i.exec(rows[0] || "")?.[1];
  const headerRow = rows.find((row) => /<th[^>]*>\s*課程名稱/.test(row));
  if (!headerRow) return null;
  const { at } = columnMap(headerRow);

  // 日期欄是連續的 7 欄, 從「日」開始。
  const dayStart = at["日"];
  if (dayStart == null) return null;

  const courses = [];
  for (const row of rows) {
    if (!/<td/i.test(row)) continue;
    const cells = row.split(/<td[^>]*>/i).slice(1);
    if (cells.length <= dayStart + 6) continue;
    // 最後一列是學分與時數的小計, 不是課。
    if (textOf(cells[0]) === "小計") continue;

    const slots = {};
    for (let day = 0; day < 7; day++) {
      const keys = periodsIn(cells[dayStart + day]);
      if (keys.length) slots[day] = keys;
    }

    const title = textOf(cells[at["課程名稱"]]);
    // 沒課名又沒時段的列是排版用的空列。
    if (!title && !Object.keys(slots).length) continue;

    const credit = Number(textOf(cells[at["學分"]]));
    const note = at["備註"] != null ? textOf(cells[at["備註"]]) : "";
    const lang = at["授課語言"] != null ? textOf(cells[at["授課語言"]]) : "";

    courses.push({
      snum: textOf(cells[at["課號"]]),
      name: title,
      ...(Number.isFinite(credit) ? { credit } : {}),
      // 必選修符號（○△☆●▲★）, 對照表在工具裡。
      req: textOf(cells[at["修"]]),
      teachers: linkTexts(cells[at["教師"]], "Teach\\.jsp"),
      rooms: linkTexts(cells[at["教室"]], "Croom\\.jsp"),
      ...(lang ? { lang } : {}),
      ...(note ? { note } : {}),
      slots,
    });
  }
  return courses.length ? { name: name ? clean(name) : "", courses } : null;
}

/* ---------------- 主流程 ---------------- */

const listQuery = `format=-2&year=${YEAR}&sem=${SEM}`;
let depts;
try {
  depts = parseDepartments(await page(listQuery));
} catch (error) {
  console.error(`x 拿不到系所清單: ${error.message}`);
  process.exit(2);
}
if (!depts.length) {
  console.error("x 系所清單是空的, 頁面格式可能變了");
  process.exit(2);
}
console.log(`  ${depts.length} 個系所`);
if (LIMIT) depts = depts.slice(0, LIMIT);

/**
 * 課程去重。同一門課會出現在好幾個班級的課表裡（合開、通識、校院級課程）,
 * 內容一模一樣就只存一份, 班級那邊只留索引。
 */
const courseIndex = new Map();
function courseRef(course) {
  const key = JSON.stringify(course);
  if (!courseIndex.has(key)) courseIndex.set(key, { at: courseIndex.size, value: course });
  return courseIndex.get(key).at;
}

const classes = [];
let scanned = 0;
let failures = 0;

for (const dept of depts) {
  let found;
  try {
    found = await withRetry(
      async () => parseClasses(await page(`format=-3&year=${YEAR}&sem=${SEM}&code=${dept.code}`)),
      dept.name,
    );
  } catch (error) {
    console.warn(`  ! ${dept.name}: ${error.message}`);
    failures++;
    continue;
  }

  for (const item of found) {
    try {
      const schedule = await withRetry(
        async () => parseSchedule(await page(`format=-4&year=${YEAR}&sem=${SEM}&code=${item.code}`)),
        `${dept.name} ${item.name}`,
      );
      if (!schedule) throw new Error("找不到課表表格");
      classes.push({
        code: item.code,
        // 班級清單頁與課表頁的班名偶爾不一致, 以課表頁上的為準。
        name: schedule.name || item.name,
        dept: dept.code,
        courses: schedule.courses.map(courseRef),
      });
    } catch (error) {
      console.warn(`  ! ${dept.name} ${item.name}: ${error.message}`);
      failures++;
    }
  }
  scanned++;
  console.log(`  ${scanned}/${depts.length} ${dept.name}（累計 ${classes.length} 班）`);
}

const courses = [...courseIndex.values()].sort((a, b) => a.at - b.at).map((item) => item.value);

const data = {
  generated: new Date().toISOString().slice(0, 10),
  year: Number(YEAR),
  sem: Number(SEM),
  source: `${BASE}?${listQuery}`,
  depts,
  courses,
  classes,
};

/** 抓壞了就不要覆蓋舊檔 —— 空白的資料比過期的資料難用得多。 */
const problems = [];
if (scanned < depts.length / 2) problems.push(`只抓到 ${scanned}/${depts.length} 個系所`);
if (classes.length < 100) problems.push(`只有 ${classes.length} 個班級`);
if (courses.length < 500) problems.push(`只有 ${courses.length} 門課`);
if (!LIMIT && problems.length) {
  for (const problem of problems) console.error(`x ${problem}`);
  process.exit(2);
}

const output = `${JSON.stringify(data)}\n`;
console.log(`v ${classes.length} 個班級${failures ? `, ${failures} 個失敗` : ""}・${courses.length} 門課`);

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
      console.error("x data/ntut-classes.json 與學校網站不同, 請執行: node tools/build-classes.mjs");
      process.exitCode = 1;
    } else {
      console.log("v 班級課表已是最新");
    }
  } else {
    writeFileSync(OUT, output);
    console.log(`v ${(Buffer.byteLength(output) / 1024).toFixed(0)} KB -> data/ntut-classes.json`);
  }
}
