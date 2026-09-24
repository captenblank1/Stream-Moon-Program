// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { escapeHtml } from "./utils-core.js";
import { overlayBase } from "./overlay-links.js";

// ============================================================
// دوال الشاشات (Screens)
// ============================================================
// بناء كروت الشاشات — cid يُترك فارغاً للمستخدم غير المسجل (روابط ثابتة عامة)
function buildScreensHtml(cid = "") {
  let html = "";
  if (!cid) {
    html += `<div class="screens-guest-note"><i class="fas fa-circle-info"></i> أنت غير مسجل الدخول — هذه روابط ثابتة للتجربة. سجّل الدخول لتظهر روابطك الخاصة المرتبطة بحسابك.</div>`;
  }
  html += '<div class="screens-grid">';
  for (let i = 1; i <= 10; i++) {
    // ✅ نفس قاعدة روابط الأوفرلايز: متصل بالسحابة → روابط الدومين،
    // متصل بسيرفر محلي → روابط محلية (روابط الدومين مع سيرفر محلي
    // تعني صفحات لا تصلك عليها أي أحداث — التراكب لا يظهر إطلاقاً)
    const screenUrl = `${overlayBase()}/widget/screens?cid=${encodeURIComponent(cid)}&screen=${i}`;
    const safeUrl = escapeHtml(screenUrl);
    html += `
      <div class="screen-card">
        <div class="screen-number">${i}</div>
        <div class="screen-url" dir="ltr">${safeUrl}</div>
        <button class="copy-url-btn" data-url="${safeUrl}"><i class="fas fa-clipboard"></i> نسخ الرابط</button>
      </div>
    `;
  }
  html += "</div>";
  return html;
}

function bindCopyButtons(container) {
  container.querySelectorAll(".copy-url-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      navigator.clipboard.writeText(url);
      btn.innerHTML = "<i class='fas fa-circle-check'></i> تم النسخ!";
      setTimeout(
        () => (btn.innerHTML = "<i class='fas fa-clipboard'></i> نسخ الرابط"),
        2000,
      );
    });
  });
}

async function loadScreens(force = false) {
  const container = document.getElementById("screensContainer");
  if (!container) return;
  if (__S.screensLoaded && !force) {
    console.log("⏭️ الشاشات محملة مسبقاً، تخطي الطلب");
    return;
  }
  // سكيلتون صفحة الشاشات يظهر فور بدء التحميل ويُزال عند جهوز البيانات
  const removeSkeleton =
    window.Skeleton && window.Skeleton.overlay
      ? window.Skeleton.overlay(container, {
          build: () => window.Skeleton.screensPage(),
        })
      : null;
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/user/screen-token`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const token = data.token;
    // ✅ الصيغة القصيرة الجميلة
    const cid = data.widgetId || token;
    container.innerHTML = buildScreensHtml(cid);
    __S.screensLoaded = true;
    bindCopyButtons(container);
  } catch (err) {
    // ✅ المستخدم غير المسجل (أو فشل الجلب): نفس الشاشات تظهر بروابط ثابتة
    // عامة بـ cid فارغ بدل رسالة خطأ
    container.innerHTML = buildScreensHtml("");
    __S.screensLoaded = true;
    bindCopyButtons(container);
  } finally {
    if (removeSkeleton) removeSkeleton();
  }
}

export { loadScreens };
