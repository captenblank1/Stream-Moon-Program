// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { setConnectBtnState } from "./tiktok.js";
// ✅ كتابة هوية/حالة الاتصال عبر السياق الموحد user-context.js
import { setConnectionStatus, setSidebarUsername } from "./user-context.js";

// ============================================================
// دوال الحالة المباشرة (Live Status)
// ============================================================
// ✅ نصوص الحالة تمر عبر قاموس الترجمة — الكتابة المباشرة بالإنجليزية
// كانت تقلب الواجهة للإنجليزية بعد أول تحديث حالة واللغة عربية
const t = (s) => (window.AppI18n ? AppI18n.t(s) : s);

function updateUIForDisconnected() {
  __S.isLiveConnected = false;
  setConnectBtnState("connect");
  setConnectionStatus("Disconnected", "red");
  const connectProfile = document.getElementById("connect-profile-aside");
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
    const userInput = document.getElementById("user-tiktok");
    const connectProfile = document.getElementById("connect-profile-aside");

    if (data.username && document.activeElement !== userInput) {
      userInput.value = data.username;
    }

    if (data.isLive === true) {
      __S.isLiveConnected = true;
      setConnectBtnState("disconnect");
      setSidebarUsername(data.username || "");
      setConnectionStatus("Connected", "#1dd9e6e1");
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
