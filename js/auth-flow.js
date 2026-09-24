// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { getAuthToken } from "./pairing.js";
import { getCookie } from "./utils-core.js";
import { saveAuthToken } from "./pairing.js";
import { loadRconConfig } from "./rcon.js";
import { loadProfiles } from "./profiles.js";
import { initHotkey } from "./hotkeys.js";
import { loadAdminDashboard } from "./admin.js";
import { escapeHtml } from "./utils-core.js";
import { checkStorageNotifications } from "./storage.js";
import { loadScreens } from "./screens.js";
import { loadHotkeySettings } from "./hotkeys.js";
import { loadHotkeyCommands } from "./hotkeys.js";
import { renderHotkeysList } from "./hotkeys.js";
import { fetchAndShowNotification } from "./notifications.js";

// ============================================================
// دوال المصادقة
// ============================================================
function bindAgent(token) {
  if (
    window.electronAPI &&
    typeof window.electronAPI.bindAgentSession === "function"
  ) {
    return window.electronAPI.bindAgentSession(token || null);
  }
  return Promise.resolve();
}

async function updateAuthUI() {
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const deleteBtn = document.getElementById("delete-account-btn");
  const deleteAllBtn = document.getElementById("delete-all-profile-btn");
  const upgradeBtn = document.getElementById("upgrade-btn");
  const statusEl = document.getElementById("auth-status");
  const storageNotif = document.getElementById("storage-notification");
  const userInput = document.getElementById("user-tiktok");

  let isLoggedIn = false;
  try {
    const meHeaders = {};
    const savedToken = getAuthToken();
    if (savedToken) meHeaders["Authorization"] = `Bearer ${savedToken}`;
    let res = await fetch(`${__S.API_BASE}/api/auth/me`, {
      credentials: "include",
      headers: meHeaders,
    });
    let data = await res.json().catch(() => ({}));

    // توافق مع الإصدارات الأقدم من الخادم: /api/auth/me غير موجود (404)
    if (res.status === 404) {
      const probe = await fetch(`${__S.API_BASE}/api/profiles`, {
        credentials: "include",
        headers: meHeaders,
      });
      if (probe.ok) {
        isLoggedIn = true;
        __S.screensLoaded = false; // ✅ إعادة تعيين عند تبديل الحساب
        // حفظ التوكن من الكوكيز إلى localStorage لضمان استمراره
        const token = getCookie("token");
        if (token) saveAuthToken(token);
        // ربط الـ Agent
        await bindAgent(token);
        // تحديث البيانات الأساسية
        __S.currentUserPlan = "paid";
        __S.currentUserRole = "user";
        __S.currentUserId = null;
        data = { success: true, user: {}, subscription: { status: "active" } };
        try {
          await loadRconConfig();
          await loadProfiles();
          await initHotkey();
          __S.hotkeySectionLoaded = true;
        } catch (err) {
          console.warn("⚠️ فشل تحميل بعض البيانات:", err.message);
        }
        // تحديث الأزرار
        if (loginBtn) loginBtn.style.display = "none";
        if (registerBtn) registerBtn.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "inline-flex";
        if (deleteBtn) deleteBtn.style.display = "inline-flex";
        if (deleteAllBtn) deleteAllBtn.style.display = "inline-flex";
        if (upgradeBtn) upgradeBtn.style.display = "none";
        if (statusEl) {
          let emailLabel = "مسجل الدخول";
          try {
            const payload = JSON.parse(
              atob(
                (savedToken || "")
                  .split(".")[1]
                  .replace(/-/g, "+")
                  .replace(/_/g, "/"),
              ),
            );
            if (payload.email) emailLabel = payload.email;
          } catch {}
          statusEl.innerHTML = `<i class="fas fa-user-circle"></i> مرحباً ${escapeHtml(emailLabel)}`;
        }
        return;
      }
    }

    if (data.success) {
      isLoggedIn = true;
      __S.screensLoaded = false; // ✅ إعادة تعيين عند تسجيل الدخول بحساب جديد
      const user = data.user;
      const subscription = data.subscription;

      if (userInput && user.tiktokUsername)
        userInput.value = user.tiktokUsername;
      __S.currentUserPlan = user.plan;
      __S.currentUserPlanType = user.planType;
      __S.currentUserRole = user.role;
      __S.currentUserSelectedProfile = user.selectedProfile || 1;
      __S.currentUserId = user.id;

      const adminSidebar = document.querySelector(".admin");
      if (adminSidebar) {
        if (__S.currentUserRole === "admin") {
          adminSidebar.style.display = "block";
          adminSidebar.onclick = () => {
            document.querySelector(".start-section").style.display = "none";
            document.querySelector(".start-section-2").style.display = "none";
            document.getElementById("startSection3").style.display = "none";
            document.getElementById("startSection4").style.display = "block";
            document.getElementById("startSectionHotkey").style.display =
              "none";
            const s5 = document.getElementById("startSection5");
            if (s5) s5.style.display = "none";
            // ✅ إخفاء أقسام الإضافات (اللايف فيد/TTS/الأغاني/النقاط) —
            // كانت تبقى ظاهرة متداخلة مع صفحة الأدمن
            for (const addonId of [
              "startSectionLivefeed",
              "startSectionTts",
              "startSectionSongs",
              "startSectionViewerpoints",
            ]) {
              const addonEl = document.getElementById(addonId);
              if (addonEl) addonEl.style.display = "none";
            }
            document
              .querySelectorAll(".button-select-slide")
              .forEach((el) => el.classList.remove("active"));
            adminSidebar.classList.add("active");
          };
          // تحميل مسبق عند فتح البرنامج — التحديثات الحية تصل عبر Socket
          if (typeof loadAdminDashboard === "function") loadAdminDashboard();
        } else {
          adminSidebar.style.display = "none";
        }
      }

      const showUpgrade = subscription.status !== "active";
      if (upgradeBtn)
        upgradeBtn.style.display = showUpgrade ? "inline-flex" : "none";

      // ✅ إشعار انتهاء الاشتراك (تحذير قبل يومين / فترة سماح 3 أيام)
      showSubscriptionNotification(subscription);

      let planText = "";
      if (subscription.status === "free") planText = "مجاني";
      else if (subscription.status === "active") {
        if (user.planType === "monthly")
          planText = `شهري (ينتهي ${new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")})`;
        else if (user.planType === "yearly")
          planText = `سنوي (ينتهي ${new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")})`;
        else planText = "مدفوع";
      } else if (subscription.status === "warning")
        planText = `<i class="fas fa-triangle-exclamation"></i> تحذير: ينتهي بعد ${Math.floor(subscription.hoursLeft)} ساعة`;
      else if (subscription.status === "grace")
        planText = `<i class="fas fa-spinner fa-spin"></i> فترة سماح: متبقي ${Math.floor(subscription.hoursLeft)} ساعة للتجديد`;
      else planText = user.plan === "paid" ? "مدفوع (منتهي)" : "مجاني";
      if (statusEl) {
        const isProActive = subscription.status === "active";
        const proChip = isProActive
          ? `<span class="pro-chip"><i class="fas fa-gem"></i> PRO</span>`
          : "";
        statusEl.innerHTML = `<i class="fas fa-user-circle"></i> مرحباً ${escapeHtml(user.email)} ${proChip} | ${planText}`;
      }
    }
  } catch (err) {
    console.warn("⚠️ فشل التحقق من حالة الدخول:", err.message);
  }

  if (isLoggedIn) {
    if (loginBtn) loginBtn.style.display = "none";
    if (registerBtn) registerBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-flex";
    if (deleteBtn) deleteBtn.style.display = "inline-flex";
    if (deleteAllBtn) deleteAllBtn.style.display = "inline-flex";
    try {
      await loadRconConfig();
      await loadProfiles();
      await checkStorageNotifications();
      await loadScreens();
      await loadHotkeySettings();
      await loadHotkeyCommands();
      await renderHotkeysList();
      fetchAndShowNotification();
    } catch (err) {
      console.warn("⚠️ فشل تحميل بعض البيانات:", err.message);
    }
  } else {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (registerBtn) registerBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (deleteBtn) deleteBtn.style.display = "none";
    if (deleteAllBtn) deleteAllBtn.style.display = "none";
    if (upgradeBtn) upgradeBtn.style.display = "none";
    if (statusEl)
      statusEl.innerHTML = `<i class="fas fa-user-lock"></i> غير مسجل الدخول`;
    if (storageNotif) storageNotif.style.display = "none";
    // ✅ المستخدم غير المسجل يرى قسم الشاشات بروابط ثابتة عامة (cid فارغ)
    __S.screensLoaded = false;
    try {
      await loadScreens();
    } catch (err) {
      console.warn("⚠️ فشل عرض شاشات الزائر:", err.message);
    }
  }
}

