# NTUTTools

給北科大學生的線上小工具。沒有打包步驟, 沒有後端 —— 瀏覽器直接載入原始的
`.js` 與 `.css`, 資料只留在自己的裝置上。

## 工具

| 工具 | 說明 |
| --- | --- |
| 教室資訊 | 教室依大樓分組, 查一週課表；找空教室可以一次指定一週裡的多個時段, 找出全部都空著的教室。 |
| 班級課表 | 依學院與系所查任一個班級的一週課表與完整課程清單。 |
| 學分大師 | 自己加課填分數, 算 GPA 與各類學分, 逐項對照畢業門檻。趨勢圖與占比圖都可以互動。 |

## 開發

```bash
node tools/serve.mjs 8790
```

一定要用 HTTP 伺服器開, 不能用 `file://` —— ES module 與 `fetch()` 都會被
same-origin 政策擋掉。這支伺服器一律回 `Cache-Control: no-store`, 改完重整
就會跑到新的檔案。

## 資料

`data/ntut-*.json` 都是從學校網站抓下來的快照, **不要手動編輯**。
課程系統沒有 CORS 標頭, 瀏覽器沒辦法即時去抓, 所以改成定期重抓成靜態檔。

```bash
node tools/build-rooms.mjs        # 教室課表（231 間, 約 1 分鐘）
node tools/build-classes.mjs      # 班級課表（61 系所 / 294 班, 約 4 分鐘）
node tools/build-curriculum.mjs   # 自己系的課程科目表與畢業門檻
node tools/build-courses.mjs      # 全校課程清單（49 個系所, 約 40 秒）
```

四支都吃 `--check`（只比對, 有落差就以非 0 結束, 適合放 CI）與 `--dry`
（只印摘要, 不寫檔）。學年度與學期用環境變數換:

```bash
NTUT_YEAR=115 NTUT_SEM=2 node tools/build-rooms.mjs
```

抓壞了不會覆蓋舊檔 —— 空白的資料比過期的資料難用得多, 所以每支都會先做
合理性檢查（教室數、班級數、課程數、節次表在不在）才寫。

修課人數（教室課表的 `[63人]`、班級課表的「人」欄）刻意不收: 那是即時的
選課數字, 每天都在動, 收進快照只會讓 `--check` 永遠報有落差。

## 加一個工具

1. 建 `js/tools/<id>/index.js`, 匯出 `mount(host, ctx)`:

   ```js
   export const styles = new URL("./my-tool.css", import.meta.url).href;  // 選填
   export const meta = { title: "我的工具" };                             // 選填

   export async function mount(host, { params, setParams }) {
     // …
     return () => { /* cleanup, 選填 */ };
   }
   ```

   `ctx.params` 是進站時的 query, `ctx.setParams()` 把檢視寫回網址 ——
   這是工具與路由之間唯一的接觸面。共用的控制項在 `js/tools/kit.js`,
   課表格線在 `js/tools/timetable.js`（檢視用的 `timetable()` 與多選用的
   `timetablePicker()`；`styles` 可以是陣列, 一起載）。

2. 在 `data/tools.json` 加一筆（`id` 要跟資料夾同名）。
3. 把新檔案補進 `sw.js` 的 `SHELL` 清單, 並把 `CACHE_VERSION` 加一版 ——
   工具是動態載入的, 沒先快取起來離線時會變成錯誤訊息。

## 結構

```
index.html          app shell（側邊欄 + #page-outlet）
pages/*.html        各路由的 HTML 片段
css/theme.css       全站唯一的顏色與尺寸來源, 元件樣式不寫死色碼
js/core/router.js   hash 路由, 只換掉 #page-outlet
js/services/        資料載入與工具載入
js/tools/<id>/      一個工具一個資料夾, 外面只認 index.js
js/tools/timetable.js  課表格線（檢視 + 多選）, 教室資訊與班級課表共用
tools/*.mjs         抓資料與開發伺服器
```
