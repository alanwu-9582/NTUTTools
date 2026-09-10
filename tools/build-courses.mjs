// tools/build-courses.mjs — 抓全校的課程清單, 產生 data/ntut-courses.json。
//
//   node tools/build-courses.mjs           重新抓、寫檔
//   node tools/build-courses.mjs --check   只比對, 有落差就以非 0 結束
//   node tools/build-courses.mjs --dry     只印摘要, 不寫檔
//
// 這一份是給「新增課程」的挑選清單用的: 抵免、他系選修、通識博雅的實際課名
// 都不在自己系的課程科目表裡, 但一定在全校某個系所的表裡。
//
// 跟 build-curriculum.mjs 分開是因為它慢得多 —— 要打 49 個系所的頁面
// （約 40 秒）, 而全校開哪些課一個學年只會變一次；自己系的課程科目表
// 則會想常常重抓。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseCurriculum } from "../js/tools/credit-master/curriculum.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "ntut-courses.json");

const YEAR = process.env.NTUT_YEAR || "114";
/** 7 = 四技。大學部的「全校課程」就是這個學制。 */
const MATRIC = process.env.NTUT_MATRIC || "7";
const BASE = "https://aps.ntut.edu.tw/course/tw/Cprog.jsp";

const CHECK_ONLY = process.argv.includes("--check");
const DRY_RUN = process.argv.includes("--dry");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; NTUTTools credit-master builder)",
  "Accept-Language": "zh-TW,zh;q=0.9",
};

/**
 * 通識中心那幾個系所代碼就是博雅的向度。
 * 頁面上寫的是簡稱（「博雅課程－社法」）, 對不上課程標準裡的全名
 * （「社會與法治」）, 所以這裡明列。「自然」不屬於工程學院的三大指定向度, 
 * 它算在博雅剩下那 3 個不分向度的學分裡。
 */
const LIBERAL_DIMENSION = {
  人文: "人文與藝術",
  社法: "社會與法治",
  創創: "創新與創業",
  自然: "",
};

async function page(query) {
  const response = await fetch(`${BASE}?${query}`, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** 系所清單。format=-3 那一頁列出該學制底下所有的系所與組別。 */
async function listDivisions() {
  const html = await page(`format=-3&year=${YEAR}&matric=${MATRIC}`);
  const seen = new Map();
  for (const found of html.matchAll(/division=([^"'&]+)[^>]*>\s*([^<]+)/g)) {
    const code = found[1];
    const name = found[2].trim().replace(/\s+/g, " ");
    if (!code || !name || seen.has(code)) continue;
    const liberal = /博雅課程[－-](.+?)】/.exec(name);
    seen.set(code, {
      code,
      name,
      ...(liberal ? { dimension: LIBERAL_DIMENSION[liberal[1]] ?? "" , liberal: true } : {}),
    });
  }
  return [...seen.values()];
}

/* ---------- 主流程 ---------- */

let divisions;
try {
  divisions = await listDivisions();
} catch (error) {
  console.error(`x 拿不到系所清單: ${error.message}`);
  process.exit(2);
}
console.log(`  ${divisions.length} 個系所`);

/**
 * 同一門課會出現在好幾個系所的表裡（校院級課程、通識、跨系合開）。
 * 以「課號＋課名＋學分」為鍵去重, 但把開課的系所都留著 ——
 * 博雅課程要靠系所才知道它屬於哪個向度。
 */
const merged = new Map();
let scanned = 0;
let failures = 0;

for (const division of divisions) {
  try {
    const html = await page(`format=-4&year=${YEAR}&matric=${MATRIC}&division=${division.code}`);
    const parsed = parseCurriculum(html, {});
    for (const course of parsed.courses) {
      const key = `${course.code}|${course.name}|${course.credit}`;
      if (!merged.has(key)) {
        merged.set(key, {
          code: course.code,
          name: course.name,
          credit: course.credit,
          hours: course.hours,
          divisions: [],
        });
      }
      const entry = merged.get(key);
      if (!entry.divisions.includes(division.code)) entry.divisions.push(division.code);
    }
    scanned++;
  } catch (error) {
    console.warn(`  ! ${division.code} ${division.name}: ${error.message}`);
    failures++;
  }
  if (scanned % 10 === 0) console.log(`  ${scanned}/${divisions.length}`);
}

const courses = [...merged.values()].sort(
  (a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.code.localeCompare(b.code),
);

const data = {
  generated: new Date().toISOString().slice(0, 10),
  year: Number(YEAR),
  matric: Number(MATRIC),
  source: `${BASE}?format=-3&year=${YEAR}&matric=${MATRIC}`,
  divisions,
  courses,
};

/** 少於一半的系所抓成功, 或課程數少得不合理, 就不要覆蓋舊檔。 */
const problems = [];
if (scanned < divisions.length / 2) problems.push(`只抓到 ${scanned}/${divisions.length} 個系所`);
if (courses.length < 500) problems.push(`只有 ${courses.length} 門課`);
if (!divisions.some((division) => division.liberal)) problems.push("找不到通識博雅的系所");
if (problems.length) {
  for (const problem of problems) console.error(`x ${problem}`);
  process.exit(2);
}

function summarise() {
  console.log(`v ${courses.length} 門課（${scanned} 個系所${failures ? `, ${failures} 個失敗` : ""}）`);
  for (const division of divisions.filter((d) => d.liberal)) {
    const count = courses.filter((course) => course.divisions.includes(division.code)).length;
    console.log(`  ${division.name} → ${division.dimension || "不分向度"}: ${count} 門`);
  }
}

const output = `${JSON.stringify(data)}\n`;
summarise();

if (DRY_RUN) {
  console.log(`  （--dry, 沒有寫檔）${(Buffer.byteLength(output) / 1024).toFixed(0)} KB`);
} else {
  const previous = (() => {
    try { return readFileSync(OUT, "utf8"); } catch { return ""; }
  })();
  const stripDate = (text) => text.replace(/"generated":"[^"]*",/, "");
  const changed = stripDate(previous.trim()) !== stripDate(output.trim());

  if (CHECK_ONLY) {
    if (changed) {
      console.error("x data/ntut-courses.json 與學校網站不同, 請執行: node tools/build-courses.mjs");
      process.exitCode = 1;
    } else {
      console.log("v 全校課程清單已是最新");
    }
  } else {
    writeFileSync(OUT, output);
    console.log(`v ${(Buffer.byteLength(output) / 1024).toFixed(0)} KB -> data/ntut-courses.json`);
  }
}
