// فحص سريع: فك تشفير enc/ والتأكد إن التعديلات الجديدة داخلها
const crypto = require("crypto");
const fs = require("fs");
const KEY = Buffer.from(require("./electron/res-key.js"), "hex");
function dec(p) {
  const raw = fs.readFileSync(p);
  const iv = raw.subarray(0, 12);
  const data = raw.subarray(12, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
const tts = dec("enc/js/tts.js.enc");
const songs = dec("enc/js/songs.js.enc");
const html = dec("enc/index.html.enc");
let ok = true;
const t = (name, cond) => {
  console.log((cond ? "✅" : "❌") + " " + name);
  if (!cond) ok = false;
};
t("tts.js: حماية لا أحد موجودة", tts.includes("form.permAll = true"));
t("songs.js: حماية لا أحد موجودة", songs.includes("af.all = true"));
t("index.html: opc-wins موجود", html.includes('id="opc-wins"'));
const i1 = html.indexOf('id="ovlUnifiedGrid"');
const i2 = html.indexOf('id="opc-wins"');
const i3 = html.indexOf('id="ovl-pref-viewers"');
t("index.html: ترتيب grid → opc-wins → لوحات الإعدادات سليم", i1 > 0 && i2 > i1 && i3 > i2);
process.exit(ok ? 0 : 1);
