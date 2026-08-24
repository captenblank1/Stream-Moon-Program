// ============================================================
// scripts/fuses.js - afterPack hook لتطبيق Electron Fuses
// يعمل بعد التغليف وقبل إنشاء المثبِّت مباشرة
// ============================================================

const path = require("path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const { flipFuses, FuseVersion, FuseV1Options } = await import(
    "@electron/fuses"
  );

  const exePath = path.join(context.appOutDir, "StreamMoon.exe");

  await flipFuses(exePath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    // 🚫 منع استخدام التطبيق كـ Node (تفريغ الكود)
    [FuseV1Options.RunAsNode]: false,
    // 🚫 منع --node-options و--inspect (حقن/تفريغ)
    [FuseV1Options.EnableNodeOptions]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // 🔒 تشفير الكوكيز المخزنة محلياً
    [FuseV1Options.EnableCookieEncryption]: true,
    // 🔒 لا تحميل إلا من asar (منع استبدال الكود بملفات سائبة)
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // ملاحظة: asar integrity وGrantFileProtocolExtraPrivileges
    // غير مدعومين على Windows قبل Electron 30/29
  });

  console.log("🛡️ Electron Fuses applied to:", exePath);
};
