// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";

// ============================================================
// main.js - Stream Moon Full Application
// ============================================================

// نطاق الودجت — Worker كلود فلير (شغال فورًا)
// لاحقًا: أضف Custom Domain من الداشبورد وبدّل السطر التالي إلى widget.streammoon.net


// عنوان السيرفر يتبع إعدادات التطبيق — الرابط الاحتياطي مشفر XOR
// (لا يظهر كنص صريح في الملفات المترجمة)





window.API_BASE = (
  window.electronAPI?.getServerUrlSync?.() ||
  (() => {
    let s = "";
    for (let i = 0; i < __S._BE.length; i++)
      s += String.fromCharCode(__S._BE[i] ^ __S._BK[i % __S._BK.length]);
    return s;
  })()
)
  .trim()
  .replace(/\/+$/, "");




// socket.io محلي من node_modules بدل CDN (أمان: لا سكربتات خارجية)

try {
  __S.io = require("socket.io-client").io;
} catch {
  __S.io = window.io; // fallback لمتصفح التطوير فقط
}

