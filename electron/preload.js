// تحميل النسخة المجمعة إن وجدت، وإلا fallback للكود المصدري المعدّل
try {
  require("bytenode");
  module.exports = require("./preload.jsc");
} catch (err) {
  module.exports = require("./preload-src.js");
}
