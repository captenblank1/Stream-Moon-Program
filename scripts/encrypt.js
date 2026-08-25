// scripts/encrypt.js - تشفير أصول الواجهة (HTML/CSS/JS) قبل البناء
// الناتج مجلد enc/ به نسخ .enc مشفرة AES-256-GCM فقط
// الأصول النصية الأصلية لا تدخل الحزمة إطلاقاً

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY = Buffer.from(require("../res-key.js"), "hex");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "enc");

// كل ملف نصي قابل للقراءة
const TARGETS = [
  "index.html",
  "css/normalize.css",
  "css/style.css",
  "css/all.min.css",
  "vendor/fontawesome/all.min.css",
  "vendor/Sortable.min.js",
];

fs.rmSync(OUT, { recursive: true, force: true });

for (const rel of TARGETS) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.error("❌ ملف غير موجود:", rel);
    process.exit(1);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = fs.readFileSync(src);
  const encrypted = Buffer.concat([
    iv,
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const dest = path.join(OUT, rel + ".enc");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, encrypted);
  console.log(`🔐 ${rel} (${encrypted.length} bytes)`);
}
console.log("🎉 تم تشفير كل الأصول");
