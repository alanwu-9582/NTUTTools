// js/ui/modal.js — accessible modal dialog helper.

import { icon } from "../utils/utils.js";

let activeModal = null;
let lastFocused = null;

function trapFocus(e) {
  if (!activeModal || e.key !== "Tab") return;
  const focusables = activeModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const list = Array.from(focusables).filter((n) => !n.disabled && n.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

function onKeydown(e) {
  if (e.key === "Escape") closeModal();
  else trapFocus(e);
}

/**
 * Open a modal.
 * @param {{title:string, body:HTMLElement|string, footer?:HTMLElement,
 *          onClose?:Function, maxWidth?:string, className?:string}} cfg
 */
export function openModal(cfg) {
  closeModal();
  lastFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 id="modal-title"></h2>
        <button class="modal-close" type="button" aria-label="關閉">${icon("x", { size: "16px" })}</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  const modal = overlay.querySelector(".modal");
  if (cfg.maxWidth) modal.style.maxWidth = cfg.maxWidth;
  if (cfg.className) modal.classList.add(...String(cfg.className).split(/\s+/).filter(Boolean));
  overlay.querySelector("#modal-title").textContent = cfg.title;

  const bodyHost = overlay.querySelector(".modal-body");
  if (typeof cfg.body === "string") bodyHost.innerHTML = cfg.body;
  else bodyHost.appendChild(cfg.body);

  if (cfg.footer) {
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    foot.appendChild(cfg.footer);
    modal.appendChild(foot);
  }

  overlay.querySelector(".modal-close").addEventListener("click", () => closeModal());
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

  document.body.appendChild(overlay);
  activeModal = overlay;
  activeModal._onClose = cfg.onClose;
  document.addEventListener("keydown", onKeydown);
  // Force a style flush so the opening transition still animates, without
  // relying on requestAnimationFrame (throttled in background/hidden tabs,
  // which would otherwise leave the overlay stuck at opacity 0).
  void overlay.offsetWidth;
  overlay.classList.add("open");
  const first = modal.querySelector("input, select, textarea, button:not(.modal-close)");
  // preventScroll 是必要的: 內容比對話框高的時候, 一般的 focus() 會把那個
  // 元素捲進視野, 對話框就開在半路上, 看起來像壞掉。捲位置由下一行決定。
  (first || modal.querySelector(".modal-close") || modal).focus({ preventScroll: true });
  modal.scrollTop = 0;

  return { overlay, close: closeModal };
}

export function closeModal() {
  if (!activeModal) return;
  const overlay = activeModal;
  const cb = overlay._onClose;
  activeModal = null;
  document.removeEventListener("keydown", onKeydown);
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 160);
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  if (typeof cb === "function") cb();
}
