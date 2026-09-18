#!/usr/bin/env node
/**
 * scripts/fix-api-latency.js
 * ⚡ سكربت إصلاح تأخر الـ APIs في Stream Moon
 *
 * الاستخدام:
 *   node scripts/fix-api-latency.js              # تطبيق
 *   node scripts/fix-api-latency.js --dry-run    # معاينة
 *   node scripts/fix-api-latency.js --restore    # استرجاع النسخ الاحتياطية (.perf2-bak)
 *
 * الإصلاحات المُطبَّقة:
 *   1. كاش getAuthToken() — كان Sync IPC في كل fetchWithAuth يوقف الـ renderer
 *   2. إبطال كاش التوكن في saveAuthToken
 *   3. deleteCommand → حذف الصوت + الفيديو + الأمر بالتوازي (Promise.all)
 *   4. _dedupRefresh → قفل 30 ثانية (كان يتفكّ بعد 0ms فتنفلت طلبات refresh مكررة)
 *   5. كاش Map للهدايا — كان بحث خطي O(n) في كل خلية جدول
 *   6. بعد حفظ أمر → _loadCommandsImpl() بدون skeleton (بدل loadCommands)
 *   7. updateHotkeyRegistration ترجع البيانات مع النتيجة (بدل GET متكرر)
 *   8. applyHotkeySettings تستخدم نفس البيانات (بدل GET ثانٍ وثالث)
 *   9. _renderHotkeysListNow تعيد استخدام كاش 2 ثانية
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run');
const RESTORE = ARGS.has('--restore');

const BACKUP_EXT = '.perf2-bak';
const stats = { applied: 0, skipped: 0, failed: 0, filesChanged: 0 };

// ═══════════════════════════════════════════════════════════════
// RESTORE MODE
// ═══════════════════════════════════════════════════════════════
if (RESTORE) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !['node_modules', 'build', 'enc', '.git', 'release-build'].includes(e.name)) walk(full);
      else if (e.isFile() && e.name.endsWith(BACKUP_EXT)) {
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
// ADAPTER
// ═══════════════════════════════════════════════════════════════
function patchFile(relPath, fixes) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    console.error(`❌ [${relPath}] — الملف غير موجود`);
    stats.failed += fixes.length;
    return;
  }
  const bak = abs + BACKUP_EXT;
  if (!fs.existsSync(bak) && !DRY) fs.copyFileSync(abs, bak);

  let src = fs.readFileSync(abs, 'utf8');
  let changed = 0;
  console.log(`\n📄 ${relPath}`);

  for (const fix of fixes) {
    const { name, find, replace } = fix;
    if (!src.includes(find)) {
      // هل مطبَّق مسبقاً؟ نتحقق من وجود بداية replace
      const probe = replace.slice(0, Math.min(60, replace.length));
      if (probe && src.includes(probe)) {
        console.log(`   ⏭️  ${name} — مُطبَّق مسبقاً`);
        stats.skipped++;
        continue;
      }
      console.error(`   ❌ ${name} — النص المستهدف غير موجود`);
      stats.failed++;
      continue;
    }
    if (DRY) {
      console.log(`   🔍 ${name} — سيُطبَّق (dry-run)`);
    } else {
      src = src.replace(find, replace);
      console.log(`   ✅ ${name}`);
    }
    changed++; stats.applied++;
  }

  if (changed > 0 && !DRY) {
    fs.writeFileSync(abs, src);
    stats.filesChanged++;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔑 1) js/pairing.js — كاش getAuthToken + إبطال الكاش في saveAuthToken
// ═══════════════════════════════════════════════════════════════
patchFile('js/pairing.js', [
  {
    name: 'كاش getAuthToken (يمنع Sync IPC في كل fetchWithAuth)',
    find: [
      'function getAuthToken() {',
      '  try {',
      '    // مصدر أخير: التوكن المختوم من العملية الرئيسية — الكوكي httpOnly',
      '    // غير مقروء من JS وsm_token قد لا يكون محفوظًا، وبدونه تفشل مصافحة',
      '    // Socket.IO (No token) فتعطل الأصوات والإشعارات الفورية',
      '    return (',
      '      localStorage.getItem("sm_token") ||',
      '      getCookie("token") ||',
      '      window.electronAPI?.getAuthTokenSync?.() ||',
      '      ""',
      '    );',
      '  } catch {',
      '    return getCookie("token") || window.electronAPI?.getAuthTokenSync?.() || "";',
      '  }',
      '}',
    ].join('\n'),
    replace: [
      '// 🚀 كاش للتوكن — IPC المتزامن (getAuthTokenSync) كان يتنفذ في كل fetchWithAuth',
      '// ويوقف الـ renderer process لحد ما الـ main يرد (كل API call = وقفة قصيرة)',
      'let _cachedAuthToken = null;',
      'let _cachedAuthTokenAt = 0;',
      'function getAuthToken() {',
      '  if (_cachedAuthToken && Date.now() - _cachedAuthTokenAt < 30000) {',
      '    return _cachedAuthToken;',
      '  }',
      '  try {',
      '    // مصدر أخير: التوكن المختوم من العملية الرئيسية — الكوكي httpOnly',
      '    // غير مقروء من JS وsm_token قد لا يكون محفوظًا، وبدونه تفشل مصاحفة',
      '    // Socket.IO (No token) فتعطل الأصوات والإشعارات الفورية',
      '    _cachedAuthToken =',
      '      localStorage.getItem("sm_token") ||',
      '      getCookie("token") ||',
      '      window.electronAPI?.getAuthTokenSync?.() ||',
      '      "";',
      '    _cachedAuthTokenAt = Date.now();',
      '    return _cachedAuthToken;',
      '  } catch {',
      '    return getCookie("token") || window.electronAPI?.getAuthTokenSync?.() || "";',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'إبطال كاش التوكن في saveAuthToken',
    find: [
      'function saveAuthToken(token) {',
      '  try {',
      '    if (token) localStorage.setItem("sm_token", token);',
      '    else localStorage.removeItem("sm_token");',
      '  } catch {}',
      '}',
    ].join('\n'),
    replace: [
      'function saveAuthToken(token) {',
      '  try {',
      '    if (token) localStorage.setItem("sm_token", token);',
      '    else localStorage.removeItem("sm_token");',
      '    // 🚀 تحديث الكاش فوراً حتى لا يُستخدم توكن قديم بعد تسجيل دخول/خروج',
      '    _cachedAuthToken = token || null;',
      '    _cachedAuthTokenAt = token ? Date.now() : 0;',
      '  } catch {}',
      '}',
    ].join('\n'),
  },
]);

// ═══════════════════════════════════════════════════════════════
// 🎁 2) js/gifts.js — كاش Map للهدايا (يمنع O(n) في كل خلية)
// ═══════════════════════════════════════════════════════════════
patchFile('js/gifts.js', [
  {
    name: 'كاش Map للهدايا (getGiftImage / getGiftImages / getGiftById)',
    find: [
      'function getGiftImage(giftId) {',
      '  if (!__S.gifts || __S.gifts.length === 0) return "";',
      '  // قد يحمل giftId عدة هويات مفصولة بفواصل (أمر متعدد الهدايا) — نعرض صورة أول هدية',
      '  const firstId = String(giftId || "").split(",")[0].trim();',
      '  if (!firstId) return "";',
      '  const gift = __S.gifts.find((g) => String(g.id) === firstId);',
      '  return gift?.image?.url_list?.[0] || "";',
      '}',
      '',
      '// ✅ صور كل الهدايا في أمر متعدد الهدايا — [{id, url, name}]',
      'function getGiftImages(giftId) {',
      '  if (!__S.gifts || !__S.gifts.length) return [];',
      '  return String(giftId || "")',
      '    .split(",")',
      '    .map((s) => s.trim())',
      '    .filter(Boolean)',
      '    .map((id) => {',
      '      const gift = __S.gifts.find((g) => String(g.id) === id);',
      '      return {',
      '        id,',
      '        url: gift?.image?.url_list?.[0] || "",',
      '        name: gift?.name || `#${id}`,',
      '      };',
      '    });',
      '}',
      '',
      'function getGiftById(giftId) {',
      '  if (!__S.gifts || !__S.gifts.length) return null;',
      '  const id = String(giftId || "").trim();',
      '  if (!id) return null;',
      '  return __S.gifts.find((g) => String(g.id) === id) || null;',
      '}',
    ].join('\n'),
    replace: [
      '// 🚀 كاش Map للهدايا — البحث الخطي O(n) كان يتنفذ مئات المرات لرسم كل جدول',
      '// (كتالوج TikTok فيه 500+ هدية × 50 أمر = 25,000 مقارنة بس لرسم الجدول)',
      'let _giftsByIdMap = null;',
      'let _giftsByIdMapSource = null;',
      'function _ensureGiftsMap() {',
      '  if (_giftsByIdMap && _giftsByIdMapSource === __S.gifts) return _giftsByIdMap;',
      '  _giftsByIdMap = new Map();',
      '  if (Array.isArray(__S.gifts)) {',
      '    for (const g of __S.gifts) _giftsByIdMap.set(String(g.id), g);',
      '  }',
      '  _giftsByIdMapSource = __S.gifts;',
      '  return _giftsByIdMap;',
      '}',
      '',
      'function getGiftImage(giftId) {',
      '  if (!__S.gifts || __S.gifts.length === 0) return "";',
      '  // قد يحمل giftId عدة هويات مفصولة بفواصل (أمر متعدد الهدايا) — نعرض صورة أول هدية',
      '  const firstId = String(giftId || "").split(",")[0].trim();',
      '  if (!firstId) return "";',
      '  const gift = _ensureGiftsMap().get(firstId);',
      '  return gift?.image?.url_list?.[0] || "";',
      '}',
      '',
      '// ✅ صور كل الهدايا في أمر متعدد الهدايا — [{id, url, name}]',
      'function getGiftImages(giftId) {',
      '  if (!__S.gifts || !__S.gifts.length) return [];',
      '  const map = _ensureGiftsMap();',
      '  return String(giftId || "")',
      '    .split(",")',
      '    .map((s) => s.trim())',
      '    .filter(Boolean)',
      '    .map((id) => {',
      '      const gift = map.get(String(id));',
      '      return {',
      '        id,',
      '        url: gift?.image?.url_list?.[0] || "",',
      '        name: gift?.name || `#${id}`,',
      '      };',
      '    });',
      '}',
      '',
      'function getGiftById(giftId) {',
      '  if (!__S.gifts || !__S.gifts.length) return null;',
      '  const id = String(giftId || "").trim();',
      '  if (!id) return null;',
      '  return _ensureGiftsMap().get(id) || null;',
      '}',
    ].join('\n'),
  },
]);

// ═══════════════════════════════════════════════════════════════
// 🗑️ 3) js/commands.js — deleteCommand بالتوازي + تحديث صامت بعد الحفظ
// ═══════════════════════════════════════════════════════════════
patchFile('js/commands.js', [
  {
    name: 'deleteCommand: Promise.all بدل 3 رحلات متتالية',
    find: [
      '    if (videoFile) {',
      '      try {',
      '        await fetchWithAuth(',
      '          `${__S.API_BASE}/api/video/${encodeURIComponent(videoFile)}`,',
      '          { method: "DELETE" },',
      '        );',
      '      } catch (err) {',
      '        console.warn("فشل حذف الفيديو:", err.message);',
      '      }',
      '    }',
      '    if (audioFile) {',
      '      try {',
      '        await fetchWithAuth(',
      '          `${__S.API_BASE}/api/audio/${encodeURIComponent(audioFile)}`,',
      '          { method: "DELETE" },',
      '        );',
      '      } catch (err) {',
      '        console.warn("فشل حذف الصوت:", err.message);',
      '      }',
      '    }',
      '',
      '    const deleteRes = await fetchWithAuth(url, { method: "DELETE" });',
    ].join('\n'),
    replace: [
      '    // 🚀 حذف الفيديو والصوت والأمر بالتوازي — كان 3 رحلات متتالية',
      '    const _delTasks = [fetchWithAuth(url, { method: "DELETE" })];',
      '    if (videoFile) {',
      '      _delTasks.push(',
      '        fetchWithAuth(',
      '          `${__S.API_BASE}/api/video/${encodeURIComponent(videoFile)}`,',
      '          { method: "DELETE" },',
      '        ).catch((err) => console.warn("فشل حذف الفيديو:", err.message)),',
      '      );',
      '    }',
      '    if (audioFile) {',
      '      _delTasks.push(',
      '        fetchWithAuth(',
      '          `${__S.API_BASE}/api/audio/${encodeURIComponent(audioFile)}`,',
      '          { method: "DELETE" },',
      '        ).catch((err) => console.warn("فشل حذف الصوت:", err.message)),',
      '      );',
      '    }',
      '',
      '    const [deleteRes] = await Promise.all(_delTasks);',
    ].join('\n'),
  },
  {
    name: 'confirmAdd: تحديث صامت بدون skeleton بعد الحفظ',
    find: [
      '      // ✅ الإغلاق بعد نجاح الحفظ فقط — عند الخطأ يبقى الكارت مفتوحاً',
      '      hideAddCard();',
      '      __S.tempUploadedFiles.audio = null;',
      '      __S.tempUploadedFiles.video = null;',
      '      await loadCommands();',
    ].join('\n'),
    replace: [
      '      // ✅ الإغلاق بعد نجاح الحفظ فقط — عند الخطأ يبقى الكارت مفتوحاً',
      '      hideAddCard();',
      '      __S.tempUploadedFiles.audio = null;',
      '      __S.tempUploadedFiles.video = null;',
      '      // 🚀 تحديث صامت بدون skeleton — المستخدم عارف إن الحفظ نجح',
      '      // فمافيش داعي نغطي الجدول بـ overlay 300ms+ لكل عملية',
      '      await _loadCommandsImpl(null, true);',
    ].join('\n'),
  },
]);

// ═══════════════════════════════════════════════════════════════
// 🔄 4) js/utils-core.js — قفل refresh حقيقي (30 ثانية)
// ═══════════════════════════════════════════════════════════════
patchFile('js/utils-core.js', [
  {
    name: '_dedupRefresh: قفل زمني 30 ثانية (منع طلبات refresh متتالية)',
    find: [
      '// 🚀 dedup لطلبات refresh — لو 3 نداءات متوازية رجعت 401،',
      '// يحدث POST /api/auth/refresh واحد فقط بدل 3 متوازية على نفس الجلسة',
      'let _refreshPromise = null;',
      'function _dedupRefresh() {',
      '  if (_refreshPromise) return _refreshPromise;',
      '  _refreshPromise = (async () => {',
      '    try {',
      '      const refreshRes = await fetch(`${__S.API_BASE}/api/auth/refresh`, {',
      '        method: "POST",',
      '        credentials: "include",',
      '      });',
      '      if (!refreshRes.ok) return null;',
      '      const refreshData = await refreshRes.json().catch(() => ({}));',
      '      const newToken = refreshData.token || getCookie("token");',
      '      if (newToken) saveAuthToken(newToken);',
      '      return newToken || null;',
      '    } catch (e) {',
      '      return null;',
      '    } finally {',
      '      setTimeout(() => { _refreshPromise = null; }, 0);',
      '    }',
      '  })();',
      '  return _refreshPromise;',
      '}',
    ].join('\n'),
    replace: [
      '// 🚀 dedup لطلبات refresh — لو 3 نداءات متوازية رجعت 401،',
      '// يحدث POST /api/auth/refresh واحد فقط بدل 3 متوازية على نفس الجلسة.',
      '// القفل يبقى 30 ثانية بعد نجاح refresh — يمنع موجة 401 متتالية',
      '// (مثلاً عند انتهاء التوكن، كل الـ 10 طلبات المتوازية تُرجّع 401)',
      'let _refreshPromise = null;',
      'let _refreshLockUntil = 0;',
      'function _dedupRefresh() {',
      '  if (_refreshPromise) return _refreshPromise;',
      '  if (Date.now() < _refreshLockUntil) return Promise.resolve(null);',
      '  _refreshPromise = (async () => {',
      '    try {',
      '      const refreshRes = await fetch(`${__S.API_BASE}/api/auth/refresh`, {',
      '        method: "POST",',
      '        credentials: "include",',
      '      });',
      '      if (!refreshRes.ok) {',
      '        _refreshLockUntil = Date.now() + 5000;',
      '        return null;',
      '      }',
      '      const refreshData = await refreshRes.json().catch(() => ({}));',
      '      const newToken = refreshData.token || getCookie("token");',
      '      if (newToken) saveAuthToken(newToken);',
      '      _refreshLockUntil = Date.now() + 30000;',
      '      return newToken || null;',
      '    } catch (e) {',
      '      _refreshLockUntil = Date.now() + 5000;',
      '      return null;',
      '    } finally {',
      '      _refreshPromise = null;',
      '    }',
      '  })();',
      '  return _refreshPromise;',
      '}',
    ].join('\n'),
  },
]);

// ═══════════════════════════════════════════════════════════════
// ⌨️  5) js/hotkeys.js — إعادة استخدام البيانات (بدل GET مكرر)
// ═══════════════════════════════════════════════════════════════
patchFile('js/hotkeys.js', [
  {
    name: 'updateHotkeyRegistration ترجع البيانات مع النتيجة',
    find: [
      'async function updateHotkeyRegistration() {',
      '  if (!window.electronAPI || !window.electronAPI.hotkey) {',
      '    console.warn("⚠️ Electron API غير متاح، الهوت كي لن يعمل في المتصفح");',
      '    return false;',
      '  }',
      '',
      '  try {',
      '    await window.electronAPI.hotkey.unregisterAll();',
      '    const res = await fetchWithAuth(',
      '      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,',
      '    );',
      '    const data = await res.json();',
      '    if (!data.success || !data.hotkeys) return true;',
      '',
      '    const activeHotkeys = data.hotkeys.filter((h) => h.active !== false);',
      '    if (activeHotkeys.length === 0) return true;',
      '',
      '    for (const hk of activeHotkeys) {',
      '      const combo = hk.key;',
      '      const result = await window.electronAPI.hotkey.register(',
      '        combo,',
      '        hk.commandId,',
      '        hk.commandType,',
      '      );',
      '      if (!result || !result.success) {',
      '        console.warn(',
      '          `<i class="fas fa-triangle-exclamation"></i> فشل تسجيل الاختصار ${combo}:`,',
      '          result?.error || "خطأ غير معروف",',
      '        );',
      '      } else {',
      '        console.log(`✅ Hotkey registered: ${combo}`);',
      '      }',
      '    }',
      '    return true;',
      '  } catch (err) {',
      '    console.error("❌ خطأ في تحديث تسجيل hotkey:", err);',
      '    return false;',
      '  }',
      '}',
    ].join('\n'),
    replace: [
      '// 🚀 ترجع { success, hotkeys } — نعيد استخدام البيانات في applyHotkeySettings',
      '// و_renderHotkeysListNow بدون GET متكرر على نفس الـ endpoint',
      'async function updateHotkeyRegistration() {',
      '  if (!window.electronAPI || !window.electronAPI.hotkey) {',
      '    console.warn("⚠️ Electron API غير متاح، الهوت كي لن يعمل في المتصفح");',
      '    return { success: false, hotkeys: [] };',
      '  }',
      '',
      '  try {',
      '    await window.electronAPI.hotkey.unregisterAll();',
      '    const res = await fetchWithAuth(',
      '      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,',
      '    );',
      '    const data = await res.json();',
      '    const hotkeys =',
      '      data.success && Array.isArray(data.hotkeys) ? data.hotkeys : [];',
      '',
      '    const activeHotkeys = hotkeys.filter((h) => h.active !== false);',
      '',
      '    for (const hk of activeHotkeys) {',
      '      const combo = hk.key;',
      '      const result = await window.electronAPI.hotkey.register(',
      '        combo,',
      '        hk.commandId,',
      '        hk.commandType,',
      '      );',
      '      if (!result || !result.success) {',
      '        console.warn(',
      '          `<i class="fas fa-triangle-exclamation"></i> فشل تسجيل الاختصار ${combo}:`,',
      '          result?.error || "خطأ غير معروف",',
      '        );',
      '      } else {',
      '        console.log(`✅ Hotkey registered: ${combo}`);',
      '      }',
      '    }',
      '    return { success: true, hotkeys };',
      '  } catch (err) {',
      '    console.error("❌ خطأ في تحديث تسجيل hotkey:", err);',
      '    return { success: false, hotkeys: [] };',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'applyHotkeySettings: استخدام البيانات المجلوبة (بدل GET 2 و3)',
    find: [
      '  // حالة التسجيل تُحدد من الاختصارات الفعلية المخزنة على السيرفر',
      '  const registered = await updateHotkeyRegistration();',
      '',
      '  let activeCount = 0;',
      '  try {',
      '    const res = await fetchWithAuth(',
      '      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,',
      '    );',
      '    const data = await res.json();',
      '    if (data.success && Array.isArray(data.hotkeys)) {',
      '      activeCount = data.hotkeys.filter((h) => h.active !== false).length;',
      '    }',
      '  } catch (e) {',
      '    console.warn("⚠️ تعذر جلب عدد الاختصارات النشطة");',
      '  }',
      '',
      '  const statusEl = document.getElementById("hotkeyStatus");',
      '  if (statusEl) {',
      '    if (!registered) {',
      '      statusEl.innerHTML =',
      '        "<i class=\'fas fa-triangle-exclamation\'></i> فشل تسجيل الاختصارات في النظام";',
      '      statusEl.style.color = "var(--warning-color, #ff9800)";',
      '    } else if (activeCount > 0) {',
      '      statusEl.innerHTML = `<i class="fas fa-circle-check"></i> الاختصارات النشطة: ${activeCount}`;',
      '      statusEl.style.color = "var(--success-color, #4caf50)";',
      '    } else {',
      '      statusEl.innerHTML = "<i class=\'fas fa-pause\'></i> لا توجد اختصارات نشطة";',
      '      statusEl.style.color = "var(--text-muted, #888)";',
      '    }',
      '  }',
      '',
      '  await renderHotkeysList();',
      '  updateClearShortcutButton();',
      '}',
    ].join('\n'),
    replace: [
      '  // 🚀 الدالة ترجع البيانات مع النتيجة — لا داعي لـ GET ثانٍ',
      '  const regResult = await updateHotkeyRegistration();',
      '  const registered = regResult.success;',
      '  const hotkeys = regResult.hotkeys || [];',
      '  const activeCount = hotkeys.filter((h) => h.active !== false).length;',
      '',
      '  const statusEl = document.getElementById("hotkeyStatus");',
      '  if (statusEl) {',
      '    if (!registered) {',
      '      statusEl.innerHTML =',
      '        "<i class=\'fas fa-triangle-exclamation\'></i> فشل تسجيل الاختصارات في النظام";',
      '      statusEl.style.color = "var(--warning-color, #ff9800)";',
      '    } else if (activeCount > 0) {',
      '      statusEl.innerHTML = `<i class="fas fa-circle-check"></i> الاختصارات النشطة: ${activeCount}`;',
      '      statusEl.style.color = "var(--success-color, #4caf50)";',
      '    } else {',
      '      statusEl.innerHTML = "<i class=\'fas fa-pause\'></i> لا توجد اختصارات نشطة";',
      '      statusEl.style.color = "var(--text-muted, #888)";',
      '    }',
      '  }',
      '',
      '  // 🚀 تمرير البيانات للرسم — يمنع GET ثالث على نفس الـ endpoint',
      '  window._lastHotkeysData = hotkeys;',
      '  window._lastHotkeysDataAt = Date.now();',
      '  await renderHotkeysList();',
      '  updateClearShortcutButton();',
      '}',
    ].join('\n'),
  },
  {
    name: '_renderHotkeysListNow: استخدام الكاش إن وُجد (توفير GET)',
    find: [
      '  try {',
      '    const res = await fetchWithAuth(',
      '      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,',
      '    );',
      '    const data = await res.json();',
      '    if (!data.success || !Array.isArray(data.hotkeys)) {',
      '      emptyRow("<i class=\'fas fa-circle-xmark\'></i> فشل تحميل الاختصارات");',
      '      return;',
      '    }',
      '    window.currentHotkeys = data.hotkeys;',
    ].join('\n'),
    replace: [
      '  try {',
      '    // 🚀 إن كانت البيانات محدَّثة منذ <2 ثانية (من applyHotkeySettings)',
      '    // نستخدمها مباشرة بدل GET جديد على نفس الـ endpoint',
      '    let data;',
      '    if (',
      '      window._lastHotkeysData &&',
      '      Date.now() - (window._lastHotkeysDataAt || 0) < 2000',
      '    ) {',
      '      data = { success: true, hotkeys: window._lastHotkeysData };',
      '      window._lastHotkeysData = null;',
      '    } else {',
      '      const res = await fetchWithAuth(',
      '        `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,',
      '      );',
      '      data = await res.json();',
      '    }',
      '    if (!data.success || !Array.isArray(data.hotkeys)) {',
      '      emptyRow("<i class=\'fas fa-circle-xmark\'></i> فشل تحميل الاختصارات");',
      '      return;',
      '    }',
      '    window.currentHotkeys = data.hotkeys;',
    ].join('\n'),
  },
]);

// ═══════════════════════════════════════════════════════════════
// 📊 التقرير النهائي
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(62));
console.log(`📊 التقرير النهائي${DRY ? ' (وضع المعاينة — لم يُعدَّل شيء)' : ''}`);
console.log('═'.repeat(62));
console.log(`   ✅ نجحت التعديلات:    ${stats.applied}`);
console.log(`   ⏭️  مطبَّقة مسبقاً:    ${stats.skipped}`);
console.log(`   ❌ فشلت:              ${stats.failed}`);
console.log(`   📁 ملفات تغيّرت:      ${stats.filesChanged}`);
console.log('═'.repeat(62));

if (stats.failed > 0) {
  console.log('\n⚠️  بعض التعديلات فشلت — غالباً لأن النص الأصلي اختلف.');
  console.log('   راجع الرسائل أعلاه وصحّح يدوياً، أو شغّل --restore وأعد المحاولة.');
}

if (!DRY && stats.applied > 0) {
  console.log('\n📦 الخطوة التالية:');
  console.log('   1) راجع التعديلات: git diff');
  console.log('   2) أعد بناء الـ bytecode:  npm run compile');
  console.log('   3) أعد تشفير الأصول:        node scripts/encrypt.js');
  console.log('   4) شغّل التطبيق:            npm start');
  console.log('\n🔄 للاسترجاع: node scripts/fix-api-latency.js --restore');
}
process.exit(stats.failed > 0 ? 1 : 0);