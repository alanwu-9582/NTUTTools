// tools/build-curriculum.mjs — 抓北科大課程標準, 產生 data/ntut-curriculum.json。
//
//   node tools/build-curriculum.mjs            重新抓、寫檔
//   node tools/build-curriculum.mjs --check    只比對, 有落差就以非 0 結束
//   node tools/build-curriculum.mjs --dry      只印摘要, 不寫檔
//
// 為什麼要在這裡抓、不在瀏覽器抓: aps.ntut.edu.tw 沒有回
// Access-Control-Allow-Origin, 瀏覽器的 fetch 一定會被擋。所以課程標準
// 必須在建置階段抓成快照, 跟著站台一起發佈。
//
// 換學年度只要改下面的 YEAR（或用環境變數蓋過去）再重跑, 畢業門檻、
// 幾選幾的組合都會自己跟著更新 —— 解析在 js/tools/credit-master/curriculum.js。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseCurriculum } from "../js/tools/credit-master/curriculum.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "ntut-curriculum.json");

/**
 * 114 學年度、四技（matric=7）、工程科技學士班【材料及資源工程系材料組】（division=832）。
 *
 * 不是 331（材資系材料組）: 從工程科技學士班入學的學生, 大一是學士班的
 * 共同課表, 大二才進材資系。兩張表的大二之後完全一樣、畢業門檻也一樣, 
 * 差別只在大一 —— 例如 832 的化學是 3 學分, 331 是 2 學分。
 * 用 331 會讓大一的學分與類別對不上。
 */
const YEAR = process.env.NTUT_YEAR || "114";
const MATRIC = process.env.NTUT_MATRIC || "7";
const DIVISION = process.env.NTUT_DIVISION || "832";
const SOURCE = `https://aps.ntut.edu.tw/course/tw/Cprog.jsp?format=-4&year=${YEAR}&matric=${MATRIC}&division=${DIVISION}`;

const CHECK_ONLY = process.argv.includes("--check");
const DRY_RUN = process.argv.includes("--dry");

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      // 學校的伺服器對沒有 UA 的請求會回不一樣的東西。
      "User-Agent": "Mozilla/5.0 (compatible; NTUTTools credit-master builder)",
      "Accept-Language": "zh-TW,zh;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // 頁面自己宣告 UTF-8, 但保險起見照 header 走。
  const buffer = new Uint8Array(await response.arrayBuffer());
  const charset = /charset=([\w-]+)/i.exec(response.headers.get("content-type") || "");
  return new TextDecoder(charset ? charset[1] : "utf-8").decode(buffer);
}

function summarise(data) {
  const { requirements: need, liberal } = data;
  console.log(`v ${data.program.heading}`);
  console.log(`  ${data.courses.length} 門課、${data.semesters.length} 個學期`);
  console.log(`  畢業門檻: 總 ${need.total}／共同必修 ${need.common}／專業必修 ${need.major}`
    + `／專業選修 ${need.electiveMajor}（含 ${need.electiveMajorPicked} 必選修）／跨域自由 ${need.free}`);
  console.log(`  通識博雅: ${liberal.total} 學分, ${liberal.dimensions.join("、")} 各 ${liberal.perDimension}`);
  for (const group of data.pickGroups) {
    console.log(`  ${group.symbol} ${group.label}: ${group.courses.join("、")}`);
  }
  if (data.coreLabs) console.log(`  基礎實驗課程: ${data.coreLabs.courses.length} 門, 需通過 ${data.coreLabs.need}`);
  if (data.mustPass.length) console.log(`  必須修習: ${data.mustPass.join("、")}`);

  const byBucket = new Map();
  for (const course of data.courses) {
    byBucket.set(course.bucket, (byBucket.get(course.bucket) || 0) + course.credit);
  }
  console.log(`  課表學分合計: ${[...byBucket].map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

/** 抓到的東西夠不夠格當快照。缺門檻或沒課程就不要覆蓋舊檔。 */
function validate(data) {
  const problems = [];
  if (data.courses.length < 50) problems.push(`只解析到 ${data.courses.length} 門課`);
  for (const [key, value] of Object.entries(data.requirements)) {
    if (value == null) problems.push(`門檻 ${key} 沒有解析到`);
  }
  if (!data.pickGroups.length) problems.push("沒有解析到任何「幾選幾」");
  if (!data.liberal.dimensions.length) problems.push("沒有解析到博雅向度");

  return problems;
}

/**
 * 課表的必修學分跟門檻對不對得上。
 *
 * 只是提醒, 不擋。材資系（331）的課表剛好等於門檻, 但工程科技學士班（832）
 * 的專業必修只有 47 學分、門檻卻寫 51 —— 那是學校自己兩份資料的差異, 
 * 不是解析錯誤。當成硬性條件的話, 換個系所就整支腳本失敗。
 */
function crossCheck(data) {
  const sum = (bucket) => data.courses
    .filter((course) => course.bucket === bucket)
    .reduce((total, course) => total + course.credit, 0);

  for (const [bucket, label, need] of [
    ["common", "共同必修", data.requirements.common],
    ["major", "專業必修", data.requirements.major],
  ]) {
    const actual = sum(bucket);
    if (actual !== need) {
      console.warn(`! ${label}: 課表列了 ${actual} 學分, 規定事項寫 ${need} 學分（學校資料本身的差異）`);
    }
  }
}

/* ---------- 主流程 ---------- */

let data;
try {
  console.log(`  正在抓 ${SOURCE}`);
  data = parseCurriculum(await fetchPage(SOURCE), { source: SOURCE });
} catch (error) {
  console.error(`x 抓不到課程標準: ${error.message}`);
  process.exit(2);
}

crossCheck(data);
const problems = validate(data);
if (problems.length) {
  for (const problem of problems) console.error(`x ${problem}`);
  console.error("x 解析結果不完整, 不覆蓋既有檔案");
  process.exit(2);
}

const output = `${JSON.stringify(data)}\n`;

if (DRY_RUN) {
  summarise(data);
  console.log(`  （--dry, 沒有寫檔）${(Buffer.byteLength(output) / 1024).toFixed(0)} KB`);
} else {
  writeSnapshot();
}

function writeSnapshot() {
const previous = (() => {
  try { return readFileSync(OUT, "utf8"); } catch { return ""; }
})();
/** 只差在 generated 日期不算變動, 否則每天跑都會多一筆假差異。 */
const stripDate = (text) => text.replace(/"generated":"[^"]*",/, "");
const changed = stripDate(previous.trim()) !== stripDate(output.trim());

summarise(data);
if (CHECK_ONLY) {
  if (changed) {
    console.error("x data/ntut-curriculum.json 與學校網站不同, 請執行: node tools/build-curriculum.mjs");
    process.exitCode = 1;
    return;
  }
  console.log("v 課程標準已是最新");
} else {
  writeFileSync(OUT, output);
  console.log(`v ${(Buffer.byteLength(output) / 1024).toFixed(0)} KB -> data/ntut-curriculum.json${changed ? "" : "（內容沒有變動）"}`);
}
}
