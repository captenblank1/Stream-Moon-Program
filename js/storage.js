// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";

// ============================================================
// دوال التخزين
// ============================================================
function updateStorageUI(storageData) {
  if (!storageData) return;
  const audioUsed = storageData.audio.usedMB;
  const audioLimit = storageData.audio.limitMB;
  const videoUsed = storageData.video.usedMB;
  const videoLimit = storageData.video.limitMB;

  const audioProgress = document.getElementById("audio-progress");
  const audioText = document.getElementById("audio-storage-text");
  const videoProgress = document.getElementById("video-progress");
  const videoText = document.getElementById("video-storage-text");

  if (audioProgress) {
    audioProgress.value = audioUsed;
    audioProgress.max = audioLimit;
    audioText.textContent = `${audioUsed.toFixed(1)} / ${audioLimit} ميجا`;
  }
  if (videoProgress) {
    videoProgress.value = videoUsed;
    videoProgress.max = videoLimit;
    videoText.textContent = `${videoUsed.toFixed(1)} / ${videoLimit} ميجا`;
  }
}

async function checkStorageNotifications() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/user/storage`);
    const data = await res.json();
    if (data.success) {
      // تحديث أشرطة التقدم فقط
      updateStorageUI({
        audio: { usedMB: data.audio.usedMB, limitMB: data.audio.limitMB },
        video: { usedMB: data.video.usedMB, limitMB: data.video.limitMB },
      });

      // ✅ إخفاء الإشعار الثابت نهائياً (لأنه سيتم عبر لوحة الأدمن)
      __S._storageRetryCount = 0;
      const storageNotif = document.getElementById("storage-notification");
      if (storageNotif) {
        storageNotif.style.display = "none";
      }
    }
  } catch (err) {
    console.warn("فشل تحديث حالة التخزين", err);
    // ✅ حد أقصى 5 محاولات بتراجع متزايد — كانت إعادة محاولة كل ثانية للأبد
    __S._storageRetryCount = (__S._storageRetryCount || 0) + 1;
    if (__S._storageRetryCount <= 5) {
      const delay = Math.min(1000 * __S._storageRetryCount, 10000);
      setTimeout(() => checkStorageNotifications(), delay);
    }
  }
}


export { updateStorageUI, checkStorageNotifications };
