// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { setConnectBtnState } from "./tiktok.js";

// ============================================================
// دوال الحالة المباشرة (Live Status)
// ============================================================
// ✅ نصوص الحالة تمر عبر قاموس الترجمة — الكتابة المباشرة بالإنجليزية
// كانت تقلب الواجهة للإنجليزية بعد أول تحديث حالة واللغة عربية
const t = (s) => (window.AppI18n ? AppI18n.t(s) : s);

function updateUIForDisconnected() {
  const connectText = document.getElementById("connect-text");
  const connectProfile = document.getElementById("connect-profile-aside");
  __S.isLiveConnected = false;
  setConnectBtnState("connect");
  if (connectText) {
    connectText.textContent = t("Disconnected");
    connectText.style.color = "red";
  }
  if (connectProfile) {
    connectProfile.style.pointerEvents = "auto";
    connectProfile.style.opacity = 1;
  }
}

async function checkLiveStatus() {
  if (__S.liveStatusCheckInProgress) return;
  __S.liveStatusCheckInProgress = true;
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/live-status`);
    if (!res.ok) {
      updateUIForDisconnected();
      __S.liveStatusCheckInProgress = false;
      return;
    }
    const data = await res.json();
    const connectText = document.getElementById("connect-text");
    const tiktokDisplay = document.getElementById("tiktok-display");
    const connectProfile = document.getElementById("connect-profile-aside");
    const userInput = document.getElementById("user-tiktok");

    if (data.username && document.activeElement !== userInput) {
      userInput.value = data.username;
    }

    if (data.isLive === true) {
      __S.isLiveConnected = true;
      setConnectBtnState("disconnect");
      tiktokDisplay.textContent = data.username || "username";
      if (connectText) {
        connectText.textContent = t("Connected");
        connectText.style.color = "#1dd9e6e1";
      }
      if (connectProfile) {
        connectProfile.style.pointerEvents = "none";
        connectProfile.style.opacity = 0.6;
      }
    } else {
      updateUIForDisconnected();
    }
  } catch (err) {
    console.error("❌ [checkLiveStatus] فشل الاتصال:", err);
    updateUIForDisconnected();
  } finally {
    __S.liveStatusCheckInProgress = false;
  }
}


export { updateUIForDisconnected, checkLiveStatus };
