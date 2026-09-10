// js/tools/credit-master/grades.js — GPA、學分與畢業門檻的計算。
//
// 這支不碰 DOM, 好處是能在 Node 裡直接跑測試。成績計算錯了不會有人發現, 
// 只會安靜地給出一個看起來很合理的數字, 所以這一塊一定要能測。
//
// 換算方式沿用原本 .xlsx 的定義（見下面兩張級距表）, 這樣舊資料算出來的
// GPA 不會突然變了一個數。

import { BUCKET } from "./curriculum.js";

/** 及格分數。低於這個分數不計學分、不計 GPA。 */
export const PASS_MARK = 60;

/**
 * 分數 → 等第積點。
 *
 * 兩套並存是因為學校自己就有兩種算法（4.0 與 4.3）, 申請學校、申請獎學金
 * 要的不一樣。門檻照 .xlsx 原本的 LOOKUP 級距, 由高往低比。
 */
const SCALES = {
  "4.0": [[80, 4], [70, 3], [60, 2], [0, 0]],
  "4.3": [
    [90, 4.3], [85, 4], [80, 3.7], [77, 3.3], [73, 3],
    [70, 2.7], [67, 2.3], [63, 2], [60, 1.7], [0, 0],
  ],
};

export const SCALE_KEYS = Object.keys(SCALES);

/** 某個分數在指定級距下的積點。沒有分數回 null。 */
export function gradePoint(score, scale = "4.3") {
  if (!Number.isFinite(score)) return null;
  const table = SCALES[scale] || SCALES["4.3"];
  for (const [floor, point] of table) if (score >= floor) return point;
  return 0;
}

/** 浮點誤差修一下。學分有 0.5, 加起來很容易變成 46.999999999999996。 */
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const number = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/* ============================ 課程對照 ============================ */

/** 課表查詢用的索引: 「學期|課名」→ 課程。跟原本 .xlsx 的比對方式一致。 */
export function courseIndex(curriculum) {
  const byKey = new Map();
  const byName = new Map();
  for (const course of curriculum.courses) {
    byKey.set(`${course.semester}|${course.name}`, course);
    if (!byName.has(course.name)) byName.set(course.name, course);
  }
  return { byKey, byName };
}

/**
 * 從課名認出通識博雅的向度。
 *
 * 兩種寫法都要認:
 *
 *   課表的名額     「學院指定向度-人文與藝術」→ 破折號後面就是完整向度名
 *   自己記的課名   「博雅-人文-看見台灣」    → 只寫了向度的前兩個字
 *
 * 所以先取出破折號後的那一段, 再拿去跟三大向度做前綴比對。硬要求完整名稱
 * 的話, 第二種寫法會全部歸不到向度, 畫面上三個向度都會是 0。
 *
 * @param {string} name
 * @param {string[]} dimensions 課程標準裡的三大向度
 */
export function dimensionOf(name, dimensions = []) {
  const text = String(name || "");
  const found = /向度[-－‐−](.+)$/.exec(text) || /^博雅[-－‐−]([^-－‐−]+)/.exec(text);
  if (!found) return null;
  const candidate = found[1].trim();
  if (!candidate) return null;

  const hit = dimensions.find(
    (dimension) => dimension === candidate
      || dimension.startsWith(candidate)
      || candidate.startsWith(dimension),
  );
  return hit || candidate;
}

/** 這門課算不算通識博雅。課表用「向度」表示博雅的名額。 */
const isLiberal = (name) => /向度/.test(String(name || "")) || /^博雅/.test(String(name || ""));

/**
 * 把一筆使用者輸入補齊成可計算的一列。
 *
 * 學分與類別優先用使用者自己填的（校外抵免、他系選修這種課表上沒有的）, 
 * 沒填才回頭查課表；查不到就歸到「跨域及自由選修」——
 * 這正是課表以外的課該去的地方。
 */
export function resolveEntry(entry, index, curriculum) {
  const semester = String(entry.semester || "").trim();
  const name = String(entry.name || "").trim();
  const course = index.byKey.get(`${semester}|${name}`) || null;

  const credit = number(entry.credit) ?? course?.credit ?? 0;
  const category = entry.category || course?.category || "其他";
  // 類別要能決定桶子。課表以外的課（改過名的、抵免的）使用者會自己選類別, 
  // 少了 BUCKET[category] 這一段, 選了「共同必修」的課還是會被算進自由選修。
  const bucket = entry.bucket || course?.bucket || BUCKET[category] || "free";
  const score = number(entry.score);
  const passed = score != null && score >= PASS_MARK;

  return {
    ...entry,
    semester,
    name,
    score,
    credit,
    category,
    bucket,
    mark: course?.mark || "",
    code: course?.code || "",
    inCurriculum: Boolean(course),
    liberal: isLiberal(name) || Boolean(entry.dimension),
    dimension: entry.dimension || dimensionOf(name, curriculum?.liberal?.dimensions || []),
    passed,
    graded: score != null,
    points: Object.fromEntries(SCALE_KEYS.map(
      (scale) => [scale, score == null ? null : round(credit * gradePoint(score, scale), 4)],
    )),
  };
}

