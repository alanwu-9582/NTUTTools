// js/tools/credit-master/curriculum.js — 解析北科大的「課程標準」網頁。
//
// 來源是 aps.ntut.edu.tw 的 Cprog.jsp?format=-4, 內容是一張課程表加一段
// 「相關規定事項」。兩邊都要用: 表格給課程與類別, 規定事項給畢業門檻與
// 「幾選幾」的規則。
//
// 這支不碰 DOM, tools/build-curriculum.mjs（Node）直接 import 它 ——
// 學校網站沒有回 CORS 標頭, 瀏覽器抓不到, 所以一定得在建置階段抓好存成快照。
//
// 刻意不把門檻寫死在程式裡。學分數、幾選幾的組合、博雅向度全都從網頁的
// 規定事項讀出來, 換學年度只要重跑一次腳本, 不必有人去對照著改數字。

/** 課程表「類別」欄的符號。對照表在 Cprog.jsp?format=-5。 */
const CATEGORY = {
  "○": "部訂共同必修",
  "△": "校定共同必修",
  "☆": "校定共同選修",
  "●": "部訂專業必修",
  "▲": "校定專業必修",
  "★": "校定專業選修",
};

/**
 * 類別 → 畢業門檻的四個桶子。
 *
 * 「校定共同選修」（大三之後的體育、大一下的全民國防教育）不屬於前三類, 
 * 依規定事項它算在「跨域及自由選修」裡（校院級課程）。原本的 .xlsx 漏了
 * 這一類, 那幾個學分會憑空消失 —— 連總學分都算不進去。
 */
const BUCKET = {
  部訂共同必修: "common",
  校定共同必修: "common",
  部訂專業必修: "major",
  校定專業必修: "major",
  校定專業選修: "electiveMajor",
  校定共同選修: "free",
};

const YEAR_NAME = ["", "大一", "大二", "大三", "大四"];
const CHINESE_NUMBER = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 學年 + 學期 → 「大一上」這種標籤。 */
export function semesterLabel(year, term) {
  return `${YEAR_NAME[year] || `大${year}`}${term === 1 ? "上" : "下"}`;
}

/** 八個學期, 固定順序。 */
export const SEMESTERS = [1, 2, 3, 4].flatMap((y) => [semesterLabel(y, 1), semesterLabel(y, 2)]);

