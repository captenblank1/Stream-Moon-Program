// ============================================================
// scripts/compile.js - تحويل كود JS إلى V8 bytecode (bytenode)
// يجب تشغيله عبر Electron نفسه: npx electron scripts/compile.js
// (لأن bytecode مرتبط بإصدار V8 في Electron وليس Node)
// ============================================================

const path = require("path");
const fs = require("fs");
const bytenode = require("bytenode");

const ROOT = path.join(__dirname, "..");
const TARGETS = ["electron/electron-main.js", "electron/preload-src.js", "electron/res-key.js"]; // main.js أصبح موديولات ES6 في js/ — تُشفَّر في enc/ بدلاً من الـ bytecode

async function main() {
  for (const file of TARGETS) {
    const srcPath = path.join(ROOT, file);
    const outName =
      file.endsWith("preload-src.js")
        ? "preload.jsc"
        : file.endsWith("res-key.js")
          ? "res-key.jsc"
          : path.basename(file).replace(/\.js$/, ".jsc");
    const outPath = path.join(ROOT, "electron", outName);
    try {
      const result = await bytenode.compileFile(srcPath, outPath);
      const finalPath =
        typeof result === "string" ? result : outPath;
      if (!fs.existsSync(finalPath)) {
        throw new Error("لم يُنشأ ملف الـ bytecode");
      }
      const size = fs.statSync(finalPath).size;
      console.log(`✅ ${file} → electron/${path.basename(finalPath)} (${size} bytes)`);
    } catch (err) {
      console.error(`❌ فشل تحويل ${file}:`, err.message);
      process.exit(1);
    }
  }
  console.log("🎉 تم تحويل كل الملفات إلى bytecode");
  process.exit(0);
}

main();
