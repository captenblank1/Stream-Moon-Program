// ============================================================
// js/addons-nav.js — التنقل للأقسام المضافة (اللايف فيد / TTS / الأغاني)
// يلفّ معالجات الأزرار القديمة بحيث تُخفي الأقسام الجديدة عند التنقل،
// ويوفّر دالة عرض موحّدة لأقسام الإضافات الثلاثة.
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
function hideLegacySections() {
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

// الأزرار القديمة لازم تخفي الأقسام المضافة كمان — لفّ المعالجات الحالية
// (نفس نمط أغلفة clearOverlayDashboard في sidebar.js)
function wrapLegacyNav(navEl) {
  if (!navEl) return;
  const orig = navEl.onclick;
  navEl.onclick = function () {
    hideAddonSections();
    if (typeof orig === "function") orig.call(this);
  };
}

export function initAddonsNav() {
  [
    __S.allNav,
    __S.startNav,
    __S.actionNav,
    __S.screensNav,
    __S.hotkeyNav,
    __S.overlaysNav,
  ].forEach(wrapLegacyNav);
}

initAddonsNav();
