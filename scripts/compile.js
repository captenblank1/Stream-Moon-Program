// ============================================================
// scripts/compile.js - تحويل كود JS إلى V8 bytecode (bytenode)
// يجب تشغيله عبر Electron نفسه: npx electron scripts/compile.js
// (لأن bytecode مرتبط بإصدار V8 في Electron وليس Node)
// ============================================================

const path = require("path");
const fs = require("fs");
const bytenode = require("bytenode");

const ROOT = path.join(__dirname, "..");
const TARGETS = ["main.js", "electron-main.js", "preload-src.js", "res-key.js"];

async function main() {
  for (const file of TARGETS) {
    const srcPath = path.join(ROOT, file);
    const outName =
      file === "preload-src.js"
        ? "preload.jsc"
        : file === "res-key.js"
          ? "res-key.jsc"
          : file.replace(/\.js$/, ".jsc");
    const outPath = path.join(ROOT, outName);
    try {
      const result = await bytenode.compileFile(srcPath, outPath);
      const finalPath =
        typeof result === "string" ? result : outPath;
      if (!fs.existsSync(finalPath)) {
        throw new Error("لم يُنشأ ملف الـ bytecode");
      }
      const size = fs.statSync(finalPath).size;
      console.log(`✅ ${file} → ${path.basename(finalPath)} (${size} bytes)`);
    } catch (err) {
      console.error(`❌ فشل تحويل ${file}:`, err.message);
      process.exit(1);
    }
  }
  console.log("🎉 تم تحويل كل الملفات إلى bytecode");
  process.exit(0);
}

main();