/* ============================ 統計 ============================ */

/**
 * GPA。
 *
 * 分母只算及格的學分, 分子只加及格科目的積點 —— 不及格的科目兩邊都不算, 
 * 所以重修一門被當掉的課不會被懲罰兩次。這也是原本 .xlsx 的算法。
 */
function gpaOf(rows, scale) {
  let points = 0;
  let credits = 0;
  for (const row of rows) {
    if (!row.passed) continue;
    points += row.points[scale] ?? 0;
    credits += row.credit;
  }
  return credits > 0 ? round(points / credits) : null;
}

/**
 * 平均分數。
 *
 * `includeFailed` 決定不及格的科目要不要算進來。原本的 .xlsx 兩個平均
 * 用了不同的規則（算術平均只算及格、加權平均卻含不及格）, 數字對不起來
 * 也看不出是故意的。這裡兩個平均統一用同一個開關, 預設含不及格 ——
 * 把當掉的科目藏起來的平均分數會比實際好看, 但沒有用。
 */
function averagesOf(rows, includeFailed) {
  const scored = rows.filter((row) => row.graded && (includeFailed || row.passed));
  if (!scored.length) return { average: null, weighted: null };

  const plain = scored.reduce((total, row) => total + row.score, 0) / scored.length;
  const credits = scored.reduce((total, row) => total + row.credit, 0);
  const weighted = credits > 0
    ? scored.reduce((total, row) => total + row.score * row.credit, 0) / credits
    : null;
  return { average: round(plain), weighted: weighted == null ? null : round(weighted) };
}

/** 各類別已取得的學分（只算及格）。 */
function bucketCredits(rows) {
  const totals = { common: 0, major: 0, electiveMajor: 0, free: 0 };
  for (const row of rows) {
    if (!row.passed) continue;
    totals[row.bucket] = (totals[row.bucket] || 0) + row.credit;
  }
  return totals;
}

/** 「幾選幾」的達成狀況。 */
function pickProgress(rows, curriculum) {
  const passedNames = new Set(rows.filter((row) => row.passed).map((row) => row.name));
  const takenNames = new Set(rows.filter((row) => row.graded).map((row) => row.name));

  return (curriculum.pickGroups || []).map((group) => {
    const courses = group.courses.map((name) => ({
      name,
      passed: passedNames.has(name),
      taken: takenNames.has(name),
    }));
    const have = courses.filter((course) => course.passed).length;
    return { ...group, courses, have, met: have >= group.need };
  });
}

/** 通識博雅: 總學分與三大向度。 */
function liberalProgress(rows, curriculum) {
  const spec = curriculum.liberal || {};
  const passed = rows.filter((row) => row.passed && row.liberal);
  const earned = passed.reduce((total, row) => total + row.credit, 0);

  const dimensions = (spec.dimensions || []).map((name) => {
    const own = passed.filter((row) => row.dimension === name);
    const credits = own.reduce((total, row) => total + row.credit, 0);
    return {
      name,
      earned: round(credits),
      need: spec.perDimension || 0,
      met: credits >= (spec.perDimension || 0),
    };
  });

  const assigned = dimensions.reduce((total, dimension) => total + dimension.earned, 0);
  return {
    earned: round(earned),
    need: spec.total || 0,
    met: earned >= (spec.total || 0),
    dimensions,
    /** 不分向度那幾學分（學生自選向度）。 */
    unassigned: round(earned - assigned),
    countedInFree: spec.countedInFree ?? null,
  };
}

/** 技術扎根的基礎實驗課程, 逐門看有沒有過。 */
function coreLabProgress(rows, curriculum) {
  const spec = curriculum.coreLabs;
  if (!spec) return null;
  const passedKeys = new Set(rows.filter((row) => row.passed).map((row) => `${row.semester}|${row.name}`));
  const items = spec.courses.map((course) => ({
    ...course,
    passed: passedKeys.has(`${course.semester}|${course.name}`),
  }));
  const have = items.filter((item) => item.passed).length;
  return { ...spec, items, have, met: have >= spec.need };
}

