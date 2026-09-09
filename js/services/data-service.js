// js/services/data-service.js — 載入並快取 data/ 底下的 JSON。
//
// data/site.json 與 data/tools.json 是手寫的。
// data/ntut-*.json 由 tools/build-*.mjs 從學校網站抓下來, 請不要手動編輯。

import { loadJSON } from "../utils/utils.js";

const SITE_URL = "data/site.json";
const TOOLS_URL = "data/tools.json";

/** 每個網址只抓一次；失敗時把自己清掉, 之後重試才有機會成功。 */
function cached() {
  const store = new Map();
  return (url, transform) => {
    if (!store.has(url)) {
      store.set(url, loadJSON(url)
        .then(transform)
        .catch((err) => { store.delete(url); throw err; }));
    }
    return store.get(url);
  };
}
const load = cached();

/** data/site.json 全部內容: 站台資訊、類別與標籤。 */
export async function getSite() {
  return load(SITE_URL, (data) => data || {});
}

/** labels.js 需要的 { categories, tags }。 */
export async function getConfig() {
  const site = await getSite();
  return { categories: site.categories || {}, tags: site.tags || {} };
}

/** 所有工具, 依 data/tools.json 裡的順序。 */
export async function getTools() {
  return load(TOOLS_URL, (data) => (Array.isArray(data) ? data : data.tools || []));
}

/** 用 id 找單一工具, 找不到回傳 null。 */
export async function getToolById(id) {
  const tools = await getTools();
  return tools.find((tool) => tool.id === id) || null;
}
