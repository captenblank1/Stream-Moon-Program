// ============================================================
// boot.js - نقطة دخول التطبيق
// يحمّل كود العملية الرئيسية من bytecode (electron-main.jsc)
// الكود المصدري electron-main.js لا يُشحن مع الحزمة النهائية
// ============================================================

try {
  require("bytenode");
  require("./electron-main.jsc");
} catch (err) {
  // وضع التطوير: fallback للكود المصدري
  console.warn("⚠️ bytecode غير موجود، تشغيل الكود المصدري:", err.message);
  require("./electron-main.js");
}
