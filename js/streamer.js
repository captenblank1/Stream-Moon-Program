// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth, safeImageUrl } from "./utils-core.js";

// ============================================================
// دوال تحديث صور البث
// ============================================================
// ✅ منع إعادة الكتابة بنفس القيم كل 10 ثوانٍ — كانت img.src تُضبط من
// جديد حتى بلا تغيير حقيقي فتسبب إعادة تحميل/رسم وإزعاج الكاش
let lastStreamerPicture = null;
let lastStreamerNickname = null;

async function updateStreamerImages(force = false) {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/streamer`);
    if (!res.ok) return;
    const data = await res.json();
    const img1 = document.getElementById("liveOwnerImg1");
    const img2 = document.getElementById("liveOwnerImg2");
    const nicknameEl = document.getElementById("liveOwnerText");
    if (!img1 || !img2 || !nicknameEl) return;
    let currentPicture = "images/img1.jpg";
    let currentNickname = "Stream Moon";
    if (data.isLive) {
      // ✅ فحص المخطط قبل الاستخدام
      if (data.profilePicture) currentPicture = safeImageUrl(data.profilePicture) || currentPicture;
      if (data.nickname) currentNickname = data.nickname;
    }
    if (
      !force &&
      currentPicture === lastStreamerPicture &&
      currentNickname === lastStreamerNickname
    )
      return;
    lastStreamerPicture = currentPicture;
    lastStreamerNickname = currentNickname;
    img1.src = currentPicture;
    img2.src = currentPicture;
    nicknameEl.textContent = currentNickname;
  } catch (err) {
    console.error("❌ خطأ في updateStreamerImages:", err);
  }
}

// استبدال الاستدعاء الأولي في init (أو في أي مكان) بما يلي:
function startStreamerUpdates() {
  if (__S.streamerTimer) clearInterval(__S.streamerTimer);
  __S.streamerTimer = setInterval(() => updateStreamerImages(), 10000); // كل 10 ثوانٍ بدلاً من 1 ثانية
  updateStreamerImages(); // تشغيل فوري
}


export { updateStreamerImages, startStreamerUpdates };
