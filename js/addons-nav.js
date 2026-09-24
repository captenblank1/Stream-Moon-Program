// ============================================================
// js/addons-nav.js — التنقل للأقسام المضافة (اللايف فيد / TTS / الأغاني /
// نقاط المشاهدين) ودالة عرض موحّدة لأقسام الإضافات.
//
// ✅ إصلاح "التبديل بين الأقسام يعرض أقساماً أخرى": الاعتماد سابقاً كان على
// لفّ onclick للأزرار القديمة بطبقات متراكبة (sidebar.js ثم هذا الملف) —
// أي إسناد لاحق لـ onclick كان يمسح الطبقات السابقة بصمت فتُترك أقسام
// الإضافات ظاهرة عند التنقل للأقسام القديمة. الآن كل من يُخفي/يُظهر
// يستدعي الدوال الموحدة مباشرة: sidebar.js يستدعي hideAddonSections() و
// showAllAddonsInAllTab() بنفسه، وهنا الدوال تُصدَّر له.
// ============================================================
import __S from "./state.js";

const ADDON_SECTION_IDS = [
  "startSectionLivefeed",
  "startSectionTts",
  "startSectionSongs",
  "startSectionViewerpoints",
];

export function hideAddonSections() {
  for (const id of ADDON_SECTION_IDS) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
}

// كل أقسام البرنامج القديمة — تُخفى عند فتح أي قسم من أقسام الإضافات
export function hideLegacySections() {
  if (__S.startSection) __S.startSection.style.display = "none";
  if (__S.startSection2) __S.startSection2.style.display = "none";
  if (__S.startSection3) __S.startSection3.style.display = "none";
  if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
  if (__S.startSection4) __S.startSection4.style.display = "none";
  if (__S.startSection5) __S.startSection5.style.display = "none";
}

/**
 * فتح قسم من أقسام الإضافات: يخفي كل الأقسام الأخرى ويُظهر المطلوب
 * ويُفعّل زر السايدبار — ثم يستدعي onShow (تحميل بيانات أول زيارة).
 */
export function showAddonSection(sectionId, navSelector, onShow) {
  const section = document.getElementById(sectionId);
  const nav = document.querySelector(navSelector);
  if (!section || !nav) return;
  hideLegacySections();
  hideAddonSections();
  section.style.display = "block";
  document
    .querySelectorAll(".button-select-slide")
    .forEach((el) => el.classList.remove("active"));
  nav.classList.add("active");
  if (typeof onShow === "function") onShow();
}

// ============================================================
// ✅ تاب "الكل" يعرض جميع الأقسام المتاحة للمستخدم الحالي — بما فيها
// أقسام الإضافات الأربعة (اللايف فيد / TTS / الأغاني / نقاط المشاهدين)
// بينما قسم الإدمن يظل مخفياً تماماً عن غير المخوّلين (يُدار في sidebar.js
// وauth-flow.js حسب currentUserRole). لكل قسم مُحمِّل بيانات يُسجَّل من
// موديول القسم نفسه حتى لا تظهر الأقسام فاضية أو تُحفظ إعداداتها الافتراضية
// ============================================================
const addonLoaders = {}; // sectionId → fn (تحميل بيانات القسم مرة واحدة)

export function registerAddonLoader(sectionId, fn) {
  if (sectionId && typeof fn === "function") addonLoaders[sectionId] = fn;
}

// إظهار كل الأقسام داخل تاب "الكل" + ضمان تحميل بياناتها
// ✅ كل الأقسام فعلاً: الرئيسية الثلاثة + الاختصارات + الأوفرلايز +
// أقسام الإضافات الأربعة (صفحة الأدمن يديرها sidebar.js حسب الدور)
export async function showAllAddonsInAllTab() {
  const extraLegacyIds = ["startSectionHotkey", "startSection5"];
  for (const id of [...ADDON_SECTION_IDS, ...extraLegacyIds]) {
    const el = document.getElementById(id);
    if (el) el.style.display = "block";
  }
  for (const id of ADDON_SECTION_IDS) {
    try {
      if (addonLoaders[id]) addonLoaders[id]();
    } catch (e) {}
  }
  // ✅ أول فتح للاختصارات والأوفرلايز من تاب "الكل" — نفس محمّلات
  // أزرارها (استيراد ديناميكي لتفادي أي دورة استيراد)
  try {
    if (!__S.hotkeySectionLoaded) {
      const { loadHotkeyCommands, applyHotkeySettings } = await import(
        "./hotkeys.js"
      );
      await loadHotkeyCommands();
      await applyHotkeySettings();
      __S.hotkeySectionLoaded = true;
    }
  } catch (e) {}
  try {
    const { initOverlaysSection } = await import("./overlay.js");
    if (typeof initOverlaysSection === "function") initOverlaysSection();
    requestAnimationFrame(() => {
      if (window.updateOverlayPreviews) window.updateOverlayPreviews();
    });
  } catch (e) {}
}
