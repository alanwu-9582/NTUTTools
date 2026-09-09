// js/ui/sidebar.js — sidebar rail on desktop, collapsible menu on narrow screens.

const MOBILE_QUERY = "(max-width: 768px)";

export function initSidebarToggle() {
  const nav = document.getElementById("side-nav");
  const toggle = document.getElementById("sidebar-toggle");
  const menuToggle = document.getElementById("nav-menu-toggle");
  if (!nav) return;

  const mobile = window.matchMedia(MOBILE_QUERY);

  /* ---------- desktop: collapse to an icon rail ---------- */

  function applyCollapsed(collapsed) {
    nav.classList.toggle("collapsed", collapsed);
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? "展開側邊欄" : "收合側邊欄";
    toggle.setAttribute("aria-label", toggle.title);
  }

  toggle?.addEventListener("click", () => applyCollapsed(!nav.classList.contains("collapsed")));

  /* ---------- narrow screens: hamburger menu ---------- */

  function applyMenu(open) {
    nav.classList.toggle("menu-open", open);
    if (!menuToggle) return;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.title = open ? "關閉選單" : "選單";
    menuToggle.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
  }

  menuToggle?.addEventListener("click", () => applyMenu(!nav.classList.contains("menu-open")));

  // Picking a destination is the end of the interaction — close behind it.
  nav.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link, .brand")) applyMenu(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("menu-open")) {
      applyMenu(false);
      menuToggle?.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("menu-open")) return;
    if (!nav.contains(e.target)) applyMenu(false);
  });

  // The two modes are mutually exclusive, so reset both on every crossover.
  mobile.addEventListener("change", () => { applyCollapsed(false); applyMenu(false); });
  applyCollapsed(false);
  applyMenu(false);
}