/**
 * 全部算完。
 *
 * @param {Array} entries 使用者輸入的成績
 * @param {object} curriculum data/ntut-curriculum.json
 * @param {{includeFailed?: boolean, ranks?: object}} options
 */
export function summarise(entries, curriculum, { includeFailed = true, ranks = {} } = {}) {
  const index = courseIndex(curriculum);
  const rows = (entries || [])
    .filter((entry) => entry && String(entry.name || "").trim())
    .map((entry) => resolveEntry(entry, index, curriculum));

  const need = curriculum.requirements || {};
  const earned = bucketCredits(rows);

  /**
   * 專業選修超修的部分。
   * 依規定事項, 「跨域及自由選修」可以是各系專業課程, 所以專業選修修超過
   * 33 學分的部分算得進自由選修 —— 原本的 .xlsx 是各類獨立加總, 
   * 超修的學分就這樣不見了。
   */
  const overflow = round(Math.max(0, earned.electiveMajor - (need.electiveMajor || 0)));
  const freeCounted = round(earned.free + overflow);

  const buckets = [
    { key: "common", label: "共同必修", earned: round(earned.common), need: need.common || 0 },
    { key: "major", label: "專業必修", earned: round(earned.major), need: need.major || 0 },
    { key: "electiveMajor", label: "專業選修", earned: round(earned.electiveMajor), need: need.electiveMajor || 0 },
    {
      key: "free",
      label: "跨域及自由選修",
      earned: freeCounted,
      need: need.free || 0,
      note: overflow > 0 ? `含專業選修超修 ${overflow} 學分` : "",
    },
  ].map((bucket) => ({ ...bucket, met: bucket.earned >= bucket.need }));

  const totalEarned = round(rows.reduce((total, row) => total + (row.passed ? row.credit : 0), 0));

  const semesters = (curriculum.semesters || []).map((label) => {
    const own = rows.filter((row) => row.semester === label);
    const { average, weighted } = averagesOf(own, includeFailed);
    return {
      label,
      courses: own.length,
      credits: round(own.reduce((total, row) => total + (row.passed ? row.credit : 0), 0)),
      attempted: round(own.reduce((total, row) => total + (row.graded ? row.credit : 0), 0)),
      gpa: Object.fromEntries(SCALE_KEYS.map((scale) => [scale, gpaOf(own, scale)])),
      average,
      weighted,
      rank: ranks[label]?.rank ?? null,
      rankPercent: ranks[label]?.percent ?? null,
    };
  });

  const picks = pickProgress(rows, curriculum);
  const liberal = liberalProgress(rows, curriculum);
  const coreLabs = coreLabProgress(rows, curriculum);
  const mustPass = (curriculum.mustPass || []).map((name) => ({
    name,
    passed: rows.some((row) => row.passed && row.name === name),
  }));

  /** 還差什麼才能畢業。空的就是都達成了。 */
  const blockers = [];
  for (const bucket of buckets) {
    if (!bucket.met) blockers.push(`${bucket.label}還差 ${round(bucket.need - bucket.earned)} 學分`);
  }
  if (totalEarned < (need.total || 0)) {
    blockers.push(`總學分還差 ${round((need.total || 0) - totalEarned)} 學分`);
  }
  for (const group of picks) {
    if (!group.met) blockers.push(`${group.label}還差 ${group.need - group.have} 門`);
  }
  if (!liberal.met) blockers.push(`通識博雅還差 ${round(liberal.need - liberal.earned)} 學分`);
  for (const dimension of liberal.dimensions) {
    if (!dimension.met) blockers.push(`博雅「${dimension.name}」還差 ${round(dimension.need - dimension.earned)} 學分`);
  }
  if (coreLabs && !coreLabs.met) blockers.push(`基礎實驗課程還差 ${coreLabs.need - coreLabs.have} 門`);
  for (const item of mustPass) {
    if (!item.passed) blockers.push(`${item.name}尚未通過`);
  }

  return {
    rows,
    semesters,
    buckets,
    picks,
    liberal,
    coreLabs,
    mustPass,
    overflow,
    total: { earned: totalEarned, need: need.total || 0, met: totalEarned >= (need.total || 0) },
    overall: {
      gpa: Object.fromEntries(SCALE_KEYS.map((scale) => [scale, gpaOf(rows, scale)])),
      ...averagesOf(rows, includeFailed),
      credits: totalEarned,
      graded: rows.filter((row) => row.graded).length,
      failed: rows.filter((row) => row.graded && !row.passed).length,
    },
    blockers,
    graduated: blockers.length === 0,
  };
}
