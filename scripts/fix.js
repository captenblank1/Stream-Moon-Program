#!/usr/bin/env node
/**
 * scripts/fix-duplicates.js
 * 🔧 يصلح التكرارات الناتجة عن تشغيل سكربتات الإصلاح أكثر من مرة
 *
 * المشكلة:
 *   perf-fix.js و fix-api-latency.js يستخدمان String.replace بشكل
 *   يعيد الإضافة لو النص المستهدف لا يزال موجودًا. تشغيلها مرتين
 *   ينتج تعريفات مكررة (let _refreshPromise، function _dedupRefresh...)
 *   → SyntaxError "already been declared" يوقف js/utils-core.js
 *   → يفشل استيراد main.js بالكامل → الفرونت لا يعمل.
 *
 * الاستخدام:
 *   node scripts/fix-duplicates.js              # تطبيق
 *   node scripts/fix-duplicates.js --dry-run    # معاينة بدون تعديل
 *   node scripts/fix-duplicates.js --restore    # استرجاع نسخ .fixdup-bak
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const RESTORE = process.argv.includes('--restore');
const BACKUP_EXT = '.fixdup-bak';

// التأكد أننا في جذر المشروع
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.error('❌ لم يتم العثور على package.json — شغّل السكربت من جذر المشروع');
  process.exit(1);
}

const stats = {
  filesScanned: 0,
  filesChanged: 0,
  blocksRemoved: 0,
  syntaxErrors: 0,
};

// ═══════════════════════════════════════════════════════════════
// RESTORE MODE — استرجاع النسخ الاحتياطية
// ═══════════════════════════════════════════════════════════════
if (RESTORE) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'build', '.git', 'enc', 'release-build'].includes(e.name)) continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(BACKUP_EXT)) {
        const orig = full.slice(0, -BACKUP_EXT.length);
        fs.copyFileSync(full, orig);
        fs.unlinkSync(full);
        console.log(`♻️  استُرجع: ${path.relative(ROOT, orig)}`);
      }
    }
  };
  walk(ROOT);
  console.log('\n✅ تم استرجاع كل الملفات');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function backup(file) {
  const bak = file + BACKUP_EXT;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

function checkSyntax(file) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const match = stderr.match(/SyntaxError:.*/);
    return { ok: false, error: match ? match[0].trim() : 'SyntaxError' };
  }
}

/**
 * يزيل التكرارات من بلوك مطابق للـ regex.
 * يحتفظ بواحد فقط ويحذف الباقي (مع استرجاع تلقائي لو حصل خطأ syntax).
 */
function dedupeBlocks(filePath, regexSource, opts = {}) {
  const { name = 'بلوك', preferPattern = null, maxRemovals = 10 } = opts;
  let src = fs.readFileSync(filePath, 'utf8');
  const original = src;

  const re = new RegExp(regexSource, 'g');
  const matches = [...src.matchAll(re)];

  if (matches.length <= 1) {
    return { kept: matches.length, removed: 0 };
  }

  // حماية: لو النسخ كثيرة جدًا، فيه مشكلة أكبر — نتوقف
  if (matches.length > maxRemovals + 1) {
    console.error(`   ⚠️  عدد النسخ كبير جدًا (${matches.length}) — أتوقف للسلامة`);
    return { kept: matches.length, removed: 0, error: 'too many' };
  }

  // اختر أي نسخة نحتفظ بها
  let keepIndex = 0; // افتراضيًا: الأولى (للحفاظ على الموضع)
  if (preferPattern) {
    const idx = matches.findIndex(m => m[0].includes(preferPattern));
    if (idx !== -1) keepIndex = idx;
  }

  console.log(
    `   ⚠️  ${name}: ${matches.length} نسخ — نحتفظ بـ #${keepIndex + 1}` +
    (preferPattern && matches[keepIndex][0].includes(preferPattern)
      ? ` (تحتوي "${preferPattern}")` : '')
  );

  // احذف من الأحدث للأقدم حتى لا تتغير مواضع الباقي
  const indicesToRemove = matches
    .map((_, i) => i)
    .filter(i => i !== keepIndex)
    .sort((a, b) => matches[b].index - matches[a].index);

  for (const i of indicesToRemove) {
    const m = matches[i];
    src = src.slice(0, m.index) + src.slice(m.index + m[0].length);
  }

  if (src === original) return { kept: matches.length, removed: 0 };

  if (!DRY) {
    backup(filePath);
    fs.writeFileSync(filePath, src);
    const check = checkSyntax(filePath);
    if (!check.ok) {
      stats.syntaxErrors++;
      console.error(`   ❌ SyntaxError بعد التعديل: ${check.error}`);
      fs.copyFileSync(filePath + BACKUP_EXT, filePath);
      console.log('   ♻️  تم استرجاع النسخة الأصلية');
      return { kept: matches.length, removed: 0, restored: true };
    }
  }

  return { kept: 1, removed: indicesToRemove.length };
}