// ============================================================
// سكيلتون الأقسام — طبقة تحميل فوق القسم حتى تجهز بياناته
// حارس مدمج: أي طبقة سابقة في القسم تُستبدل فوراً — لا تكدس ولا تكرار
// ============================================================
function withSectionSkeleton(sectionEl, loader, opts) {
  const run = async () => {
    if (typeof loader === "function") await loader();
  };
  if (!sectionEl || !window.Skeleton?.overlay) return run();
  sectionEl.querySelectorAll(":scope > .sk-overlay").forEach((o) => o.remove());
  const remove = window.Skeleton.overlay(sectionEl, opts);
  const startedAt = Date.now();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const wait = Math.max(0, 150 - (Date.now() - startedAt));
    setTimeout(remove, wait);
  };
  setTimeout(finish, 8000);
  return run().then(finish, finish);
}

// سكيلتون جدول الأوامر (الأكشنز) — يظهر مع كل تحميل أو تبديل بروفايل
// (التنفيذ/التجربة مستثنى — لا يمر من هنا). النداءات المتزامنة تتنفذ متسلسلة
// تحت نفس الطبقة بدل تكدس السكيلتون.

function withTableSkeleton(loader) {
  const target = document.querySelector(".start-section-2");
  if (!target || target.offsetParent === null) return Promise.resolve(loader());
  const run = () =>
    withSectionSkeleton(target, loader, {
      build: () =>
        window.Skeleton.commandsTable(
          Math.max(
            6,
            Math.min(
              document.querySelectorAll(".start-section-2 tbody tr").length ||
                8,
              14,
            ),
          ),
        ),
    }).then(
      (r) => {
        __S.commandsTablePending = null;
        return r;
      },
      (e) => {
        __S.commandsTablePending = null;
        throw e;
      },
    );
  if (__S.commandsTablePending) {
    __S.commandsTablePending = __S.commandsTablePending.then(run, run);
    return __S.commandsTablePending;
  }
  __S.commandsTablePending = run();
  return __S.commandsTablePending;
}

