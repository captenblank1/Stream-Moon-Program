// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { cleanupFrontend } from "./init.js";
import { checkForChangesAndClose } from "./commands.js";

// ============================================================
// ربط المستمعين الإضافيين
// ============================================================
window.addEventListener("beforeunload", () => {
  if (__S.isLiveConnected) {
    fetchWithAuth(`${__S.API_BASE}/api/tiktok-disconnect`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }
  cleanupFrontend();
});

document
  .getElementById("cardOverlay")
  ?.addEventListener("click", checkForChangesAndClose);



if (__S.overlayCheckbox && __S.overlayTextGroup) {
  __S.overlayCheckbox.addEventListener("change", (e) => {
    __S.overlayTextGroup.style.display = e.target.checked ? "block" : "none";
  });
}

