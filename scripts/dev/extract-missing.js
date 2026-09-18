const fs = require('fs');
const i18n = fs.readFileSync('i18n.js', 'utf8');
const exactKeys = new Set();
const arRe = /[\u0600-\u06FF]/;
const kvRe = /"((?:[^"\]|\.)*)":\s*"/g;
const dictStart = i18n.indexOf('var EXACT = {');
const dictEnd = i18n.indexOf('const EN2AR');
const dict = i18n.slice(dictStart, dictEnd);
let m;
while ((m = kvRe.exec(dict))) { if (arRe.test(m[1])) exactKeys.add(m[1]); }
const main = fs.readFileSync('main.js', 'utf8');
const msgs = new Set();
const callRe = /(?:showMessage|showConfirm|showHotkeyStatus|emptyRow)\(\s*(["'`])((?:\.|(?!\1).)*)\1/gs;
let mm;
while ((mm = callRe.exec(main))) {
  let s = mm[2];
  s = s.replace(/\n/g, ' ').replace(/\'/g, "'").replace(/\`/g, '`');
  if (arRe.test(s)) {
    const clean = s.replace(/<i[^>]*><\/i>/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length > 1) msgs.add(clean);
  }
}
const missing = [...msgs].filter(s => !exactKeys.has(s));
console.log('total:', msgs.size, '| missing:', missing.length);
fs.writeFileSync('_missing_ar.txt', missing.join('\n'), 'utf8');
missing.slice(0, 25).forEach(s => console.log(JSON.stringify(s)));
