// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { isCaptchaVisible } from "./captcha.js";
import { showMessage } from "./utils-core.js";
import { updateInputsForType } from "./commands.js";

// ============================================================
// مراقبة CAPTCHA
// ============================================================
function setupCaptchaWatcher() {
  let captchaActive = false;
  const checkCaptcha = () => {
    const detected = isCaptchaVisible();
    if (detected && !captchaActive) {
      captchaActive = true;
      console.log("🔴 CAPTCHA detected!");
      if (__S.frontendSocket && __S.frontendSocket.connected) {
        __S.frontendSocket.emit("captcha-detected", {
          url: window.location.href,
          timestamp: Date.now(),
        });
      }
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> تم اكتشاف CAPTCHA، يرجى حلها في النافذة المنبثقة",
      );
    } else if (!detected && captchaActive) {
      captchaActive = false;
      console.log("✅ CAPTCHA cleared!");
      if (__S.frontendSocket && __S.frontendSocket.connected) {
        __S.frontendSocket.emit("captcha-cleared", {
          url: window.location.href,
          timestamp: Date.now(),
        });
      }
      showMessage(
        "<i class='fas fa-circle-check'></i> تم حل CAPTCHA، استئناف العمل",
      );
    }
  };

  // إلغاء أي مراقب سابق
  if (__S.captchaObserver) {
    __S.captchaObserver.disconnect();
    __S.captchaObserver = null;
  }

  __S.captchaObserver = new MutationObserver(() => {
    checkCaptcha();
  });
  __S.captchaObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "aria-hidden"],
  });

  // استخدم setInterval بدلاً من setInterval مكرر، لكننا سنستخدم مؤقتاً واحداً
  // يمكن استخدام setInterval بفاصل 2 ثانية بدلاً من 2 ثانية (نفس الفاصل السابق)
  if (window._captchaInterval) clearInterval(window._captchaInterval);
  window._captchaInterval = setInterval(checkCaptcha, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  setupCaptchaWatcher();
});

// ربط القوائم المنسدلة المخصصة (Custom Select) لأنواع الأوامر
function setupCustomSelects() {
  document.querySelectorAll(".custom-select .selected").forEach((selected) => {
    selected.removeEventListener("click", handleSelectClick);
    selected.addEventListener("click", handleSelectClick);
  });

  document.querySelectorAll(".custom-select .options li").forEach((li) => {
    li.removeEventListener("click", handleOptionClick);
    li.addEventListener("click", handleOptionClick);
  });

  // ✅ إغلاق القائمة عند النقر خارجها — مستمع موحد على مستوى المستند
  // يغلق قائمة التفاعل وقائمة الهدايا وقائمة البروفايل معاً
  document.removeEventListener("click", closeCustomSelects);
  document.addEventListener("click", closeCustomSelects);
}

// ✅ إغلاق كل القوائم المنسدلة المفتوحة ما عدا العنصر المستثنى
function closeAllDropdowns(exceptEl = null) {
  document.querySelectorAll(".custom-select.open").forEach((el) => {
    if (!exceptEl || !el.contains(exceptEl)) el.classList.remove("open");
  });
  const giftDD = document.getElementById("giftDropdown");
  if (giftDD && (!exceptEl || !giftDD.contains(exceptEl))) {
    const opts = giftDD.querySelector(".options");
    if (opts) opts.style.display = "none";
  }
}

function handleSelectClick(e) {
  // بدون stopPropagation: ينطلق مستمع المستند الموحد فتُغلق كل القوائم
  // الأخرى (مثل قائمة الهدايا) فوراً عند فتح قائمة أخرى
  const parent = this.closest(".custom-select");
  if (parent) {
    parent.classList.toggle("open");
  }
}

function handleOptionClick(e) {
  const parent = this.closest(".custom-select");
  if (parent) {
    const selectedSpan = parent.querySelector(".selected span");
    if (selectedSpan) {
      selectedSpan.textContent = this.textContent;
    }
    const hiddenInput = document.getElementById("actionType");
    if (hiddenInput) {
      hiddenInput.value = this.dataset.value;
    }
    // تحديث حقول الإدخال حسب النوع
    updateInputsForType(this.dataset.value);
    parent.classList.remove("open");
  }
}

function closeCustomSelects(e) {
  // ✅ الضغط في أي مكان خارج قائمة التفاعل يغلقها فوراً —
  // كما يغلق قائمة الهدايا وأي قائمة مفتوحة أخرى
  closeAllDropdowns(e && e.target);
}


export { setupCaptchaWatcher, setupCustomSelects, closeAllDropdowns, handleSelectClick, handleOptionClick, closeCustomSelects };