// ═══════════════════════════════════════════════════════════════
// تنبيه: لو فيه نسخ .perf-bak / .perf2-bak من سكربتات سابقة
// ═══════════════════════════════════════════════════════════════
const oldBaks = [];
(function findOldBaks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'build', '.git', 'enc', 'release-build'].includes(e.name)) continue;
      findOldBaks(full);
    } else if (e.isFile() && (e.name.endsWith('.perf-bak') || e.name.endsWith('.perf2-bak'))) {
      oldBaks.push(path.relative(ROOT, full));
    }
  }
})(ROOT);

if (oldBaks.length > 0 && !DRY) {
  console.log(`💡 يوجد ${oldBaks.length} نسخة احتياطية من سكربتات perf سابقة.`);
  console.log(`   لو أردت الاسترجاع الكامل:`);
  console.log(`     node scripts/fix.js --restore     (يرجّع .perf-bak)`);
  console.log(`     node fix.js --restore             (يرجّع .perf2-bak)`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
console.log('🔧 فحص التكرارات في ملفات js/\n' + '═'.repeat(62));

// ── 1) js/utils-core.js — _dedupRefresh + _refreshPromise
const utilsCorePath = path.join(ROOT, 'js', 'utils-core.js');
if (fs.existsSync(utilsCorePath)) {
  stats.filesScanned++;
  console.log('\n📄 js/utils-core.js');
  const r = dedupeBlocks(
    utilsCorePath,
    String.raw`(?:\/\/[^\n]*\n)*let\s+_refreshPromise\s*=\s*null;[\s\S]*?return\s+_refreshPromise;\s*\n\}`,
    { name: '_dedupRefresh + _refreshPromise', preferPattern: '_refreshLockUntil' }
  );
  if (r.removed > 0) {
    stats.filesChanged++;
    stats.blocksRemoved += r.removed;
    console.log(`   ✅ حُذفت ${r.removed} نسخة مكررة`);
  } else if (r.kept <= 1) {
    console.log('   ⏭️  سليم (لا يوجد تكرار)');
  }
}

// ── 2) js/pairing.js — getAuthToken (مع الكاش الاختياري)
const pairingPath = path.join(ROOT, 'js', 'pairing.js');
if (fs.existsSync(pairingPath)) {
  stats.filesScanned++;
  console.log('\n📄 js/pairing.js');
  const src = fs.readFileSync(pairingPath, 'utf8');
  const count = (src.match(/function\s+getAuthToken\s*\(/g) || []).length;
  if (count > 1) {
    const r = dedupeBlocks(
      pairingPath,
      String.raw`(?:\/\/[^\n]*\n)*(?:let\s+_cachedAuthToken\s*=\s*null;\s*\n)?(?:let\s+_cachedAuthTokenAt\s*=\s*\d+;\s*\n)?function\s+getAuthToken\s*\([^)]*\)\s*\{[\s\S]*?\n\}`,
      { name: 'getAuthToken', preferPattern: '_cachedAuthToken' }
    );
    if (r.removed > 0) {
      stats.filesChanged++;
      stats.blocksRemoved += r.removed;
      console.log(`   ✅ حُذفت ${r.removed} نسخة مكررة`);
    }
  } else {
    console.log(`   ⏭️  سليم (getAuthToken: ${count} نسخة)`);
  }
}

// ── 3) js/gifts.js — _ensureGiftsMap
const giftsPath = path.join(ROOT, 'js', 'gifts.js');
if (fs.existsSync(giftsPath)) {
  stats.filesScanned++;
  console.log('\n📄 js/gifts.js');
  const src = fs.readFileSync(giftsPath, 'utf8');
  const count = (src.match(/function\s+_ensureGiftsMap\s*\(/g) || []).length;
  if (count > 1) {
    const r = dedupeBlocks(
      giftsPath,
      String.raw`(?:\/\/[^\n]*\n)*let\s+_giftsByIdMap\s*=\s*null;[\s\S]*?function\s+_ensureGiftsMap\s*\([^)]*\)\s*\{[\s\S]*?\n\}`,
      { name: '_ensureGiftsMap' }
    );
    if (r.removed > 0) {
      stats.filesChanged++;
      stats.blocksRemoved += r.removed;
      console.log(`   ✅ حُذفت ${r.removed} نسخة مكررة`);
    }
  } else {
    console.log(`   ⏭️  سليم (_ensureGiftsMap: ${count} نسخة)`);
  }
}

// ── 4) js/hotkeys.js — updateHotkeyRegistration
const hotkeysPath = path.join(ROOT, 'js', 'hotkeys.js');
if (fs.existsSync(hotkeysPath)) {
  stats.filesScanned++;
  console.log('\n📄 js/hotkeys.js');
  const src = fs.readFileSync(hotkeysPath, 'utf8');
  const count = (src.match(/function\s+updateHotkeyRegistration\s*\(/g) || []).length;
  if (count > 1) {
    const r = dedupeBlocks(
      hotkeysPath,
      String.raw`(?:\/\/[^\n]*\n)*async\s+function\s+updateHotkeyRegistration\s*\([^)]*\)\s*\{[\s\S]*?\n\}`,
      { name: 'updateHotkeyRegistration', preferPattern: 'success: true, hotkeys' }
    );
    if (r.removed > 0) {
      stats.filesChanged++;
      stats.blocksRemoved += r.removed;
      console.log(`   ✅ حُذفت ${r.removed} نسخة مكررة`);
    }
  } else {
    console.log(`   ⏭️  سليم (updateHotkeyRegistration: ${count} نسخة)`);
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(62));
console.log('📄 فحص syntax لكل ملفات js/');
console.log('─'.repeat(62));

const jsDir = path.join(ROOT, 'js');
const syntaxIssues = [];
if (fs.existsSync(jsDir)) {
  for (const f of fs.readdirSync(jsDir).sort()) {
    if (!f.endsWith('.js')) continue;
    if (f.includes('.bak') || f.includes('.perf')) continue;
    const result = checkSyntax(path.join(jsDir, f));
    if (result.ok) {
      console.log(`   ✔️  ${f}`);
    } else {
      console.log(`   ❌ ${f}: ${result.error}`);
      syntaxIssues.push({ file: f, error: result.error });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(62));
console.log(`📊 التقرير${DRY ? ' (dry-run — لم يُعدَّل شيء)' : ''}`);
console.log('═'.repeat(62));
console.log(`   📁 ملفات فُحصت:        ${stats.filesScanned}`);
console.log(`   ✏️  ملفات تغيّرت:      ${stats.filesChanged}`);
console.log(`   🗑️  بلوكات محذوفة:    ${stats.blocksRemoved}`);
console.log(`   ❌ مشاكل syntax:       ${syntaxIssues.length}`);
console.log('═'.repeat(62));

if (syntaxIssues.length > 0) {
  console.log('\n⚠️  مشاكل syntax متبقية:');
  for (const { file, error } of syntaxIssues) {
    console.log(`   • js/${file}: ${error}`);
  }
  console.log('\n💡 جرّب: node scripts/fix-duplicates.js --restore');
}

if (!DRY && (stats.filesChanged > 0 || syntaxIssues.length > 0)) {
  console.log('\n📦 الخطوات التالية:');
  console.log('   1) راجع التغييرات:  git diff');
  console.log('   2) أعد البناء:      npm run compile && node scripts/encrypt.js');
  console.log('   3) شغّل التطبيق:    npm start');
}

process.exit(syntaxIssues.length > 0 ? 1 : 0);