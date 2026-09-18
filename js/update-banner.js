// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.

// ============================================================
// شريط حالة التحديث التلقائي (التثبيت تلقائي بدون سؤال)
// ============================================================
import { escapeHtml } from "./utils-core.js";

function ensureUpdateBanner() {
  let banner = document.getElementById("updateStatusBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "updateStatusBanner";
    banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:99999;
      background:linear-gradient(90deg,#0d47a1,#1976d2);color:#fff;
      padding:10px 20px;text-align:center;font-weight:bold;font-size:14px;
      box-shadow:0 2px 10px rgba(0,0,0,0.5);display:none`;
    document.body.appendChild(banner);
  }
  return banner;
}

function showUpdateBanner(html) {
  const banner = ensureUpdateBanner();
  banner.innerHTML = html;
  banner.style.display = "block";
}

if (window.electronAPI && typeof require === "function") {
  const ipc = require("electron").ipcRenderer;
  ipc.on("update-available", (_, info) => {
    showUpdateBanner(
      `<i class="fas fa-rotate"></i> يتوفر تحديث جديد (${escapeHtml(info.version || "")}) - جاري التحميل…`,
    );
  });
  ipc.on("update-progress", (_, p) => {
    showUpdateBanner(
      `<i class="fas fa-arrow-down"></i> جاري تحميل التحديث… ${p.percent || 0}% - سيُثبَّت تلقائياً`,
    );
  });
  ipc.on("update-installing", (_, info) => {
    showUpdateBanner(
      `<i class="fas fa-gear"></i> جاري تثبيت التحديث (${escapeHtml(info.version || "")}) - سيعود التطبيق تلقائياً خلال لحظات، لا تغلقه…`,
    );
  });
}


export { ensureUpdateBanner, showUpdateBanner };
