// js/tools/credit-master/storage.js — 成績存哪裡。
//
// 三層, 由近到遠:
//
//   1. 這台瀏覽器（localStorage）—— 一直開著, 不用設定, 離線也在
//   2. 自己的 Google Sheet, 貼連結就能**讀**
//   3. 自己部署的 Apps Script, 才能**寫**回 Sheet
//
// 為什麼讀寫要分兩個網址: docs.google.com 對匯出網址是有回
// Access-Control-Allow-Origin 的, 所以貼一個「知道連結的人可檢視」的
// Sheet 就讀得到。但寫入需要授權, 純前端拿不到 —— 除非使用者自己在那份
// Sheet 上部署一小段 Apps Script, 那段程式以「他自己」的身分執行, 
// 我們只是去呼叫它。這樣一來, 資料從頭到尾都只在使用者自己的帳號裡。

const LOCAL_KEY = "ntuttools.credit-master";

/* ============================ 這台瀏覽器 ============================ */

/**
 * 讀回這台瀏覽器存的資料。
 *
 * 檢查的欄位一定要跟實際存的形狀一致。條件寫錯（去檢查一個不存在的欄位）
 * 的話會每次都當成沒存過, 使用者一重新整理成績就全部不見, 而且不會報錯。
 *
 * 順便把舊版的形狀（scores 物件 + custom 陣列）轉成現在的 entries 陣列, 
 * 免得先前存的成績因為改版而讀不回來。
 */
export function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if (Array.isArray(parsed.entries)) return parsed;

    if (parsed.scores && typeof parsed.scores === "object") {
      const entries = Object.entries(parsed.scores)
        .filter(([, score]) => String(score ?? "").trim() !== "")
        .map(([key, score]) => {
          const cut = key.indexOf("|");
          return { semester: key.slice(0, cut), name: key.slice(cut + 1), score: String(score) };
        });
      const custom = Array.isArray(parsed.custom) ? parsed.custom : [];
      const { scores, custom: _drop, ...rest } = parsed;
      return { ...rest, entries: [...entries, ...custom] };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocal(state) {
  // 存不進去（無痕、容量滿）不該讓使用者正在輸入的東西整個中斷。
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* 沒有就算了 */ }
}

/* ============================ 表格編碼 ============================ */

/** 寫進 Sheet 的欄位順序。順序改了舊資料就讀不回來, 所以固定。 */
export const COLUMNS = ["學期", "課程名稱", "分數", "學分", "類別", "向度"];

/**
 * 一列 CSV。有逗號、引號或換行的欄位要加引號, 引號本身要成對。
 * 課名裡出現冒號、括號很常見, 逗號也不是不可能。
 */
function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 成績 → 可以直接貼進 Sheet 的 TSV（用定位字元, 貼上時會自動分欄）。 */
export function toTable(entries, { separator = "\t" } = {}) {
  const lines = [COLUMNS.join(separator)];
  for (const entry of entries) {
    lines.push([
      entry.semester, entry.name, entry.score ?? "",
      entry.credit ?? "", entry.category ?? "", entry.dimension ?? "",
    ].map((cell) => (separator === "," ? csvCell(cell) : String(cell ?? ""))).join(separator));
  }
  return lines.join("\n");
}

/**
 * 解析 CSV。
 *
 * 自己寫是因為要處理引號內的逗號與換行, `split(",")` 在課名有逗號時
 * 會把一列拆成兩欄, 而且錯得很安靜。
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell); cell = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += char;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((line) => line.some((value) => String(value).trim() !== ""));
}

/**
 * 表格列 → 成績。
 * 認欄位標題, 不靠欄位順序 —— 使用者在 Sheet 裡調動欄位是很正常的事。
 */
export function fromTable(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((cell) => String(cell).trim());
  const at = (...names) => header.findIndex((cell) => names.includes(cell));

  const columns = {
    semester: at("學期", "semester", "Semester"),
    name: at("課程名稱", "課程", "name", "Name"),
    score: at("分數", "成績", "score", "Score"),
    credit: at("學分", "credit", "Credit"),
    category: at("類別", "category"),
    dimension: at("向度", "dimension"),
  };
  // 找不到標題就退回固定欄序, 至少還讀得到東西。
  if (columns.semester < 0 || columns.name < 0) {
    columns.semester = 0; columns.name = 1; columns.score = 2;
    columns.credit = 3; columns.category = 4; columns.dimension = 5;
  }

  const pick = (row, index) => (index >= 0 && index < row.length ? String(row[index]).trim() : "");
  const body = rows.slice(header.includes("課程名稱") || header.includes("name") ? 1 : 0);

  return body
    .map((row) => ({
      semester: pick(row, columns.semester),
      name: pick(row, columns.name),
      score: pick(row, columns.score),
      credit: pick(row, columns.credit),
      category: pick(row, columns.category),
      dimension: pick(row, columns.dimension),
    }))
    .filter((entry) => entry.semester && entry.name);
}

/* ============================ Google Sheet ============================ */

