// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { getAuthToken } from "./pairing.js";
import { showBlockScreen } from "./notifications.js";
import { saveAuthToken } from "./pairing.js";
import { showAddCard } from "./commands.js";
import { hideAddCard } from "./commands.js";
import { confirmAdd } from "./commands.js";
import { checkForChangesAndClose } from "./commands.js";
import { clearAudio } from "./misc2.js";
import { clearVideo } from "./misc2.js";
import { closeModal } from "./misc2.js";
import { deleteAll } from "./misc2.js";
import { confirmDeleteAll } from "./misc2.js";
import { confirmDisconnect } from "./tiktok.js";
import { closeDisconnectModal } from "./tiktok.js";
import { closeKeyboardShortcutModal } from "./misc.js";
import { moveRowUp } from "./commands.js";
import { moveRowDown } from "./commands.js";
import { loadOverlayTab } from "./wins.js";

// ============================================================
// دوال مساعدة
// ============================================================
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
}

// ============================================================
// تنقية HTML محسّنة - استخدام textContent أفضل، لكن للضرورة استخدم هذه الدالة
// ============================================================
/**
 * تنقية النص لحماية من XSS
 * @param {string} str - النص المراد تنقيته
 * @param {boolean} forInput - إذا كان true، لا يتم تحويل علامات الاقتباس (للاستخدام داخل input/textarea)
 * @returns {string} النص المنقى
 */
function escapeHtml(str, forInput = false) {
  if (!str) return "";
  let result = String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#x60;");

  // فقط عند العرض في عناصر HTML (غير input/textarea)
  if (!forInput) {
    result = result
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
      .replaceAll("/", "&#x2F;"); // منع هجمات close tag
  }
  return result;
}

// فك تشفير HTML entities من البيانات القديمة المحفوظة مُشفّرة (&#x2F; &#x27; &quot; ...)
function decodeHtmlEntities(str) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function showMessage(msg) {
  const m = document.getElementById("message");
  m.innerHTML = window.AppI18n ? AppI18n.t(msg) : msg;
  m.classList.add("show");
  setTimeout(() => m.classList.remove("show"), 2500);
}

// نافذة تهنئة بتفعيل الاشتراك البرو — تُغلق بزر X أو الضغط خارجها،
// وعند الإغلاق يُعاد تحديث البرنامج بالكامل لتفعيل ميزات الخطة الجديدة
function showProSubscribedModal({ planType, expiry } = {}) {
  // منع التكرار: الويب هوك والمسح الدوري قد يطلبان العرض معًا خلال ثوانٍ
  const lastShown = Number(sessionStorage.getItem("proModalShownAt") || 0);
  if (Date.now() - lastShown < 2 * 60 * 1000) return;
  sessionStorage.setItem("proModalShownAt", String(Date.now()));

  const existing = document.getElementById("proModalOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "proModalOverlay";
  overlay.className = "pro-modal-overlay";

  const durationText = planType === "monthly"
    ? `اشتراك شهري${expiry ? ` — ينتهي ${new Date(expiry).toLocaleDateString("ar-EG")}` : ""}`
    : planType === "yearly"
      ? `اشتراك سنوي${expiry ? ` — ينتهي ${new Date(expiry).toLocaleDateString("ar-EG")}` : ""}`
      : "اشتراكك مفعّل";

  const features = [
    ["fa-bolt", "حتى 100 أمر نشط في كل بروفايل (بدل 7)"],
    ["fa-folder-open", "كل البروفايلات مفتوحة — 20 بروفايل"],
    ["fa-headset", "دعم فني ذو أولوية للمشتركين"],
  ];

  overlay.innerHTML = `
    <div class="pro-modal" role="dialog" aria-modal="true">
      <button class="pro-modal-close" title="إغلاق"><i class="fas fa-xmark"></i></button>
      <div class="pro-modal-crown"><i class="fas fa-crown"></i></div>
      <h2 class="pro-modal-title">مرحباً بك في البرو</h2>
      <p class="pro-modal-sub">تم تفعيل اشتراكك بنجاح — كل الميزات صارت مفتوحة</p>
      <div class="pro-modal-duration"><i class="fas fa-clock"></i> ${durationText}</div>
      <ul class="pro-modal-features">
        ${features.map(([icon, text]) => `<li><i class="fas ${icon}"></i><span>${text}</span></li>`).join("")}
      </ul>
      <div class="pro-modal-footer">سيتم تحديث البرنامج عند الإغلاق</div>
    </div>`;

  const closeAndRefresh = () => {
    overlay.remove();
    window.location.reload();
  };
  overlay.querySelector(".pro-modal-close").addEventListener("click", closeAndRefresh);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAndRefresh();
  });

  document.body.appendChild(overlay);
}

