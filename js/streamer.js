// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
// ✅ كتابة الهوية عبر السياق الموحد — كاتب واحد لكل عقد الواجهة
import { applyStreamerIdentity } from "./user-context.js";

// ============================================================
// تحديث هوية صاحب البث (صورة/اسم/يوزر) — جلب من /api/streamer ثم
// تطبيقها مركزياً على كل العقد. يعرض الحساب الحقيقي حتى بدون لايف
// بدل القيم الافتراضية (username / صورة البرنامج)
// ============================================================
async function updateStreamerImages(force = false) {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/streamer`);
    if (!res.ok) return;
    const data = await res.json();
    applyStreamerIdentity({
      username: data.username,
      nickname: data.nickname,
      profilePicture: data.profilePicture,
    });
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
