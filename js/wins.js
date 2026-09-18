// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { initListsPanel } from "./overlay.js";

// ============================================================
// لوحة عداد الفوز/الخسارة الأصلية (بدون حقن صفحات خارجية)
// ============================================================

async function initWinsPanel() {
  if (__S.winsPanelInitDone) {
    // تحديث الأرقام والإعدادات عند كل فتح للسيكشن
    if (typeof window.winsLoadSettings === "function")
      window.winsLoadSettings();
    return;
  }
  __S.winsPanelInitDone = true;

  const $ = (id) => document.getElementById(id);
  let screenToken = null;
  let saveTimer = null;

  async function getScreenToken() {
    if (screenToken) return screenToken;
    const res = await fetchWithAuth(`${__S.API_BASE}/api/user/screen-token`);
    const data = await res.json();
    const linkInput = $("smwLinkUrl");
    if (data.success) {
      screenToken = data.token;
      if (linkInput) {
        // ✅ الصيغة القصيرة الجميلة فقط — الروابط القديمة أُزيلت
        linkInput.value = `${__S.WIDGET_BASE}/widget/wins?cid=${encodeURIComponent(data.widgetId)}`;
        if (window.updateOverlayPreviews) window.updateOverlayPreviews();
      }
    } else if (linkInput) {
      linkInput.value = "فشل تحميل الرابط — تأكد من تسجيل الدخول";
    }
    return screenToken;
  }

  function applySettings(s) {
    $("smwWinVal").innerText = s.wins || 0;
    $("smwLossVal").innerText = s.losses || 0;
    $("smwPrevWNum").innerText = s.wins || 0;
    $("smwPrevLNum").innerText = s.losses || 0;
    $("smwPrevWLabel").innerText = s.winLabel || "WIN";
    $("smwPrevLLabel").innerText = s.lossLabel || "LOSE";
    $("smwWinLabel").value = s.winLabel || "WIN";
    $("smwLossLabel").value = s.lossLabel || "LOSE";
    $("smwTheme").value = s.theme || "pscontroller";
    $("smwWidth").value = s.width || 285;
    const box = $("smwPreview");
    box.className = "smw-box " + (s.theme || "pscontroller");
    box.style.minWidth = (s.width || 285) + "px";
    const bow = $("smwKittyBow");
    if (bow)
      bow.style.display =
        (s.theme || "pscontroller") === "kitty" ? "block" : "none";
  }

  async function loadSettings() {
    try {
      const token = await getScreenToken();
      if (!token) return;
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
      );
      const data = await res.json();
      if (data.success) applySettings(data.settings);
    } catch (e) {
      console.error("فشل تحميل إعدادات العداد:", e);
    }
  }
  window.winsLoadSettings = loadSettings;

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const token = await getScreenToken();
        if (!token) return;
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wins: parseInt($("smwWinVal").innerText) || 0,
              losses: parseInt($("smwLossVal").innerText) || 0,
              winLabel: $("smwWinLabel").value || "WIN",
              lossLabel: $("smwLossLabel").value || "LOSE",
              theme: $("smwTheme").value,
              width: parseInt($("smwWidth").value) || 285,
            }),
          },
        );
        const data = await res.json();
        if (data.success) applySettings(data.settings);
      } catch (e) {
        console.error("فشل حفظ إعدادات العداد:", e);
      }
    }, 400);
  }

  function add(type, val) {
    const id = type === "wins" ? "smwWinVal" : "smwLossVal";
    const current = parseInt($(id).innerText) || 0;
    $(id).innerText = Math.max(0, current + val);
    saveSettings();
  }

  $("smwWinPlus").onclick = () => add("wins", 1);
  $("smwWinMinus").onclick = () => add("wins", -1);
  $("smwLossPlus").onclick = () => add("losses", 1);
  $("smwLossMinus").onclick = () => add("losses", -1);
  $("smwReset").onclick = () => {
    $("smwWinVal").innerText = 0;
    $("smwLossVal").innerText = 0;
    saveSettings();
  };
  $("smwWinLabel").addEventListener("input", saveSettings);
  $("smwLossLabel").addEventListener("input", saveSettings);
  $("smwTheme").addEventListener("change", () => {
    const box = $("smwPreview");
    box.className = "smw-box " + $("smwTheme").value;
    const bow = $("smwKittyBow");
    if (bow)
      bow.style.display = $("smwTheme").value === "kitty" ? "block" : "none";
    saveSettings();
  });
  $("smwWidth").addEventListener("input", () => {
    $("smwPreview").style.minWidth =
      (parseInt($("smwWidth").value) || 285) + "px";
    saveSettings();
  });
  $("smwCopyLink").onclick = async () => {
    try {
      const token = await getScreenToken();
      if (!token)
        return showMessage(
          "<i class='fas fa-circle-xmark'></i> فشل الحصول على التوكن",
        );
      const url = $("smwLinkUrl").value;
      await navigator.clipboard.writeText(url);
      showMessage(
        "<i class='fas fa-circle-check'></i> تم نسخ رابط العداد لـ OBS",
      );
    } catch (e) {
      showMessage("<i class='fas fa-circle-xmark'></i> خطأ في النسخ");
    }
  };

  // تحديثات لحظية من السوكيت (مثلاً من جهاز/تابلت تاني)
  const joinWins = async () => {
    try {
      const token = await getScreenToken();
      if (token && __S.frontendSocket && __S.frontendSocket.connected) {
        __S.frontendSocket.emit("get-wins-settings", token);
      }
    } catch (e) {}
  };
  if (__S.frontendSocket) {
    __S.frontendSocket.on("wins-updated", (s) => s && applySettings(s));
    __S.frontendSocket.on("wins-initial", (s) => s && applySettings(s));
    if (__S.frontendSocket.connected) joinWins();
    else __S.frontendSocket.on("connect", joinWins);
  }

  loadSettings();
}

// ============================================================
// دوال Overlay
// ============================================================\

async function loadOverlayTab(tab) {
  const winsPanel = document.getElementById("winsPanelNative");
  const listsPanel = document.getElementById("listsPanelNative");

  document.querySelectorAll(".overlay-tab-btn").forEach((btn) => {
    const isTab = btn.dataset.tab === tab;
    btn.classList.toggle("active", isTab);
    btn.style.background = isTab ? "#1dd9e6e1" : "transparent";
    btn.style.color = isTab ? "#000" : "#aaa";
  });

  if (tab === "wins") {
    if (listsPanel) listsPanel.style.display = "none";
    if (winsPanel) {
      winsPanel.style.display = "block";
      initWinsPanel();
    }
  } else {
    if (winsPanel) winsPanel.style.display = "none";
    if (listsPanel) {
      listsPanel.style.display = "block";
      initListsPanel();
    }
  }
}


export { initWinsPanel, loadOverlayTab };