/** 從各種形狀的網址裡挖出試算表 id 與工作表 gid。 */
export function parseSheetUrl(url) {
  const text = String(url || "").trim();
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(text)
    || /^([a-zA-Z0-9-_]{20,})$/.exec(text);
  if (!id) return null;
  const gid = /[#&?]gid=(\d+)/.exec(text);
  return { id: id[1], gid: gid ? gid[1] : null };
}

/**
 * 讀一份「知道連結的人可檢視」的 Sheet。
 * 用 gviz 的 CSV 輸出: 它不需要發佈到網路, 只要連結可檢視就行。
 */
export async function readSheet(url, { signal } = {}) {
  const target = parseSheetUrl(url);
  if (!target) throw new Error("這不像 Google Sheet 的連結");

  const query = new URLSearchParams({ tqx: "out:csv" });
  if (target.gid) query.set("gid", target.gid);
  const endpoint = `https://docs.google.com/spreadsheets/d/${target.id}/gviz/tq?${query}`;

  const response = await fetch(endpoint, { signal });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? "找不到這份 Sheet, 或它不是「知道連結的人可檢視」"
      : `讀取失敗（HTTP ${response.status}）`);
  }
  const text = await response.text();
  // 沒有權限時 Google 會回一頁 HTML 而不是 CSV。
  if (/^\s*</.test(text)) throw new Error("這份 Sheet 沒有開放檢視權限");
  return fromTable(parseCsv(text));
}

/* ============================ Apps Script ============================ */

const isExecUrl = (url) => /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(String(url || "").trim());

/**
 * 呼叫使用者自己部署的 Apps Script。
 *
 * 刻意不設 Content-Type。fetch 給字串 body 時預設是
 * `text/plain;charset=UTF-8`, 屬於「簡單請求」, 瀏覽器不會先送 preflight；
 * 一旦改成 application/json 就會觸發 OPTIONS, 而 Apps Script 不回應
 * OPTIONS, 整個請求就掛了。
 */
async function callScript(url, payload, { signal } = {}) {
  if (!isExecUrl(url)) throw new Error("這不像 Apps Script 的部署網址");
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
    redirect: "follow",
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    // 部署權限沒開成「任何人」的時候, Google 會回登入頁面。
    throw new Error("回應不是 JSON, 通常是部署時「誰可以存取」沒有設成「任何人」");
  }
  if (result.error) throw new Error(result.error);
  return result;
}

export function pullFromScript(url, options) {
  return callScript(url, { action: "read" }, options);
}

export function pushToScript(url, state, options) {
  return callScript(url, {
    action: "write",
    entries: state.entries,
    ranks: state.ranks,
    scale: state.scale,
  }, options);
}

/**
 * 要貼進 Sheet 的 Apps Script。
 *
 * 故意寫得很短、也只碰它自己那份試算表 —— 使用者要看得懂自己貼了什麼。
 * 「成績」與「學期」兩個工作表不存在時會自己建。
 */
export const APPS_SCRIPT = `// 學分大師 — 貼到 Google Sheet 的「擴充功能 → Apps Script」
// 部署方式: 部署 → 新增部署作業 → 類型選「網頁應用程式」
//           執行身分「我」、誰可以存取「任何人」→ 部署 → 複製網址

const GRADE_SHEET = '成績';
const TERM_SHEET = '學期';
const GRADE_HEADER = ['學期', '課程名稱', '分數', '學分', '類別', '向度'];
const TERM_HEADER = ['學期', '排名', '排名%'];

function doGet() {
  return reply(read());
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'read') return reply(read());
    write(body);
    return reply({ ok: true, saved: (body.entries || []).length });
  } catch (err) {
    return reply({ error: String(err) });
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetNamed(name, header) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(header);
  }
  return sheet;
}

function read() {
  const grades = sheetNamed(GRADE_SHEET, GRADE_HEADER).getDataRange().getValues();
  const terms = sheetNamed(TERM_SHEET, TERM_HEADER).getDataRange().getValues();

  const entries = grades.slice(1)
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      return {
        semester: String(r[0]).trim(), name: String(r[1]).trim(),
        score: r[2] === '' ? '' : r[2], credit: r[3] === '' ? '' : r[3],
        category: String(r[4] || '').trim(), dimension: String(r[5] || '').trim()
      };
    });

  const ranks = {};
  terms.slice(1).forEach(function (r) {
    if (!r[0]) return;
    ranks[String(r[0]).trim()] = { rank: r[1] === '' ? null : r[1], percent: r[2] === '' ? null : r[2] };
  });

  return { ok: true, entries: entries, ranks: ranks };
}

function write(body) {
  const grades = sheetNamed(GRADE_SHEET, GRADE_HEADER);
  grades.clear();
  const rows = (body.entries || []).map(function (e) {
    return [e.semester || '', e.name || '', e.score === null ? '' : e.score,
            e.credit === null ? '' : e.credit, e.category || '', e.dimension || ''];
  });
  grades.getRange(1, 1, 1, GRADE_HEADER.length).setValues([GRADE_HEADER]);
  if (rows.length) grades.getRange(2, 1, rows.length, GRADE_HEADER.length).setValues(rows);

  const terms = sheetNamed(TERM_SHEET, TERM_HEADER);
  terms.clear();
  const rankRows = Object.keys(body.ranks || {}).map(function (k) {
    const v = body.ranks[k] || {};
    return [k, v.rank === null ? '' : v.rank, v.percent === null ? '' : v.percent];
  });
  terms.getRange(1, 1, 1, TERM_HEADER.length).setValues([TERM_HEADER]);
  if (rankRows.length) terms.getRange(2, 1, rankRows.length, TERM_HEADER.length).setValues(rankRows);
}
`;