/** 去掉標籤與 HTML 實體, 留下純文字。 */
function plain(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/　/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================ 課程表 ============================ */

/**
 * 把課程表讀成一列一列。
 *
 * 這個頁面的 HTML 沒有關閉標籤（`<tr><td>…<td>…`）, 所以用切分而不是
 * 找配對標籤: 先用 <tr> 切列, 再用 <td>/<th> 切欄。
 */
function parseCourses(html) {
  const start = html.indexOf("<table border=1>");
  if (start < 0) return [];
  const table = html.slice(start);

  const courses = [];
  for (const row of table.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = row.split(/<t[dh]\b[^>]*>/i).slice(1).map(plain);
    // 欄位: 學年 學期 類別 課程編碼 課程名稱 學分 時數 階段別 群組編號 備註
    if (cells.length < 9) continue;
    if (!/^[1-9]$/.test(cells[0])) continue;   // 表頭與表尾的說明列

    const category = CATEGORY[cells[2]];
    if (!category) continue;

    courses.push({
      semester: semesterLabel(Number(cells[0]), Number(cells[1])),
      year: Number(cells[0]),
      term: Number(cells[1]),
      category,
      bucket: BUCKET[category] || "free",
      code: cells[3],
      name: cells[4],
      credit: Number(cells[5]) || 0,
      hours: cells[6],
      stage: cells[7],
      // 備註欄的符號（■◆●◎）就是「幾選幾」的分組依據。表尾那一列會把
      // 整段規定事項塞進備註, 所以只留單一個符號。
      mark: /^[■◆●◎○▲△★☆]$/.test(cells[9] || "") ? cells[9] : "",
    });
  }
  return courses;
}

/* ============================ 規定事項 ============================ */

/** 抓出「相關規定事項」那一整段純文字。 */
function rulesText(html) {
  const at = html.lastIndexOf("相關規定事項");
  if (at < 0) return "";
  const tail = html.slice(at);
  const stop = tail.indexOf("備註：");
  return plain(stop > 0 ? tail.slice(0, stop) : tail);
}

const pickNumber = (text, pattern) => {
  const found = pattern.exec(text);
  return found ? Number(found[1]) : null;
};

/** 「「甲」、「乙」及「丙」」→ ["甲","乙","丙"] */
const quoted = (text) => [...String(text).matchAll(/「([^」]+)」/g)].map((m) => m[1]);

/**
 * 解析畢業門檻。
 *
 * 每個數字各自用一條規則抓, 不寫成一長串。學校那句話是
 * 「共同必修：28學分；專業必修51學分；專業選修33學分(含15必選修)。跨域及自由選修20學分。」
 * 分隔符號混用全形分號與句號, 一條長規則很容易因為改了個標點就整段對不上。
 */
function parseRequirements(text) {
  return {
    total: pickNumber(text, /最低畢業學分：(\d+)/),
    common: pickNumber(text, /共同必修：(\d+)學分/),
    major: pickNumber(text, /專業必修(\d+)學分/),
    electiveMajor: pickNumber(text, /專業選修(\d+)學分/),
    /** 專業選修裡有幾學分必須來自「幾選幾」的指定科目。 */
    electiveMajorPicked: pickNumber(text, /專業選修\d+學分\(含(\d+)必選修\)/),
    free: pickNumber(text, /跨域及自由選修(\d+)學分/),
  };
}

/** 通識博雅: 總學分、三大向度、每個向度的下限、能計入自由選修的上限。 */
function parseLiberal(text) {
  const trio = /((?:「[^」]+」[、及]?)+)等三大向度/.exec(text);
  return {
    total: pickNumber(text, /通識博雅課程應修滿(\d+)學分/),
    perDimension: pickNumber(text, /每向度至少需選修(\d+)學分/),
    dimensions: trio ? quoted(trio[1]) : [],
    countedInFree: pickNumber(text, /通識博雅課程至多認列(\d+)學分/),
  };
}

/**
 * 「幾選幾」。
 *
 * 成員從課程表的備註符號拿, 不從規定事項的文字拿 —— 那段文字的寫法不統一, 
 * 前三組的科目名有「」括著, 第四組（工程數學(二)、材料力學、工程統計學）
 * 卻沒有, 照文字剖析遲早會漏掉一組。符號是欄位資料, 可靠得多。
 *
 * 至於「要修幾門」, 文字裡是「至少必選修一門及格(■)」這種寫法, 
 * 用符號去對就抓得到, 而且四組的句型一致。
 */
function parsePickGroups(text, courses) {
  const needBySymbol = new Map();
  for (const m of text.matchAll(/至少必選修([一二三四五六七八九十])門及格\s*[（(](.)[）)]/g)) {
    needBySymbol.set(m[2], CHINESE_NUMBER[m[1]] || 1);
  }

  const groups = [];
  for (const [symbol, need] of needBySymbol) {
    const members = courses.filter((course) => course.mark === symbol);
    if (!members.length) continue;
    groups.push({
      symbol,
      need,
      // 名字照 .xlsx 的叫法（「3選2」）, 使用者看得懂。
      label: `${members.length}選${need}`,
      courses: members.map((course) => course.name),
    });
  }
  // 選項多的排前面, 順序穩定。
  return groups.sort((a, b) => b.courses.length - a.courses.length || a.symbol.localeCompare(b.symbol));
}

/**
 * 只在括號外面切 、。
 *
 * 規定事項裡的科目清單長這樣:
 *   大一物理實驗(下學期)、化學實習(上、下學期)、大二材料工程實習(一)、…
 * 「上、下學期」的頓號在括號裡, 直接 split("、") 會把「化學實習(上」
 * 跟「下學期)」拆成兩項。
 */
function splitOutsideBrackets(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of String(text)) {
    if ("(（".includes(char)) depth++;
    else if (")）".includes(char)) depth = Math.max(0, depth - 1);
    if (char === "、" && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * 「技術扎根教學」的基礎實驗課程。
 *
 * 科目直接從規定事項那句話裡讀出來, 不從課程表的類別去猜。
 * 猜的話會錯: 物理實驗在材資系（331）的表裡是專業必修, 在工程科技學士班
 * （832）的表裡卻是專業選修 —— 只挑必修就會少一門, 湊不到規定的 7 門。
 * 而且 331 大一上還有一門「物理實驗（一）」不屬於這 7 門, 
 * 用「名字裡有實驗」去撈會多抓到它。
 *
 * 清單裡的名稱帶了學期提示（「大一物理實驗(下學期)」）, 要剝掉才對得上
 * 課程表；但「材料工程實習(一)」的括號是課名的一部分, 不能動。
 */
function parseCoreLabs(text, courses) {
  const need = pickNumber(text, /最低課程數\s*[（(]N[）)]\s*=\s*(\d+)/);
  if (!need) return null;

  const listed = /「基礎實驗課程」包括(.+?)等\s*\d+\s*門/.exec(text);
  const names = listed
    ? splitOutsideBrackets(listed[1]).map((item) => item
      .replace(/^大[一二三四]/, "")
      .replace(/[（(][^）)]*學期[^）)]*[）)]/g, "")
      .trim())
    : [];

  // 一門一學期算一門: 化學實習上下學期各算一門, 所以是 7 而不是 6 個名字。
  const wanted = new Set(names);
  const named = names.length
    ? courses.filter((course) => wanted.has(course.name))
    : courses.filter((course) => course.bucket === "major"
      && /實驗|實習/.test(course.name) && !/校外/.test(course.name));

  return {
    need,
    total: pickNumber(text, /總課程數\s*[（(]M[）)]\s*=\s*(\d+)/) || named.length,
    names,
    courses: named.map((course) => ({ semester: course.semester, name: course.name })),
  };
}


/** 「需修習「勞作教育」及「服務學習」始可畢業」→ 這兩門一定要過。 */
function parseMustPass(text) {
  const found = /需修習((?:「[^」]+」[及、]?)+)始可畢業/.exec(text);
  return found ? quoted(found[1]) : [];
}

/** 頁面標題那一行: 「114 學年度入學 四技 材資系 【材料組】 課程科目表」 */
function parseProgram(html) {
  const heading = /<H3>([\s\S]*?)<\/H3>/i.exec(html);
  const line = heading ? plain(heading[1]) : "";
  const found = /(\d+)\s*學年度入學\s*(\S+)\s*(\S+?)\s*【(.+?)】/.exec(line);
  return {
    heading: line,
    year: found ? Number(found[1]) : null,
    system: found ? found[2] : "",
    department: found ? found[3] : "",
    group: found ? found[4] : "",
  };
}

/* ============================ 對外 ============================ */

/**
 * 課程標準網頁 → 結構化的課程與畢業規則。
 * @param {string} html
 * @param {{source?: string}} options
 */
export function parseCurriculum(html, { source = "" } = {}) {
  const courses = parseCourses(html);
  const text = rulesText(html);

  return {
    generated: new Date().toISOString().slice(0, 10),
    source,
    program: parseProgram(html),
    semesters: SEMESTERS.filter((label) => courses.some((course) => course.semester === label)),
    requirements: parseRequirements(text),
    liberal: parseLiberal(text),
    pickGroups: parsePickGroups(text, courses),
    coreLabs: parseCoreLabs(text, courses),
    mustPass: parseMustPass(text),
    courses,
    rules: text,
  };
}

export { CATEGORY, BUCKET };