// سكيلتون قائمة الهوت كي — يستهدف حاوية الجدول فقط.
// يُعرض مرة واحدة عند أول تحميل للبيانات — أي إعادة رندر بعدها صامتة
// حتى لا يعلق القسم وتتكدس طبقات السكيلتون مع كل تحديث خلفي (حفظ/تفعيل/تبديل بروفايل)


// force = تغيير صريح (إضافة/تحديث/حذف/تفعيل) — يعرض السكيلتون حتى بعد أول تحميل
function withHotkeySkeleton(loader, force) {
  const target = document.getElementById("hotkeysListContainer");
  if (!target || target.offsetParent === null) return Promise.resolve(loader());
  // التحديثات الخلفية (غير الإجبارية) صامتة بعد أول تحميل
  if (__S.hotkeysListRendered && !force) return Promise.resolve(loader());
  // النداءات المتزامنة تُدمج في تشغيل واحد بدل 3-4 سكيلتون متتالية
  if (__S.hotkeysListPending) return __S.hotkeysListPending;
  const run = () =>
    _hotkeyListRun(target, loader).then(
      (r) => {
        __S.hotkeysListRendered = true;
        __S.hotkeysListPending = null;
        return r;
      },
      (e) => {
        __S.hotkeysListPending = null;
        throw e;
      },
    );
  if (__S.hotkeysListPending) {
    // انضم للعملية الجارية — التحميل يتنفذ بعدها تحت نفس الطبقة
    __S.hotkeysListPending = __S.hotkeysListPending.then(run, run);
    return __S.hotkeysListPending;
  }
  __S.hotkeysListPending = run();
  return __S.hotkeysListPending;
}

function _hotkeyListRun(target, loader) {
  const liveRows = document.querySelectorAll(
    "#hotkeysListTable tbody tr",
  ).length;
  return withSectionSkeleton(target, loader, {
    build: () =>
      window.Skeleton.hotkeyTable(Math.max(4, Math.min(liveRows || 5, 10))),
  });
}

