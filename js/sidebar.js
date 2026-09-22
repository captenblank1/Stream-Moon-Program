// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { withSectionSkeleton } from "./auth-flow.js";
import { loadHotkeyCommands } from "./hotkeys.js";
import { applyHotkeySettings } from "./hotkeys.js";
import { loadAdminDashboard } from "./admin.js";
import { loadScreens } from "./screens.js";
import { initOverlaysSection } from "./overlay.js";

// ============================================================
// التجاوب: زر القائمة الجانبية على الشاشات الصغيرة
// ============================================================
(function () {
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const closeSidebar = () => document.body.classList.remove("sidebar-open");
  if (toggle)
    toggle.addEventListener("click", () =>
      document.body.classList.toggle("sidebar-open"),
    );
  if (backdrop) backdrop.addEventListener("click", closeSidebar);
  // اختيار أي قسم يغلق السايد بار المنزلق
  document
    .querySelectorAll(".button-select-slide")
    .forEach((el) => el.addEventListener("click", closeSidebar));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1100) closeSidebar();
  });
})();

// ============================================================
// دوال التنقل في القائمة الجانبية
// ============================================================











if (__S.hotkeyNav && __S.startSectionHotkey) {
  __S.hotkeyNav.onclick = function () {
    __S.startSection.style.display = "none";
    __S.startSection2.style.display = "none";
    __S.startSection3.style.display = "none";
    if (__S.startSection5) __S.startSection5.style.display = "none"; // ← أضف
    if (__S.startSection4) __S.startSection4.style.display = "none";
    __S.startSectionHotkey.style.display = "block";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    this.classList.add("active");
    // السكيلتون والتحميل في أول زيارة فقط — الزيارات التالية تعرض القسم فوراً
    // (القائمة تتحدث تلقائياً عند أي حفظ/حذف/تفعيل لاختصار)
    if (!__S.hotkeySectionLoaded) {
      withSectionSkeleton(
        __S.startSectionHotkey,
        async () => {
          await loadHotkeyCommands();
          await applyHotkeySettings();
        },
        { build: () => window.Skeleton.hotkeyPage() },
      )
        .then(() => {
          __S.hotkeySectionLoaded = true;
        })
        .catch(() => {});
    }
  };
}

if (__S.allNav) {
  __S.allNav.onclick = function () {
    // إعادة ضبط أي تعديلات قد تكون حدثت من Overlay
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.margin = "";
    document.documentElement.style.margin = "";
    document.body.style.height = "";
    document.documentElement.style.height = "";
    // إعادة ضبط أي container خاص بالـ overlay إن وجد
    const overlayContainer = document.getElementById(
      "overlayDashboardContainer",
    );
    if (overlayContainer) {
      overlayContainer.style.overflow = "";
      overlayContainer.style.height = "";
    }

    __S.startSection.style.display = "block";
    __S.startSection2.style.display = "block";
    __S.startSection3.style.display = "block";
    if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
    if (__S.startSection5) __S.startSection5.style.display = "none";
    if (__S.currentUserRole === "admin") {
      __S.startSection4.style.display = "block"; // البيانات محملة مسبقاً عند الفتح
    } else {
      __S.startSection4.style.display = "none";
    }
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    __S.allNav.classList.add("active");
  };
}

if (__S.allNav && !__S.allNav.classList.contains("active")) {
  __S.allNav.classList.add("active");
  __S.startSection.style.display = "block";
  __S.startSection2.style.display = "block";
  __S.startSection3.style.display = "block";
  if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
  if (__S.currentUserRole === "admin") {
    __S.startSection4.style.display = "block";
    if (typeof loadAdminDashboard === "function") loadAdminDashboard();
  } else {
    __S.startSection4.style.display = "none";
  }
}

if (__S.startNav) {
  __S.startNav.onclick = function () {
    __S.startSection.style.display = "block";
    __S.startSection2.style.display = "none";
    __S.startSection3.style.display = "none";
    if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
    if (__S.startSection5) __S.startSection5.style.display = "none"; // ← أضف
    if (__S.startSection4) __S.startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    __S.startNav.classList.add("active");
  };
}

if (__S.actionNav) {
  __S.actionNav.onclick = function () {
    __S.startSection.style.display = "none";
    __S.startSection2.style.display = "block";
    __S.startSection3.style.display = "none";
    if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
    if (__S.startSection5) __S.startSection5.style.display = "none"; // ← أضف
    if (__S.startSection4) __S.startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    __S.actionNav.classList.add("active");
  };
}

if (__S.screensNav) {
  __S.screensNav.onclick = function () {
    __S.startSection.style.display = "none";
    __S.startSection2.style.display = "none";
    __S.startSection3.style.display = "block";
    if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
    if (__S.startSection5) __S.startSection5.style.display = "none"; // ← أضف
    if (__S.startSection4) __S.startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    __S.screensNav.classList.add("active");

    // ✅ هنا بدل ما يستدعيها دايماً، يستدعيها بس لو مش محملة
    if (!__S.screensLoaded) {
      loadScreens();
    }
  };
}




// إزالة محتوى الـ Overlay المحمّل عند مغادرة السيكشن —
// ستايلات لوحة التحكم المحقونة تؤثر على عرض باقي السيكشنات إن بقيت في الصفحة
function clearOverlayDashboard() {
  const c = document.getElementById("overlayDashboardContainer");
  if (c) c.innerHTML = "";
}

const _origStartNav = __S.startNav.onclick;
__S.startNav.onclick = function () {
  clearOverlayDashboard();
  if (typeof _origStartNav === 'function') _origStartNav.call(this);
};

const _origActionNav = __S.actionNav.onclick;
__S.actionNav.onclick = function () {
  clearOverlayDashboard();
  if (typeof _origActionNav === 'function') _origActionNav.call(this);
};

const _origScreensNav = __S.screensNav.onclick;
__S.screensNav.onclick = function () {
  clearOverlayDashboard();
  if (typeof _origScreensNav === 'function') _origScreensNav.call(this);
};

const _origAllNav = __S.allNav.onclick;
__S.allNav.onclick = function () {
  clearOverlayDashboard();
  if (typeof _origAllNav === 'function') _origAllNav.call(this);
};

const _origHotkeyNav = __S.hotkeyNav.onclick;
__S.hotkeyNav.onclick = function () {
  clearOverlayDashboard();
  if (typeof _origHotkeyNav === 'function') _origHotkeyNav.call(this);
};

if (__S.overlaysNav) {
  __S.overlaysNav.onclick = async function () {
    if (__S.startSection) __S.startSection.style.display = "none";
    if (__S.startSection2) __S.startSection2.style.display = "none";
    if (__S.startSection3) __S.startSection3.style.display = "none";
    if (__S.startSection4) __S.startSection4.style.display = "none";
    if (__S.startSectionHotkey) __S.startSectionHotkey.style.display = "none";
    __S.startSection5.style.display = "block";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    __S.overlaysNav.classList.add("active");
    // ✅ تحديث فوري للمعاينات بعد ظهور القسم — لا تصغير مؤقت ولا انتظار دورة الثانية
    requestAnimationFrame(() => {
      if (window.updateOverlayPreviews) window.updateOverlayPreviews();
    });
    // ✅ القسم الموحد — كل الأوفرلايز كروت في مكان واحد بدون تابات
    initOverlaysSection();
  };
}


export { clearOverlayDashboard };
