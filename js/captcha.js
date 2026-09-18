// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";

// ============================================================
// دوال CAPTCHA
// ============================================================








function isElementVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  try {
    const style = window.getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      parseFloat(style.opacity) < 0.05
    )
      return false;
  } catch {}
  return true;
}

function isCaptchaVisible() {
  for (const selector of __S.CAPTCHA_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (isElementVisible(el)) return true;
    }
  }
  return false;
}


export { isElementVisible, isCaptchaVisible };