// أي تغيير في الهوت كي (إضافة/تحديث/حذف/تفعيل): السكيلتون يبدأ فوراً لحظة
// الضغط — قبل نداءات الشبكة — ويغطي الحفظ وإعادة التسجيل وتحديث القائمة
// كلها تحت طبقة واحدة تُزال فور الجهوز. التغييرات المتزامنة تتنفذ تحتها بالترتيب.
function withHotkeyChange(work) {
  const target = document.getElementById("hotkeysListContainer");
  if (!target || target.offsetParent === null || !window.Skeleton?.overlay)
    return Promise.resolve(work());
  const run = () => _hotkeyListRun(target, work);
  if (__S.hotkeysListPending) {
    __S.hotkeysListPending = __S.hotkeysListPending.then(run, run);
    return __S.hotkeysListPending;
  }
  __S.hotkeysListPending = run().then(
    () => {
      __S.hotkeysListRendered = true;
      __S.hotkeysListPending = null;
    },
    (e) => {
      __S.hotkeysListPending = null;
      throw e;
    },
  );
  return __S.hotkeysListPending;
}

export { bindAgent, updateAuthUI, withSectionSkeleton, withTableSkeleton, withHotkeySkeleton, _hotkeyListRun, withHotkeyChange };
// ============================================================
// ✅ إشعار انتهاء الاشتراك — شريط عائم ثابت أعلى الشاشة
// ── تحذير قبل 48 ساعة من الانتهاء (أحمر مثل إشعار الأدمن)
// ── فترة سماح 72 ساعة (3 أيام) بعد الانتهاء
// عدّاد حي بالثانية + زر X للإغلاق — يظهر في كل فتح للبرنامج
// ============================================================
function showSubscriptionNotification(subscription) {
  const old = document.getElementById("subExpiryNotification");
  if (old) old.remove();

  const status = subscription?.status;
  if (status !== "warning" && status !== "grace") return;

  const isWarning = status === "warning";
  const expiry = subscription.expiry ? new Date(subscription.expiry) : null;
  const graceEnd = subscription.graceEnd ? new Date(subscription.graceEnd) : null;
  const target = isWarning ? expiry : graceEnd;
  if (!target) return;

  const isEn = window.AppI18n && AppI18n.lang === "en";
  const label = isEn
    ? (isWarning ? "Subscription expires in:" : "Subscription ended — grace period:")
    : (isWarning ? "سيتم انتهاء الاشتراك بعد:" : "انتهى الاشتراك — فترة سماح للتجديد:");

  const bar = document.createElement("div");
  bar.id = "subExpiryNotification";
  bar.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "z-index:100000",
    "display:flex", "align-items:center", "justify-content:center",
    "gap:8px", "padding:8px 20px", "font-size:13px", "font-weight:700",
    "color:#fff", "user-select:none", "line-height:1.4",
    "background:linear-gradient(135deg,rgba(120,8,30,.97) 0%,rgba(220,53,69,.97) 45%,rgba(150,12,40,.97) 100%)",
    "backdrop-filter:blur(10px)", "-webkit-backdrop-filter:blur(10px)",
    "border-bottom:1px solid rgba(255,255,255,0.15)",
    "box-shadow:0 2px 16px rgba(0,0,0,0.35)",
  ].join(";");

  const iconHtml = isWarning
    ? '<i class="fas fa-triangle-exclamation" style="font-size:14px;flex:none;align-self:center;"></i>'
    : '<i class="fas fa-hourglass-half" style="font-size:14px;flex:none;align-self:center;"></i>';

  const labelHtml = '<span style="flex:none;align-self:center;">' + label + '</span>';

  bar.innerHTML =
    iconHtml + labelHtml +
    '<span id="subExpiryCountdown" style="font-family:monospace;font-size:15px;font-weight:900;letter-spacing:1.5px;flex:none;align-self:center;line-height:1;direction:ltr;"></span>' +
    '<button id="subExpiryClose" style="position:absolute;inset-inline-end:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.12);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;align-self:center;" title="Close"><i class="fas fa-xmark"></i></button>';

  document.body.appendChild(bar);

  bar.querySelector("#subExpiryClose").addEventListener("click", () => {
    bar.remove();
    if (window._subExpTick) { clearInterval(window._subExpTick); window._subExpTick = null; }
  });

  const cd = bar.querySelector("#subExpiryCountdown");
  function tick() {
    const diff = target.getTime() - Date.now();
    if (diff <= 0) { cd.textContent = "00:00:00"; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    cd.textContent = String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
  }
  tick();
  window._subExpTick = setInterval(tick, 1000);
}
