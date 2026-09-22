// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth, showMessage } from "./utils-core.js";
import { overlayLinkFor, getScreenTokenCached } from "./overlay-links.js";

// ============================================================
// لوحة عداد الفوز/الخسارة — داخل الكارت الموحد في قسم الأوفرلايز
// الزيادة/النقصان تتم على السيرفر ذرياً وتُطبَّق من الاستجابة —
// فلا تعارض بين الأجهزة ولا انحراف بين اللوحة والأوفرلاي في OBS
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
  let saveTimer = null;

  function applySettings(s) {
    if (!s) return;
    $("smwWinVal").innerText = s.wins || 0;
    $("smwLossVal").innerText = s.losses || 0;
    $("smwWinLabel").value = s.winLabel || "WIN";
    $("smwLossLabel").value = s.lossLabel || "LOSE";
    $("smwTheme").value = s.theme || "pscontroller";
    $("smwWidth").value = s.width || 285;
  }

  async function loadSettings() {
    try {
      const token = await getScreenTokenCached();
      if (!token) return;
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
      );
      const data = await res.json();
      if (data.success) {
        applySettings(data.settings);
        const linkInput = $("smwLinkUrl");
        if (linkInput) linkInput.value = overlayLinkFor("wins");
      }
    } catch (e) {
      console.error("فشل تحميل إعدادات العداد:", e);
    }
  }
  window.winsLoadSettings = loadSettings;

  // حفظ الإعدادات النصية (الأسماء/الثيم/العرض) — الأرقام تُدار عبر wins-increment
  function saveMeta() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const token = await getScreenTokenCached();
        if (!token) return;
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
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

  // زيادة/نقصان ذرّية من السيرفر — الاستجابة هي مصدر الحقيقة
  async function bump(type, delta) {
    try {
      const token = await getScreenTokenCached();
      if (!token) return;
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/wins-increment?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, delta }),
        },
      );
      const data = await res.json();
      if (data.success) applySettings(data.settings);
    } catch (e) {
      console.error("فشل تحديث العداد:", e);
    }
  }

  $("smwWinPlus").onclick = () => bump("wins", 1);
  $("smwWinMinus").onclick = () => bump("wins", -1);
  $("smwLossPlus").onclick = () => bump("losses", 1);
  $("smwLossMinus").onclick = () => bump("losses", -1);
  $("smwReset").onclick = async () => {
    try {
      const token = await getScreenTokenCached();
      if (!token) return;
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wins: 0, losses: 0 }),
        },
      );
      const data = await res.json();
      if (data.success) applySettings(data.settings);
    } catch (e) {
      console.error("فشل تصفير العداد:", e);
    }
  };
  $("smwWinLabel").addEventListener("input", saveMeta);
  $("smwLossLabel").addEventListener("input", saveMeta);
  $("smwTheme").addEventListener("change", saveMeta);
  $("smwWidth").addEventListener("input", saveMeta);
  $("smwCopyLink").onclick = async () => {
    try {
      const token = await getScreenTokenCached();
      if (!token)
        return showMessage(
          "<i class='fas fa-circle-xmark'></i> فشل الحصول على التوكن",
        );
      await navigator.clipboard.writeText(overlayLinkFor("wins"));
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
      const token = await getScreenTokenCached();
      if (token && __S.frontendSocket && __S.frontendSocket.connected) {
        __S.frontendSocket.emit("get-wins-settings", token);
      }
    } catch (e) {}
  };
  if (__S.frontendSocket) {
    __S.frontendSocket.on("wins-updated", (s) => applySettings(s));
    __S.frontendSocket.on("wins-initial", (s) => applySettings(s));
    if (__S.frontendSocket.connected) joinWins();
    else __S.frontendSocket.on("connect", joinWins);
  }

  loadSettings();
}

export { initWinsPanel };