// بعد الدفع: نفحص كل 3 ثوانٍ حتى تُفعَّل الخطة فعليًا (تأكيد PayPal)
// — وحدث السوكيت plan-updated يعرض النافذة أيضًا عند وصوله فلا مشكلة لو سبقنا
function waitForProActivation(attempts = 15) {
  setTimeout(async () => {
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/auth/me`);
      const d = await res.json();
      const isPro =
        d.success &&
        d.user &&
        d.user.plan === "paid" &&
        (!d.subscription || d.subscription.status === "active");
      if (isPro) {
        showProSubscribedModal({
          planType: d.user.planType,
          expiry: d.user.subscriptionExpiry,
        });
        return;
      }
    } catch (e) {}
    if (attempts > 1) waitForProActivation(attempts - 1);
    else
      showMessage(
        "<i class='fas fa-circle-info'></i> سيتم تفعيل اشتراكك خلال دقائق وستظهر لك رسالة الترحيب",
      );
  }, 3000);
}

// بصمة جهاز ثابتة للمتصفح/التطبيق — تُرسل مع الطلبات لتمييز الجهاز (للحظر)
function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem("sm_device_id");
    if (!id) {
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem("sm_device_id", id);
    }
  } catch {}
  return id || "";
}

function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["x-device-id"] = getDeviceId();

  // نقوم بتنفيذ الطلب مع إعادة المحاولة في حالة 401
  const executeRequest = async () => {
    let res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (res.status === 403) {
      try {
        const maybeBlocked = await res.clone().json();
        if (maybeBlocked && maybeBlocked.blocked) {
          showBlockScreen(maybeBlocked.message || "");
        }
      } catch (e) {}
    }
    if (res.status === 401) {
      try {
        const refreshRes = await fetch(`${__S.API_BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json().catch(() => ({}));
          const newToken = refreshData.token || getCookie("token");
          if (newToken) {
            saveAuthToken(newToken);
            headers["Authorization"] = `Bearer ${newToken}`;
            // إعادة المحاولة
            res = await fetch(url, {
              ...options,
              headers,
              credentials: "include",
            });
          }
        }
      } catch (err) {
        console.warn("⚠️ فشل تجديد التوكن:", err.message);
      }
    }
    return res;
  };

  return executeRequest();
}

// ============================================================
// دوال التأكيد والرسائل
// ============================================================
function showConfirm(message, title = "تأكيد") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const messageEl = document.getElementById("confirmMessage");
    const yesBtn = document.getElementById("confirmYesBtn");
    const noBtn = document.getElementById("confirmNoBtn");

    titleEl.textContent = window.AppI18n ? AppI18n.t(title) : title;
    messageEl.textContent = window.AppI18n ? AppI18n.t(message) : message;
    modal.style.display = "flex";
    yesBtn.focus();

    const cleanup = () => {
      modal.style.display = "none";
      yesBtn.removeEventListener("click", handleYes);
      noBtn.removeEventListener("click", handleNo);
    };

    const handleYes = () => {
      cleanup();
      resolve(true);
    };
    const handleNo = () => {
      cleanup();
      resolve(false);
    };

    yesBtn.addEventListener("click", handleYes);
    noBtn.addEventListener("click", handleNo);
  });
}

// ============================================================
// دالة تنقية روابط الصور - منع XSS عبر javascript: و data:text/html
// ============================================================
function safeImageUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  // السماح فقط بروابط http/https أو data:image (صور base64)
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  // رفض أي رابط آخر (javascript:, vbscript:, data:text/html, etc.)
  console.warn("⚠️ تم رفض رابط صورة غير آمن:", trimmed.substring(0, 50));
  return "images/default.jpg"; // رابط افتراضي آمن
}

// ============================================================
// دالة تنقية روابط الصوت والفيديو - منع XSS عبر Audio/Video
// ============================================================
function safeMediaUrl(url, type = "audio") {
  if (!url) return "";
  const trimmed = String(url).trim();

  // السماح بمسارات /audios/ و /videos/ الخاصة بالتطبيق
  if (type === "audio" && trimmed.startsWith("/audios/")) {
    return __S.API_BASE + trimmed;
  }
  if (type === "video" && trimmed.startsWith("/videos/")) {
    return __S.API_BASE + trimmed;
  }

  // السماح بروابط http/https فقط
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  console.warn(`⚠️ تم رفض رابط ${type} غير آمن:`, trimmed.substring(0, 50));
  return "";
}

// ============================================================
// تصدير الدوال المستخدمة في onclick داخل HTML إلى النطاق العام
// (بعد التحويل للـ bytecode أصبح الكود يعمل كـ module وليس script)
// ============================================================
[
  showAddCard,
  hideAddCard,
  confirmAdd,
  checkForChangesAndClose,
  clearAudio,
  clearVideo,
  closeModal,
  deleteAll,
  confirmDeleteAll,
  confirmDisconnect,
  closeDisconnectModal,
  closeKeyboardShortcutModal,
  moveRowUp,
  moveRowDown,
  showMessage,
  typeof loadOverlayTab !== "undefined" ? loadOverlayTab : null,
].forEach((fn) => {
  if (typeof fn === "function") window[fn.name] = fn;
});


export { getCookie, escapeHtml, decodeHtmlEntities, showMessage, showProSubscribedModal, waitForProActivation, getDeviceId, fetchWithAuth, showConfirm, safeImageUrl, safeMediaUrl };
