// js/core/router.js — hash 路由: 只換掉 #page-outlet, 側邊欄一直活著。

import { icon } from "../utils/utils.js";
import { getSite } from "../services/data-service.js";

const ROUTES = {
  home: { fragment: "pages/home.html", module: "../pages/home.js", label: "首頁", icon: "home", nav: true },
  tools: { fragment: "pages/tools.html", module: "../pages/tools.js", label: "工具", icon: "tool", nav: true },
  tool: { fragment: "pages/tool.html", module: "../pages/tool.js", label: "工具", nav: false },
  "not-found": { fragment: "pages/not-found.html", module: "../pages/not-found.js", label: "找不到頁面", nav: false },
};

const FALLBACK_TITLE = "NTUTTools";
let cleanup = null;
let started = false;
let renderRevision = 0;

export function routeTo(name, params = {}) {
  location.hash = buildHash(name, params);
}

/** 組出某個路由的 hash, 空參數會被丟掉。 */
export function buildHash(name, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, value);
  }
  const query = search.toString();
  return `#/${name}${query ? `?${query}` : ""}`;
}

/**
 * 只換掉目前路由的 query, 不重新掛載頁面。
 * 列表與工具用它把搜尋條件寫進網址, 又不讓每個按鍵都塞進瀏覽紀錄。
 */
export function replaceParams(name, params = {}) {
  const hash = buildHash(name, params);
  if (hash === location.hash) return;
  history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
}

export function readRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return { name: "home", params: new URLSearchParams() };
  const [name, query = ""] = raw.split("?");
  return {
    name: ROUTES[name] ? name : "not-found",
    params: new URLSearchParams(query),
  };
}

/** 單一工具頁沒有自己的導覽項目, 點亮的是「工具」。 */
function navParent(routeState) {
  return routeState.name === "tool" ? "tools" : routeState.name;
}

export function renderNavigation(activeName = navParent(readRoute())) {
  const host = document.getElementById("primary-nav");
  if (!host) return;
  host.replaceChildren();
  for (const [name, route] of Object.entries(ROUTES)) {
    if (!route.nav) continue;
    const link = document.createElement("a");
    link.className = "nav-link";
    link.href = `#/${name}`;
    link.title = route.label;
    const isActive = name === activeName;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.innerHTML = icon(route.icon, { size: "18px" });
    const label = document.createElement("span");
    label.className = "nav-label";
    label.textContent = route.label;
    link.append(ico, label);
    host.appendChild(link);
  }
}

/** 站名只有 site.json 一個來源；抓不到就退回常數。 */
async function siteTitle() {
  try {
    const site = await getSite();
    return site.title || FALLBACK_TITLE;
  } catch {
    return FALLBACK_TITLE;
  }
}

export async function renderRoute() {
  const revision = ++renderRevision;
  const routeState = readRoute();
  const route = ROUTES[routeState.name];
  cleanup?.();
  cleanup = null;
  renderNavigation(navParent(routeState));
  const outlet = document.getElementById("page-outlet");
  outlet.innerHTML = '<div class="state-block" role="status"><div class="spinner" aria-hidden="true"></div>載入頁面…</div>';
  try {
    const [response, controller, title] = await Promise.all([
      fetch(route.fragment),
      import(route.module),
      siteTitle(),
    ]);
    if (!response.ok) throw new Error(`無法載入 ${route.fragment}`);
    const html = await response.text();
    if (revision !== renderRevision) return;
    outlet.innerHTML = html;
    document.title = routeState.name === "home" ? title : `${route.label} · ${title}`;
    cleanup = await controller.mountPage({
      params: routeState.params,
      route: { name: routeState.name, ...route },
      routeTo,
    }) || null;
  } catch (error) {
    console.error(error);
    outlet.innerHTML = `<div class="banner banner-danger" role="alert">頁面載入失敗: ${error.message}。請重新整理頁面後再試一次。</div>`;
  }
}

export function startRouter() {
  if (!started) {
    window.addEventListener("hashchange", renderRoute);
    started = true;
  }
  if (!location.hash || location.hash === "#/") location.hash = "#/home";
  else renderRoute();
}
