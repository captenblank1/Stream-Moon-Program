// ============================================================
// main.js - Stream Moon Full Application
// ============================================================

// عنوان السيرفر يتبع إعدادات التطبيق، مع الرابط السحابي كافتراضي
window.API_BASE = (
  window.electronAPI?.getServerUrlSync?.() ||
  "https://backend-production-484d.up.railway.app"
)
  .trim()
  .replace(/\/+$/, "");
const API_BASE = window.API_BASE || "";
const GIFT_API = `${API_BASE}/api/gift-commands`;
const INTERACT_API = `${API_BASE}/api/interaction-commands`;

// socket.io محلي من node_modules بدل CDN (أمان: لا سكربتات خارجية)
let io;
try {
  io = require("socket.io-client").io;
} catch {
  io = window.io; // fallback لمتصفح التطوير فقط
}

// ============================================================
// المتغيرات العامة
// ============================================================
let isLiveConnected = false;
let liveCheckInterval = null;
let liveStatusCheckInProgress = false;
let lastEnteredUsername = "";
let pendingUsername = null;
let profileNames = {};
let currentCommandModalMode = null;
let importedCommands = [];
let importedHotkeys = []; // اختصارات ملف .tfc عند "اضافة البروفايل"
let currentProfileHotkeys = []; // اختصارات البروفايل الحالي (للكشف عن المكرر)
let duplicateCommands = [];
let nonDuplicateCommands = [];
let audioUploadInProgress = false;
let videoUploadInProgress = false;
// قفل الحفظ لمنع تكرار إنشاء الأوامر عند الضغط المتكرر على زر الحفظ
let saveInProgress = false;

// قفل أي زر أثناء تنفيذ مهمة غير متزامنة لمنع التنفيذ المكرر
async function withButtonLock(btn, fn) {
  if (!btn || btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = 0.6;
  btn.style.pointerEvents = "none";
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
    btn.innerHTML = originalHtml;
  }
}
let currentUserPlan = "free";
let currentUserPlanType = null;
let currentUserRole = "user";
let currentUserId = null;
let selectedPlan = null;
let selectedPlanId = null;
let currentPayPalButton = null;
let subscriptionInterval = null;
let storageInterval = null;
let currentUserSelectedProfile = 1;
let currentShortcutCombo = "";
let globalAudios = [];
let originalFormValues = {};
let giftsLoaded = false;
let gifts = [];
let existingCommandsMap = new Map();
let saveTimeout = null;
let searchTimeout = null;
let tempUploadedFiles = { audio: null, video: null };
// عمليات الرفع الجارية — الحفظ ينتظرها قبل قراءة أسماء الملفات
let pendingUploads = { audio: null, video: null };
// يُفعّل عند إلغاء الرفع وإغلاق البطاقة حتى لا تُستخدم نتيجة الرفع
let uploadsCancelled = false;
let frontendSocket = null;
let audioCtx = null;
let audioUnlocked = false;
let lastPlayedSoundId = null;
let closeOptionsListener = null;
let currentAudioObj = null;
let isEditingUsername = false;
let editingId = null;
let editingType = null;
let currentAudio = null;
let renderModalOptionsGlobal = null;
let audioModalGlobal = null;
let modalSearchGlobal = null;
let selectedFieldGlobal = null;
let hiddenInputGlobal = null;
let currentAudioObjGlobal = null;
let giftsLoadingPromise = null;
const autoSaveTimers = new Map();
let editingHotkeyId = null;

let streamerTimer = null;
let captchaObserver = null;
let screensLoaded = false;

// ============================================================
// إعدادات Hotkey
// ============================================================
let hotkeySettings = {
  key: "",
  commandId: null,
  commandType: null,
  active: false,
};
let hotkeyListenerAttached = false;

// ============================================================
// دوال مساعدة
// ============================================================
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
}

// ============================================================
// تنقية HTML محسّنة - استخدام textContent أفضل، لكن للضرورة استخدم هذه الدالة
// ============================================================
/**
 * تنقية النص لحماية من XSS
 * @param {string} str - النص المراد تنقيته
 * @param {boolean} forInput - إذا كان true، لا يتم تحويل علامات الاقتباس (للاستخدام داخل input/textarea)
 * @returns {string} النص المنقى
 */
function escapeHtml(str, forInput = false) {
  if (!str) return "";
  let result = String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#x60;");

  // فقط عند العرض في عناصر HTML (غير input/textarea)
  if (!forInput) {
    result = result
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
      .replaceAll("/", "&#x2F;"); // منع هجمات close tag
  }
  return result;
}

// فك تشفير HTML entities من البيانات القديمة المحفوظة مُشفّرة (&#x2F; &#x27; &quot; ...)
function decodeHtmlEntities(str) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function showMessage(msg) {
  const m = document.getElementById("message");
  m.textContent = msg;
  m.classList.add("show");
  setTimeout(() => m.classList.remove("show"), 2500);
}

function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // نقوم بتنفيذ الطلب مع إعادة المحاولة في حالة 401
  const executeRequest = async () => {
    let res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (res.status === 401) {
      try {
        const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (refreshRes.ok) {
          const newToken = getCookie("token");
          if (newToken) {
            saveAuthToken(newToken);
            headers["Authorization"] = `Bearer ${newToken}`;
            // إعادة المحاولة
            res = await fetch(url, {
              ...options,
              headers,
              credentials: "include",
            });
          }
        }
      } catch (err) {
        console.warn("⚠️ فشل تجديد التوكن:", err.message);
      }
    }
    return res;
  };

  return executeRequest();
}

// ============================================================
// دوال إدارة الاقتران (Pairing)
// ============================================================

// التحقق من حالة الاقتران وعرض/إخفاء العناصر
async function checkPluginStatus() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/plugin-status`);
    const data = await res.json();
    const isPaired = data.success && data.connected === true;

    const inputGroup = document.getElementById('pairingInputGroup');
    const pairedActions = document.getElementById('pairedActions');
    const statusSpan = document.getElementById('pluginConnectionStatus');

    if (isPaired) {
      inputGroup.style.display = 'none';
      pairedActions.style.display = 'flex';
      if (statusSpan) {
        statusSpan.textContent = '✅ مقترن';
        statusSpan.style.color = '#4caf50';
      }
    } else {
      inputGroup.style.display = 'flex';
      pairedActions.style.display = 'none';
      if (statusSpan) {
        statusSpan.textContent = '❌ غير مقترن';
        statusSpan.style.color = '#f44336';
      }
    }
  } catch (err) {
    console.warn('فشل التحقق من حالة الاقتران:', err);
    // في حالة الخطأ نعرض الحقل للاحتياط
    document.getElementById('pairingInputGroup').style.display = 'flex';
    document.getElementById('pairedActions').style.display = 'none';
  }
}

// ربط الكود (نفس الكود السابق مع تحسينات)
document.getElementById('pairPluginBtn').addEventListener('click', async function() {
  const code = document.getElementById('pairingCode').value.trim();
  const resultDiv = document.getElementById('pairingResult');
  if (!code || !/^\d{6}$/.test(code)) {
    resultDiv.textContent = '⚠️ أدخل كود صحيح من 6 أرقام';
    resultDiv.style.color = '#ff9800';
    return;
  }
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/plugin-pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
      resultDiv.textContent = '✅ تم ربط البلوجن بحسابك بنجاح!';
      resultDiv.style.color = '#4caf50';
      document.getElementById('pairingCode').value = '';
      await checkPluginStatus(); // تحديث الواجهة
      showMessage('✅ تم ربط البلوجن');
    } else {
      resultDiv.textContent = '❌ ' + (data.message || 'فشل الربط');
      resultDiv.style.color = '#f44336';
    }
  } catch (err) {
    resultDiv.textContent = '❌ خطأ في الاتصال بالخادم';
    resultDiv.style.color = '#f44336';
  }
});

// إلغاء الاقتران / تغيير الكود
document.getElementById('unpairPluginBtn').addEventListener('click', async function() {
  const confirmed = await showConfirm(
    'سيتم فك ارتباط البلوجن بحسابك الحالي، وستحتاج إلى إدخال كود جديد. هل تريد المتابعة؟',
    'تغيير الكود'
  );
  if (!confirmed) return;

  const resultDiv = document.getElementById('pairingResult');
  try {
    // نفترض وجود نقطة نهاية لإلغاء الاقتران (سنضيفها في الخادم لاحقاً)
    // حالياً سنقوم بمحاكاة الإلغاء عن طريق استدعاء endpoint غير موجود،
    // ولكننا سنتعامل مع الخطأ ونعرض رسالة مناسبة.
    const res = await fetchWithAuth(`${API_BASE}/api/plugin-unpair`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      resultDiv.textContent = '✅ تم إلغاء الاقتران، يمكنك إدخال كود جديد من كونسول السيرفر.';
      resultDiv.style.color = '#4caf50';
      await checkPluginStatus();
      showMessage('🔄 تم إلغاء الاقتران، أدخل الكود الجديد');
    } else {
      // إذا لم تكن النقطة موجودة، نعرض رسالة بديلة
      resultDiv.textContent = '⚠️ لإعادة الاقتران، يرجى إعادة تشغيل البلوجن (أو استخدم الأمر /rebind في السيرفر) ثم أدخل الكود الجديد.';
      resultDiv.style.color = '#ff9800';
      // نخفي الـ pairedActions ونظهر input group يدوياً (لكن نترك المستخدم يدخل الكود)
      document.getElementById('pairingInputGroup').style.display = 'flex';
      document.getElementById('pairedActions').style.display = 'none';
      // تحديث حالة الاتصال (لن تكون مقترنة)
      document.getElementById('pluginConnectionStatus').textContent = '❌ غير مقترن';
      document.getElementById('pluginConnectionStatus').style.color = '#f44336';
    }
  } catch (err) {
    // في حالة فشل الطلب (مثلاً 404) نتعامل معها كأنها غير مدعومة ونعرض رسالة بديلة
    resultDiv.textContent = '⚠️ لإعادة الاقتران، يرجى إعادة تشغيل البلوجن (أو استخدم الأمر /rebind في السيرفر) ثم أدخل الكود الجديد.';
    resultDiv.style.color = '#ff9800';
    document.getElementById('pairingInputGroup').style.display = 'flex';
    document.getElementById('pairedActions').style.display = 'none';
    document.getElementById('pluginConnectionStatus').textContent = '❌ غير مقترن';
    document.getElementById('pluginConnectionStatus').style.color = '#f44336';
  }
});

// استدعاء التحقق من حالة الاقتران عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  checkPluginStatus();
  // يمكن استدعاؤها أيضاً بعد تسجيل الدخول
});

function getAuthToken() {
  try {
    return localStorage.getItem("sm_token") || getCookie("token");
  } catch {
    return getCookie("token");
  }
}

function saveAuthToken(token) {
  try {
    if (token) localStorage.setItem("sm_token", token);
    else localStorage.removeItem("sm_token");
  } catch {}
}

function getSelectedProfileId() {
  const lbl = document.getElementById("current-profile-label");
  if (!lbl) return null;
  const m = String(lbl.textContent || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function updateClearShortcutButton() {
  const shortcutValue = document.getElementById("shortcutData").value;
  const clearBtn = document.getElementById("clearShortcutBtn");
  if (clearBtn) {
    clearBtn.style.display =
      shortcutValue && shortcutValue.trim() !== "" ? "inline-block" : "none";
  }
}

// ============================================================
// شريط حالة التحديث التلقائي (التثبيت تلقائي بدون سؤال)
// ============================================================
function ensureUpdateBanner() {
  let banner = document.getElementById("updateStatusBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "updateStatusBanner";
    banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:99999;
      background:linear-gradient(90deg,#0d47a1,#1976d2);color:#fff;
      padding:10px 20px;text-align:center;font-weight:bold;font-size:14px;
      box-shadow:0 2px 10px rgba(0,0,0,0.5);display:none`;
    document.body.appendChild(banner);
  }
  return banner;
}

function showUpdateBanner(html) {
  const banner = ensureUpdateBanner();
  banner.innerHTML = html;
  banner.style.display = "block";
}

if (window.electronAPI) {
  const ipc = require("electron").ipcRenderer;
  ipc.on("update-available", (_, info) => {
    showUpdateBanner(
      `🔄 يتوفر تحديث جديد (${escapeHtml(info.version || "")}) - جاري التحميل…`,
    );
  });
  ipc.on("update-progress", (_, p) => {
    showUpdateBanner(
      `⬇️ جاري تحميل التحديث… ${p.percent || 0}% - سيُثبَّت تلقائياً`,
    );
  });
  ipc.on("update-installing", (_, info) => {
    showUpdateBanner(
      `⚙️ جاري تثبيت التحديث (${escapeHtml(info.version || "")}) - سيعود التطبيق تلقائياً خلال لحظات، لا تغلقه…`,
    );
  });
}

// ============================================================
// دوال التأكيد والرسائل
// ============================================================
function showConfirm(message, title = "تأكيد") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const messageEl = document.getElementById("confirmMessage");
    const yesBtn = document.getElementById("confirmYesBtn");
    const noBtn = document.getElementById("confirmNoBtn");

    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.style.display = "flex";
    yesBtn.focus();

    const cleanup = () => {
      modal.style.display = "none";
      yesBtn.removeEventListener("click", handleYes);
      noBtn.removeEventListener("click", handleNo);
    };

    const handleYes = () => {
      cleanup();
      resolve(true);
    };
    const handleNo = () => {
      cleanup();
      resolve(false);
    };

    yesBtn.addEventListener("click", handleYes);
    noBtn.addEventListener("click", handleNo);
  });
}

// ============================================================
// دوال CAPTCHA
// ============================================================
const CAPTCHA_SELECTORS = [
  "#captcha-verify-image",
  "#captcha_container",
  "div[id^='captcha']",
  ".captcha_verify_action",
  "iframe[src*='captcha']",
];

function isElementVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  try {
    const style = window.getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      parseFloat(style.opacity) < 0.05
    )
      return false;
  } catch {}
  return true;
}

function isCaptchaVisible() {
  for (const selector of CAPTCHA_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (isElementVisible(el)) return true;
    }
  }
  return false;
}

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
    let res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
      headers: meHeaders,
    });
    let data = await res.json().catch(() => ({}));

    // توافق مع الإصدارات الأقدم من الخادم: /api/auth/me غير موجود (404)
    if (res.status === 404) {
      const probe = await fetch(`${API_BASE}/api/profiles`, {
        credentials: "include",
        headers: meHeaders,
      });
      if (probe.ok) {
        isLoggedIn = true;
        screensLoaded = false; // ✅ إعادة تعيين عند تبديل الحساب
        // حفظ التوكن من الكوكيز إلى localStorage لضمان استمراره
        const token = getCookie("token");
        if (token) saveAuthToken(token);
        // ربط الـ Agent
        await bindAgent(token);
        // تحديث البيانات الأساسية
        currentUserPlan = "paid";
        currentUserRole = "user";
        currentUserId = null;
        data = { success: true, user: {}, subscription: { status: "active" } };
        try {
          await loadRconConfig();
          await loadProfiles();
          await initHotkey();
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
          statusEl.innerHTML = `<i class="fas fa-user-circle"></i> مرحباً ${emailLabel}`;
        }
        return;
      }
    }

    if (data.success) {
      isLoggedIn = true;
      screensLoaded = false; // ✅ إعادة تعيين عند تسجيل الدخول بحساب جديد
      const user = data.user;
      const subscription = data.subscription;

      if (userInput && user.tiktokUsername)
        userInput.value = user.tiktokUsername;
      currentUserPlan = user.plan;
      currentUserPlanType = user.planType;
      currentUserRole = user.role;
      currentUserSelectedProfile = user.selectedProfile || 1;
      currentUserId = user.id;

      const adminSidebar = document.querySelector(".admin");
      if (adminSidebar) {
        if (currentUserRole === "admin") {
          adminSidebar.style.display = "block";
          adminSidebar.onclick = () => {
            document.querySelector(".start-section").style.display = "none";
            document.querySelector(".start-section-2").style.display = "none";
            document.getElementById("startSection3").style.display = "none";
            document.getElementById("startSection4").style.display = "block";
            document.getElementById("startSectionHotkey").style.display =
              "none";
            document
              .querySelectorAll(".button-select-slide")
              .forEach((el) => el.classList.remove("active"));
            adminSidebar.classList.add("active");
            if (typeof loadAdminDashboard === "function") loadAdminDashboard();
          };
        } else {
          adminSidebar.style.display = "none";
        }
      }

      const showUpgrade = subscription.status !== "active";
      if (upgradeBtn)
        upgradeBtn.style.display = showUpgrade ? "inline-flex" : "none";

      let planText = "";
      if (subscription.status === "free") planText = "مجاني";
      else if (subscription.status === "active") {
        if (user.planType === "monthly")
          planText = `شهري (ينتهي ${new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")})`;
        else if (user.planType === "yearly")
          planText = `سنوي (ينتهي ${new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")})`;
        else planText = "مدفوع";
      } else if (subscription.status === "warning")
        planText = `⚠️ تحذير: ينتهي بعد ${Math.floor(subscription.hoursLeft)} ساعة`;
      else if (subscription.status === "grace")
        planText = `⏳ فترة سماح: متبقي ${Math.floor(subscription.hoursLeft)} ساعة للتجديد`;
      else planText = user.plan === "paid" ? "مدفوع (منتهي)" : "مجاني";
      if (statusEl)
        statusEl.innerHTML = `<i class="fas fa-user-circle"></i> مرحباً ${user.email} | ${planText}`;
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
  }
}

// ============================================================
// دوال الحالة المباشرة (Live Status)
// ============================================================
function updateUIForDisconnected() {
  const connectBtn = document.getElementById("send-usertik");
  const connectText = document.getElementById("connect-text");
  const connectProfile = document.getElementById("connect-profile-aside");
  isLiveConnected = false;
  connectBtn.textContent = "Connect to TikTok LIVE";
  connectBtn.style.backgroundColor = "";
  connectText.textContent = "Disconnected";
  connectText.style.color = "red";
  if (connectProfile) {
    connectProfile.style.pointerEvents = "auto";
    connectProfile.style.opacity = 1;
  }
}

async function checkLiveStatus() {
  if (liveStatusCheckInProgress) return;
  liveStatusCheckInProgress = true;
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/live-status`);
    if (!res.ok) {
      updateUIForDisconnected();
      liveStatusCheckInProgress = false;
      return;
    }
    const data = await res.json();
    const connectBtn = document.getElementById("send-usertik");
    const connectText = document.getElementById("connect-text");
    const tiktokDisplay = document.getElementById("tiktok-display");
    const connectProfile = document.getElementById("connect-profile-aside");
    const userInput = document.getElementById("user-tiktok");

    if (data.username && document.activeElement !== userInput) {
      userInput.value = data.username;
    }

    if (data.isLive === true) {
      isLiveConnected = true;
      connectBtn.textContent = "Disconnect";
      connectBtn.style.backgroundColor = "#f44336";
      tiktokDisplay.textContent = data.username || "username";
      connectText.textContent = "Connected";
      connectText.style.color = "#1dd9e6e1";
      if (connectProfile) {
        connectProfile.style.pointerEvents = "none";
        connectProfile.style.opacity = 0.6;
      }
    } else {
      updateUIForDisconnected();
    }
  } catch (err) {
    console.error("❌ [checkLiveStatus] فشل الاتصال:", err);
    updateUIForDisconnected();
  } finally {
    liveStatusCheckInProgress = false;
  }
}

// ============================================================
// دوال البروفايلات
// ============================================================
function renderProfileSelect(profiles, selectedId) {
  const selectContainer = document.getElementById("select-profile");
  if (!selectContainer) return;
  const selectedSpan = selectContainer.querySelector(".selected .label");
  const optionsUl = selectContainer.querySelector(".options");
  if (!selectedSpan || !optionsUl) return;

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  if (selectedProfile) {
    const nameDisplay = document.getElementById("current-profile-name-display");
    if (nameDisplay) nameDisplay.textContent = selectedProfile.name;
    const profileLabel = document.getElementById("current-profile-label");
    if (profileLabel) profileLabel.textContent = `Profile ${selectedId}`;
  }

  if (closeOptionsListener) {
    document.removeEventListener("click", closeOptionsListener);
    closeOptionsListener = null;
  }

  const newOptionsUl = optionsUl.cloneNode(false);
  optionsUl.parentNode.replaceChild(newOptionsUl, optionsUl);
  const finalOptionsUl = newOptionsUl;

  async function selectProfile(profileId) {
    const res = await fetchWithAuth(`${API_BASE}/api/profile/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: profileId }),
    });
    const data = await res.json();
    if (data.success) {
      currentUserSelectedProfile = profileId;
      await loadProfiles();
      const optionsUlNew = document.querySelector("#select-profile .options");
      if (optionsUlNew) optionsUlNew.style.display = "none";
      showMessage(
        `✅ تم التبديل إلى ${profileNames[profileId] || `Profile ${profileId}`}`,
      );
    } else {
      showMessage("❌ فشل تبديل البروفايل");
    }
  }

  profiles.forEach((profile) => {
    const li = document.createElement("li");
    li.className = "profile-item";
    li.dataset.id = profile.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "profile-name";
    nameSpan.textContent = profile.name;
    nameSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      selectProfile(profile.id);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "profile-edit-btn";
    editBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentName = profile.name || `Profile ${profile.id}`;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "profile-name-input";
      input.value = currentName;
      input.dataset.profileId = profile.id;
      li.innerHTML = "";
      li.appendChild(input);
      input.focus();

      const saveName = async () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          await updateProfileName(profile.id, newName);
        } else {
          renderProfileSelect(profiles, selectedId);
        }
      };

      input.addEventListener("blur", saveName);
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
      });
    });

    if (profile.id === selectedId) {
      li.classList.add("selected-li");
    }

    li.appendChild(nameSpan);
    li.appendChild(editBtn);
    finalOptionsUl.appendChild(li);
  });

  const selectedDiv = selectContainer.querySelector(".selected");
  if (selectedDiv) {
    const newSelectedDiv = selectedDiv.cloneNode(true);
    selectedDiv.parentNode.replaceChild(newSelectedDiv, selectedDiv);
    newSelectedDiv.onclick = (e) => {
      e.stopPropagation();
      const isVisible = finalOptionsUl.style.display === "block";
      finalOptionsUl.style.display = isVisible ? "none" : "block";
    };
  }

  closeOptionsListener = function closeOptions() {
    finalOptionsUl.style.display = "none";
  };
  document.addEventListener("click", closeOptionsListener);
}

async function loadProfiles() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/profiles`);
    if (!res.ok) throw new Error("فشل تحميل البروفايلات");
    const data = await res.json();
    if (data.success && data.profiles) {
      profileNames = {};
      data.profiles.forEach((p) => {
        profileNames[p.id] = p.name;
      });
      if (
        currentUserSelectedProfile &&
        data.profiles.some((p) => p.id === currentUserSelectedProfile)
      ) {
        renderProfileSelect(data.profiles, currentUserSelectedProfile);
      } else {
        const firstProfileId = data.profiles[0]?.id || 1;
        renderProfileSelect(data.profiles, firstProfileId);
      }
      await loadCommands();
    }
  } catch (err) {
    console.warn("⚠️ فشل تحميل البروفايلات:", err.message);
  }
}

async function updateProfileName(profileId, newName) {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/profile/${profileId}/name`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      },
    );
    const data = await res.json();
    if (data.success) {
      profileNames[profileId] = newName;
      showMessage("✅ تم تحديث اسم البروفايل");
      await loadProfiles();
    } else showMessage("❌ فشل تحديث الاسم");
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال");
  }
}

// ============================================================
// دوال RCON
// ============================================================
async function loadRconConfig() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/rcon-config`);
    if (!res.ok) throw new Error("فشل تحميل إعدادات RCON");
    const config = await res.json();
    document.getElementById("player-ip").value = config.host || "";
    document.getElementById("player-port").value = config.port || "";
    document.getElementById("player-password").value = config.password || "";
    document.getElementById("player-name").value = config.player || "";
    checkPluginStatus();
  } catch (err) {
    console.warn("⚠️ لم يتم تحميل إعدادات RCON:", err.message);
  }
}

document
  .getElementById("send-minecraft-properties")
  .addEventListener("click", (event) =>
    withButtonLock(event.currentTarget, async () => {
      const host = document.getElementById("player-ip").value.trim();
      const port = document.getElementById("player-port").value.trim();
      const password = document.getElementById("player-password").value.trim();
      const player = document.getElementById("player-name").value.trim();
      if (!host || !port || !password || !player) {
        showMessage("⚠️ جميع حقول ماين كرافت مطلوبة");
        return;
      }
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/rcon-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            port: parseInt(port),
            password,
            player,
          }),
        });
        const data = await res.json();
        if (data.success) showMessage("✅ تم حفظ إعدادات RCON بنجاح");
        else showMessage("❌ فشل حفظ الإعدادات: " + (data.message || ""));
      } catch (err) {
        console.error(err);
        showMessage("❌ خطأ في الاتصال بالسيرفر");
      }
    }),
  );

// ============================================================
// دوال التخزين
// ============================================================
function updateStorageUI(storageData) {
  if (!storageData) return;
  const audioUsed = storageData.audio.usedMB;
  const audioLimit = storageData.audio.limitMB;
  const videoUsed = storageData.video.usedMB;
  const videoLimit = storageData.video.limitMB;

  const audioProgress = document.getElementById("audio-progress");
  const audioText = document.getElementById("audio-storage-text");
  const videoProgress = document.getElementById("video-progress");
  const videoText = document.getElementById("video-storage-text");

  if (audioProgress) {
    audioProgress.value = audioUsed;
    audioProgress.max = audioLimit;
    audioText.textContent = `${audioUsed.toFixed(1)} / ${audioLimit} ميجا`;
  }
  if (videoProgress) {
    videoProgress.value = videoUsed;
    videoProgress.max = videoLimit;
    videoText.textContent = `${videoUsed.toFixed(1)} / ${videoLimit} ميجا`;
  }
}

async function checkStorageNotifications() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/user/storage`);
    const data = await res.json();
    if (data.success) {
      // تحديث أشرطة التقدم فقط
      updateStorageUI({
        audio: { usedMB: data.audio.usedMB, limitMB: data.audio.limitMB },
        video: { usedMB: data.video.usedMB, limitMB: data.video.limitMB },
      });

      // ✅ إخفاء الإشعار الثابت نهائياً (لأنه سيتم عبر لوحة الأدمن)
      const storageNotif = document.getElementById("storage-notification");
      if (storageNotif) {
        storageNotif.style.display = "none";
      }
    }
  } catch (err) {
    console.warn("فشل تحديث حالة التخزين", err);
    setTimeout(() => checkStorageNotifications(), 1000);
  }
}

// ============================================================
// دوال الهدايا (Gifts)
// ============================================================
async function loadGifts() {
  try {
    const CACHE_KEY = "gifts_cache";
    const CACHE_TIME_KEY = "gifts_cache_time";
    const CACHE_DURATION = 24 * 60 * 60 * 1000;

    let giftsData = null;
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
    if (
      cached &&
      cachedTime &&
      Date.now() - parseInt(cachedTime) < CACHE_DURATION
    ) {
      giftsData = JSON.parse(cached);
    } else {
      const res = await fetchWithAuth(`${API_BASE}/api/gifts`);
      if (!res.ok) throw new Error("فشل جلب الهدايا من الخادم");
      const data = await res.json();
      if (data.success && Array.isArray(data.gifts)) {
        giftsData = data.gifts;
        giftsData.sort(
          (a, b) => (a.diamond_count || 0) - (b.diamond_count || 0),
        );
        localStorage.setItem(CACHE_KEY, JSON.stringify(giftsData));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
      } else {
        throw new Error("تنسيق غير صحيح للهدايا من الخادم");
      }
    }

    gifts = giftsData;
    giftsLoaded = true;

    const addCard = document.getElementById("addCard");
    if (addCard && addCard.style.display === "block") {
      updateGiftDropdown();
    }
  } catch (err) {
    console.error("❌ خطأ في تحميل الهدايا:", err);
    gifts = [];
    giftsLoaded = false;
  }
}

async function ensureGiftsLoaded() {
  if (giftsLoaded) return;
  if (giftsLoadingPromise) return giftsLoadingPromise;
  giftsLoadingPromise = loadGifts();
  await giftsLoadingPromise;
  giftsLoaded = true;
}

function getGiftImage(giftId) {
  if (!gifts || gifts.length === 0) return "";
  const gift = gifts.find((g) => String(g.id) === String(giftId));
  return gift?.image?.url_list?.[0] || "";
}

function updateGiftDropdown() {
  const dropdown = document.querySelector("#giftDropdown .options");
  const selected = document.querySelector("#giftDropdown .selected");
  const hiddenInput = document.getElementById("giftSelect");
  const giftNameInput = document.getElementById("giftName");

  if (!dropdown || !selected) return;
  if (!gifts || !gifts.length) {
    selected.textContent = "⚠️ لا توجد هدايا";
    return;
  }

  dropdown.innerHTML = "";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "🔍 بحث عن هدية...";
  searchInput.id = "giftSearchInput";
  searchInput.style.cssText =
    "width:100%; padding:8px; margin:0 0 8px 0; background:#333; color:white; border:none; border-radius:4px; position: sticky; top: 0; z-index: 2;";

  searchInput.oninput = (e) => {
    const term = e.target.value.toLowerCase();
    Array.from(dropdown.children).forEach((child) => {
      if (child === searchInput) return;
      const text = child.innerText.toLowerCase();
      child.style.display = text.includes(term) ? "flex" : "none";
    });
  };
  dropdown.appendChild(searchInput);

  const currentValue = hiddenInput?.value ? String(hiddenInput.value) : null;
  let activeElement = null;

  const sortedGifts = [...gifts].sort(
    (a, b) => (a.diamond_count || 0) - (b.diamond_count || 0),
  );

  sortedGifts.forEach((gift) => {
    const option = document.createElement("div");
    option.className = "option";
    option.style.cssText =
      "display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-bottom: 1px solid #444;";

    if (currentValue && String(gift.id) === currentValue) {
      option.classList.add("active");
      option.style.backgroundColor = "#2a4a2a";
      option.style.borderLeft = "3px solid #1dd9e6e1";
      activeElement = option;
    }

    const img = document.createElement("img");
    img.src = gift.image?.url_list?.[0] || "";
    img.style.cssText =
      "width: 35px; height: 35px; object-fit: cover; border-radius: 4px;";
    img.onerror = function () {
      this.style.display = "none";
    };
    const span = document.createElement("span");
    span.textContent = `${gift.name} - ${gift.diamond_count || 0} 💎`;

    option.appendChild(img);
    option.appendChild(span);

    option.onclick = () => {
      selected.textContent = gift.name;
      hiddenInput.value = gift.id;
      if (giftNameInput) giftNameInput.value = gift.name;
      dropdown.style.display = "none";
      searchInput.value = "";
      updateGiftDropdown();
    };

    dropdown.appendChild(option);
  });

  const giftDD = document.querySelector("#giftDropdown");
  if (giftDD) {
    const selectedDiv = giftDD.querySelector(".selected");
    const optionsDiv = giftDD.querySelector(".options");
    if (selectedDiv && optionsDiv) {
      selectedDiv.onclick = null;
      selectedDiv.onclick = (e) => {
        e.stopPropagation();
        const isVisible = optionsDiv.style.display === "block";
        if (isVisible) {
          optionsDiv.style.display = "none";
        } else {
          optionsDiv.style.display = "block";
          setTimeout(() => {
            const inp = document.getElementById("giftSearchInput");
            if (inp) inp.focus();
          }, 100);
          if (activeElement) {
            setTimeout(() => {
              const searchHeight = searchInput.offsetHeight;
              const optionTop = activeElement.offsetTop;
              dropdown.scrollTop = optionTop - searchHeight - 8;
            }, 50);
          }
        }
      };
      optionsDiv.style.display = "none";
    }
  }

  document.addEventListener("click", (e) => {
    const giftDD = document.querySelector("#giftDropdown");
    if (giftDD && !giftDD.contains(e.target)) {
      const optionsDiv = giftDD.querySelector(".options");
      if (optionsDiv) optionsDiv.style.display = "none";
    }
  });
}

// ============================================================
// دوال الصوت (Audio)
// ============================================================
async function loadAudios() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/audio`);
    if (!res.ok) throw new Error(`فشل تحميل الأصوات: ${res.status}`);
    const data = await res.json();

    function getCleanDisplayName(filename) {
      let name = filename.replace(/^\/audios\//, "");
      name = name.replace(/\.[^/.]+$/, "");
      name = name.replace(/-\d+$/, "");
      name = name.replace(/-/g, " ");
      return name;
    }

    let audios = [];
    if (data.success && Array.isArray(data.audios)) {
      audios = data.audios.map((a) => ({
        file: a.file,
        owner: a.owner || (a.isDefault ? "افتراضي" : "غير معروف"),
        displayName: getCleanDisplayName(a.file),
        cloudinaryUrl: a.cloudinaryUrl,
        isDefault: a.isDefault || false,
      }));
    }

    globalAudios = [
      ...audios.filter((a) => !a.isDefault),
      ...audios.filter((a) => a.isDefault),
    ];

    const modal = document.getElementById("audioModal");
    const modalSearch = document.getElementById("audioSearchInput");
    const modalContainer = document.getElementById("audioOptionsContainer");
    const closeModalBtn = document.querySelector(
      "#audioModal .close-audio-modal",
    );
    let selectedField = document.querySelector("#audioDropdown .selected");
    const hiddenInput = document.getElementById("audioSelect");

    if (!modal || !modalContainer || !selectedField) return;

    function renderModalOptions(filter = "") {
      if (!modalContainer) return;
      modalContainer.innerHTML = "";

      const filtered = globalAudios.filter((a) =>
        a.displayName.toLowerCase().includes(filter.toLowerCase()),
      );

      if (filtered.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "audio-option";
        emptyDiv.style.justifyContent = "center";
        emptyDiv.textContent = "❌ لا توجد نتائج";
        modalContainer.appendChild(emptyDiv);
        return;
      }

      filtered.forEach((audio) => {
        const optionDiv = document.createElement("div");
        optionDiv.className = "audio-option";
        optionDiv.setAttribute("data-file", audio.file);

        const leftDiv = document.createElement("div");
        leftDiv.className = "audio-left";
        const icon = document.createElement("i");
        icon.className = "fas fa-music audio-icon";
        leftDiv.appendChild(icon);
        const nameDiv = document.createElement("div");
        const nameSpan = document.createElement("div");
        nameSpan.className = "audio-name";
        nameSpan.textContent = audio.displayName;
        const ownerSpan = document.createElement("div");
        ownerSpan.className = "audio-owner";
        ownerSpan.innerHTML = `<i class="fas fa-user-circle"></i> ${escapeHtml(audio.owner)}`;
        nameDiv.appendChild(nameSpan);
        nameDiv.appendChild(ownerSpan);
        leftDiv.appendChild(nameDiv);

        const rightDiv = document.createElement("div");
        rightDiv.className = "audio-right";
        const playBtn = document.createElement("button");
        playBtn.className = "play-audio-btn";
        playBtn.title = "تجربة الصوت";
        playBtn.innerHTML = '<i class="fas fa-play"></i> استماع';
        rightDiv.appendChild(playBtn);
        if (!audio.isDefault) {
          const delBtn = document.createElement("button");
          delBtn.className = "delete-audio-btn";
          delBtn.title = "حذف الصوت";
          delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
          rightDiv.appendChild(delBtn);
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteAudioFile(String(audio.file), false, false);
          });
        }

        optionDiv.appendChild(leftDiv);
        optionDiv.appendChild(rightDiv);

        playBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (currentAudioObj) {
            currentAudioObj.pause();
            currentAudioObj.currentTime = 0;
          }
          let audioUrl;
          if (audio.isDefault) {
            audioUrl = audio.cloudinaryUrl || `${API_BASE}${audio.file}`;
          } else {
            if (audio.cloudinaryUrl) {
              audioUrl = audio.cloudinaryUrl;
            } else {
              showMessage("❌ رابط الصوت غير متوفر، تأكد من رفعه بنجاح");
              return;
            }
          }
          currentAudioObj = new Audio(audioUrl);
          const volEl = document.getElementById("volume");
          const vol = volEl ? parseInt(volEl.value) || 100 : 100;
          currentAudioObj.volume = Math.max(0, Math.min(1, vol / 100));
          currentAudioObj.play().catch((err) => {
            console.error("فشل تشغيل الصوت:", err);
          });
        });

        optionDiv.addEventListener("click", () => {
          selectedField.textContent = audio.displayName;
          hiddenInput.value = audio.file;
          modalSearch.value = "";
          modal.style.display = "none";
          if (currentAudioObj) {
            currentAudioObj.pause();
            currentAudioObj.currentTime = 0;
          }
        });

        modalContainer.appendChild(optionDiv);
      });
    }

    renderModalOptionsGlobal = renderModalOptions;
    audioModalGlobal = modal;
    modalSearchGlobal = modalSearch;
    selectedFieldGlobal = selectedField;
    hiddenInputGlobal = hiddenInput;
    currentAudioObjGlobal = currentAudioObj;

    const newSelectedField = selectedField.cloneNode(true);
    selectedField.parentNode.replaceChild(newSelectedField, selectedField);
    const finalSelectedField = newSelectedField;
    selectedField = finalSelectedField;

    finalSelectedField.addEventListener("click", () => {
      renderModalOptions(modalSearch.value);
      modal.style.display = "flex";
      modalSearch.focus();
    });

    if (closeModalBtn) {
      closeModalBtn.onclick = () => {
        modal.style.display = "none";
        if (currentAudioObj) {
          currentAudioObj.pause();
          currentAudioObj.currentTime = 0;
        }
      };
    }

    window.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        if (currentAudioObj) {
          currentAudioObj.pause();
          currentAudioObj.currentTime = 0;
        }
      }
    };

    modalSearch.addEventListener("input", () =>
      renderModalOptions(modalSearch.value),
    );

    if (globalAudios.length === 0) {
      finalSelectedField.textContent = "⚠️ لا توجد أصوات - ارفع ملفاً";
    } else {
      const currentFile = hiddenInput.value;
      if (currentFile) {
        const found = globalAudios.find((a) => a.file === currentFile);
        if (found) {
          finalSelectedField.textContent = found.displayName;
        } else {
          finalSelectedField.textContent = "اختر صوت...";
          hiddenInput.value = "";
        }
      }
    }

    if (modal.style.display === "flex") renderModalOptions(modalSearch.value);
  } catch (err) {
    console.error("خطأ في تحميل الأصوات:", err);
  }
}

async function deleteAudioFile(filename, skipConfirm = false, keep = false) {
  if (!skipConfirm) {
    const confirmed = await showConfirm(
      `هل تريد حذف الصوت "${filename}" نهائيًا؟`,
      "حذف الصوت",
    );
    if (!confirmed) return;
  }

  try {
    const url = keep
      ? `${API_BASE}/api/audio/${encodeURIComponent(filename)}?keep=true`
      : `${API_BASE}/api/audio/${encodeURIComponent(filename)}`;
    const res = await fetchWithAuth(url, { method: "DELETE" });
    const data = await res.json();

    if (data.success) {
      showMessage(
        keep
          ? "✅ تم إزالة الصوت من حسابك (يبقى في السحابة)"
          : "✅ تم حذف الصوت نهائياً",
      );
      if (!keep) {
        globalAudios = globalAudios.filter((a) => a.file !== filename);
        document.getElementById("audioSelect").value = "";
        document.querySelector("#audioDropdown .selected").textContent =
          "اختر صوت...";
      }
      await checkStorageNotifications();
      if (
        audioModalGlobal &&
        audioModalGlobal.style.display === "flex" &&
        renderModalOptionsGlobal
      ) {
        const searchValue = modalSearchGlobal ? modalSearchGlobal.value : "";
        renderModalOptionsGlobal(searchValue);
      }
    } else {
      showMessage("❌ فشل حذف الصوت: " + (data.message || ""));
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ أثناء حذف الصوت");
  }
}

// ============================================================
// دوال الفيديو (Video)
// ============================================================
async function deleteVideoFile(filename, skipConfirm = false, keep = false) {
  if (!skipConfirm) {
    const confirmed = await showConfirm(
      `هل تريد حذف الفيديو "${filename}" نهائيًا؟`,
      "حذف الفيديو",
    );
    if (!confirmed) return;
  }

  try {
    const url = keep
      ? `${API_BASE}/api/video/${encodeURIComponent(filename)}?keep=true`
      : `${API_BASE}/api/video/${encodeURIComponent(filename)}`;
    const res = await fetchWithAuth(url, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showMessage(
        keep
          ? "✅ تم إزالة الفيديو من حسابك (يبقى في السحابة)"
          : "✅ تم حذف الفيديو نهائياً",
      );
      await checkStorageNotifications();
    } else {
      showMessage("❌ فشل حذف الفيديو: " + (data.message || ""));
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ أثناء حذف الفيديو");
  }
}

// ============================================================
// دوال الأوامر (Commands)
// ============================================================
function updateInputsForType(type) {
  const thresholdEl = document.getElementById("threshold");
  const thresholdLabel = document.querySelector('label[for="threshold"]');
  const keywordEl = document.getElementById("keyword");
  const keywordLabel = document.querySelector('label[for="keyword"]');
  const giftSection = document.getElementById("giftChooserSection");
  const hidden = document.getElementById("actionType");

  if (thresholdEl) thresholdEl.style.display = "none";
  if (thresholdLabel) thresholdLabel.style.display = "none";
  if (keywordEl) keywordEl.style.display = "none";
  if (keywordLabel) keywordLabel.style.display = "none";

  if (type === "like") {
    if (thresholdEl) thresholdEl.style.display = "";
    if (thresholdLabel) thresholdLabel.style.display = "";
  } else if (type === "comment") {
    if (keywordEl) keywordEl.style.display = "";
    if (keywordLabel) keywordLabel.style.display = "";
  }

  if (giftSection)
    giftSection.style.display = type === "gift" ? "block" : "none";
  if (hidden) hidden.value = type;
}

function captureOriginalFormValues() {
  originalFormValues = {
    actionName: document.getElementById("actionName").value.trim(),
    actionType: document.getElementById("actionType").value,
    giftSelect: document.getElementById("giftSelect").value,
    giftName: (document.getElementById("giftName").value || "").trim(),
    webhookUrl: (document.getElementById("webhookUrl").value || "").trim(),
    keyword: (document.getElementById("keyword").value || "").trim(),
    threshold: document.getElementById("threshold").value,
    command: document.getElementById("command").value.trim(),
    repeat: document.getElementById("repeat").value,
    interval: document.getElementById("interval").value,
    delayBefore: document.getElementById("delayBefore").value,
    audioSelect: document.getElementById("audioSelect").value,
    volume: document.getElementById("volume").value,
    video: document.getElementById("video").value,
    screen: document.getElementById("screen").value,
    oncePerLive: document.getElementById("oncePerLive").checked,
    videoVolume: document.getElementById("videoVolume").value,
    shortcutData: document.getElementById("shortcutData").value,
    targetUser: (document.getElementById("targetUser").value || "all").trim(),
    showOverlay: document.getElementById("showOverlayCheckbox").checked,
    overlayText: (
      document.getElementById("overlayTextInput").value || ""
    ).trim(),
    duration: document.getElementById("durationInput").value,
  };
}

function hasFormChanged() {
  const current = {
    actionName: document.getElementById("actionName").value.trim(),
    actionType: document.getElementById("actionType").value,
    giftSelect: document.getElementById("giftSelect").value,
    giftName: (document.getElementById("giftName").value || "").trim(),
    webhookUrl: (document.getElementById("webhookUrl").value || "").trim(),
    keyword: (document.getElementById("keyword").value || "").trim(),
    threshold: document.getElementById("threshold").value,
    command: document.getElementById("command").value.trim(),
    repeat: document.getElementById("repeat").value,
    interval: document.getElementById("interval").value,
    delayBefore: document.getElementById("delayBefore").value,
    audioSelect: document.getElementById("audioSelect").value,
    volume: document.getElementById("volume").value,
    video: document.getElementById("video").value,
    screen: document.getElementById("screen").value,
    oncePerLive: document.getElementById("oncePerLive").checked,
    videoVolume: document.getElementById("videoVolume").value,
    shortcutData: document.getElementById("shortcutData").value,
    targetUser: (document.getElementById("targetUser").value || "all").trim(),
    showOverlay: document.getElementById("showOverlayCheckbox").checked,
    overlayText: (
      document.getElementById("overlayTextInput").value || ""
    ).trim(),
    duration: document.getElementById("durationInput").value,
  };

  for (let key in originalFormValues) {
    let oldVal = originalFormValues[key];
    let newVal = current[key];
    if (oldVal === undefined || oldVal === null) oldVal = "";
    if (newVal === undefined || newVal === null) newVal = "";
    if (oldVal !== newVal) {
      if (
        key === "giftName" &&
        current.giftSelect === originalFormValues.giftSelect
      )
        continue;
      return true;
    }
  }
  return false;
}

async function checkForChangesAndClose() {
  // أثناء رفع ملف: تأكيد دائماً — "نعم" يلغي كل شيء، "لا" يكمل الرفع ولا يغلق
  if (pendingUploads.audio || pendingUploads.video) {
    const confirmed = await showConfirm(
      "جاري رفع ملف حالياً. هل تريد إلغاء الرفع وإغلاق النافذة؟ سيتم فقد كل ما تم رفعه.",
      "إلغاء الرفع",
    );
    if (confirmed) {
      uploadsCancelled = true;
      hideAddCard();
      Promise.allSettled([pendingUploads.audio, pendingUploads.video]).finally(
        () => {
          uploadsCancelled = false;
        },
      );
    }
    return;
  }
  if (hasFormChanged()) {
    const confirmed = await showConfirm(
      "هل تريد إغلاق النافذة؟ سيتم فقد أي تغييرات غير محفوظة.",
      "إغلاق",
    );
    if (confirmed) hideAddCard();
  } else hideAddCard();
}

function showAddCard(commandData = null) {
  if (commandData?.__type === "gift" && !giftsLoaded) {
    ensureGiftsLoaded()
      .then(() => _showAddCard(commandData))
      .catch(() => _showAddCard(commandData));
  } else _showAddCard(commandData);
}

function _showAddCard(commandData = null) {
  tempUploadedFiles.audio = null;
  tempUploadedFiles.video = null;

  if (commandData) {
    editingId = commandData._id || null;
    editingType = commandData.__type === "gift" ? "gift" : "interaction";
  } else {
    editingId = null;
    editingType = null;
  }

  document.getElementById("cardOverlay").style.display = "block";
  document.getElementById("addCard").style.display = "block";
  const card = document.getElementById("addCard");
  card.style.display = "block";
  const typeSelect = document.getElementById("actionType");
  const giftSection = document.getElementById("giftChooserSection");

  // ✅ السماح بتغيير النوع دائماً (حتى في وضع التعديل)
  typeSelect.disabled = false;
  typeSelect.style.opacity = 1;
  typeSelect.title = "";

  if (!typeSelect._hasChangeListener) {
    typeSelect.addEventListener("change", () => {
      giftSection.style.display =
        typeSelect.value === "gift" ? "block" : "none";
    });
    typeSelect._hasChangeListener = true;
  }

  const giftDropdownSelected = document.querySelector(
    "#giftDropdown .selected",
  );
  document.getElementById("shortcutData").value = "";
  document.getElementById("shortcutDisplay").textContent = "لم يتم التعيين";
  currentShortcutCombo = "";

  if (commandData) {
    if (commandData.combo) {
      document.getElementById("shortcutData").value = commandData.combo;
      document.getElementById("shortcutDisplay").textContent =
        commandData.combo;
      currentShortcutCombo = commandData.combo;
    }

    // تعيين النوع من البيانات
    const givenType =
      commandData.__type === "gift"
        ? "gift"
        : typeof commandData.type !== "undefined" &&
            commandData.type !== null &&
            String(commandData.type).trim() !== ""
          ? String(commandData.type).trim()
          : "comment";

    typeSelect.value = givenType;
    updateInputsForType(givenType);

    const actionSelectSpan = document.querySelector(
      "#addCard .custom-select.action-select .selected span",
    );
    const labelMap = {
      gift: "🎁 Gift",
      follow: "Follow",
      like: "Like",
      comment: "Comment",
      share: "Share",
    };
    if (actionSelectSpan) {
      actionSelectSpan.textContent =
        labelMap[givenType] ||
        String(givenType).charAt(0).toUpperCase() + String(givenType).slice(1);
    }

    giftSection.style.display = givenType === "gift" ? "block" : "none";

    const gid = commandData.giftId != null ? String(commandData.giftId) : "";
    document.getElementById("giftSelect").value = gid;
    document.getElementById("giftName").value = commandData.giftName || "";
    document.getElementById("webhookUrl").value = commandData.webhookUrl || "";

    if (gid && gifts && gifts.length > 0) {
      const found = gifts.find((g) => String(g.id) === gid);
      if (found) {
        if (giftDropdownSelected) giftDropdownSelected.textContent = found.name;
      } else {
        if (giftDropdownSelected)
          giftDropdownSelected.textContent =
            commandData.giftName || "Choose a gift...";
      }
    } else {
      if (giftDropdownSelected)
        giftDropdownSelected.textContent = "Choose a gift...";
    }

    document.getElementById("actionName").value =
      commandData.name || commandData.giftName || "";
    document.getElementById("targetUser").value =
      commandData.targetUser || "all";
    document.getElementById("keyword").value = commandData.keyword || "";
    document.getElementById("threshold").value =
      typeof commandData.threshold === "number" &&
      commandData.threshold !== null
        ? commandData.threshold
        : "";
    document.getElementById("command").value = decodeHtmlEntities(
      commandData.command || "",
    );
    document.getElementById("repeat").value = commandData.repeat || 1;
    document.getElementById("interval").value = commandData.interval || 100;
    document.getElementById("delayBefore").value = commandData.delayBefore || 0;

    if (commandData.audio) {
      const audioObj = globalAudios.find((a) => a.file === commandData.audio);
      if (audioObj) {
        document.getElementById("audioSelect").value = commandData.audio;
        document.querySelector("#audioDropdown .selected").textContent =
          audioObj.displayName || commandData.audio;
      } else {
        document.getElementById("audioSelect").value = "";
        document.querySelector("#audioDropdown .selected").textContent =
          "اختر صوت...";
      }
    } else {
      document.getElementById("audioSelect").value = "";
      document.querySelector("#audioDropdown .selected").textContent =
        "اختر صوت...";
    }

    document.getElementById("volume").value = commandData.volume || 100;
    document.getElementById("volumeValue").textContent =
      commandData.volume || 100;
    document.getElementById("video").value = commandData.video || "";
    document.getElementById("videoFileName").textContent = commandData.video
      ? commandData.video
      : "";
    document.getElementById("screen").value = commandData.screen || 1;
    document.getElementById("oncePerLive").checked = !!commandData.oncePerLive;
    document.getElementById("videoVolume").value =
      commandData.videoVolume || 100;
    document.getElementById("videoVolumeValue").textContent =
      commandData.videoVolume || 100;
    document.getElementById("videoInput").value = "";
    document.getElementById("audioUploadInput").value = "";

    const showOverlayCheck = document.getElementById("showOverlayCheckbox");
    const overlayTextInput = document.getElementById("overlayTextInput");
    const durationInput = document.getElementById("durationInput");
    const overlayTextGroup = document.getElementById("overlayTextGroup");

    if (showOverlayCheck) showOverlayCheck.checked = !!commandData.showOverlay;
    if (overlayTextInput)
      overlayTextInput.value = commandData.overlayText || "";
    if (durationInput) durationInput.value = commandData.duration || 5;
    if (overlayTextGroup) {
      overlayTextGroup.style.display =
        showOverlayCheck && showOverlayCheck.checked ? "block" : "none";
    }
  } else {
    editingId = null;
    editingType = null;
    typeSelect.value = "gift";
    updateInputsForType("gift");
    const actionSelectSpan = document.querySelector(
      "#addCard .custom-select.action-select .selected span",
    );
    if (actionSelectSpan) actionSelectSpan.textContent = "🎁 Gift";
    document.getElementById("actionType").value = "gift";
    giftSection.style.display = "block";
    document.getElementById("giftSelect").value = "";
    document.getElementById("giftName").value = "";
    document.getElementById("webhookUrl").value = "";
    document.getElementById("actionName").value = "";
    document.getElementById("targetUser").value = "all";
    document.getElementById("keyword").value = "";
    document.getElementById("threshold").value = "";
    document.getElementById("command").value = "";
    document.getElementById("repeat").value = 1;
    document.getElementById("interval").value = 100;
    document.getElementById("delayBefore").value = 0;
    document.getElementById("audioSelect").value = "";
    document.querySelector("#audioDropdown .selected").textContent =
      "اختر صوت...";
    document.getElementById("volume").value = 100;
    document.getElementById("volumeValue").textContent = 100;
    document.getElementById("video").value = "";
    document.getElementById("videoInput").value = "";
    document.getElementById("videoPreview").innerHTML = "";
    document.getElementById("videoFileName").textContent = "";
    document.getElementById("screen").value = 1;
    document.getElementById("oncePerLive").checked = false;
    document.getElementById("videoVolume").value = 100;
    document.getElementById("videoVolumeValue").textContent = 100;
    if (giftDropdownSelected)
      giftDropdownSelected.textContent = "Choose a gift...";

    const showOverlayCheck = document.getElementById("showOverlayCheckbox");
    const overlayTextInput = document.getElementById("overlayTextInput");
    const durationInput = document.getElementById("durationInput");
    const overlayTextGroup = document.getElementById("overlayTextGroup");

    if (showOverlayCheck) showOverlayCheck.checked = false;
    if (overlayTextInput) overlayTextInput.value = "";
    if (durationInput) durationInput.value = 5;
    if (overlayTextGroup) overlayTextGroup.style.display = "none";
  }

  updateClearShortcutButton();
  captureOriginalFormValues();

  setTimeout(() => {
    updateGiftDropdown();
  }, 200);
  setTimeout(() => {
    const searchInput = document.getElementById("giftSearchInput");
    if (searchInput) {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
    }
  }, 400);
}

function hideAddCard() {
  document.getElementById("cardOverlay").style.display = "none";
  document.getElementById("addCard").style.display = "none";
  document.getElementById("shortcutData").value = "";
  document.getElementById("shortcutDisplay").textContent = "لم يتم التعيين";
  updateClearShortcutButton();
  editingId = null;
  editingType = null;
}

async function confirmAdd(event) {
  if (event) event.preventDefault();

  const saveBtn = document.querySelector("#addCard .confirm-btn");
  if (!saveBtn) {
    showMessage("❌ خطأ: زر الحفظ غير موجود");
    return;
  }

  const actionName = document.getElementById("actionName").value.trim();
  if (!actionName) {
    showMessage("⚠️ يرجى إدخال اسم الإجراء");
    return;
  }

  const actionType = document.getElementById("actionType").value;
  const giftId = document.getElementById("giftSelect").value;
  const giftName = document.getElementById("giftName").value.trim();
  const webhookUrl = document.getElementById("webhookUrl").value.trim();
  const keyword = document.getElementById("keyword").value.trim();
  const threshold = parseInt(document.getElementById("threshold").value) || 0;
  const targetUser =
    document.getElementById("targetUser").value.trim() || "all";
  const commandText = document.getElementById("command").value;
  const repeat = parseInt(document.getElementById("repeat").value) || 1;
  const interval = parseInt(document.getElementById("interval").value) || 100;
  const delayBefore =
    parseInt(document.getElementById("delayBefore").value) || 0;
  // قفل الزر أثناء الحفظ حتى لا يتكرر إنشاء الأمر مع الضغط المتكرر
  if (saveInProgress) return;
  saveInProgress = true;
  const originalBtnHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.style.opacity = 0.6;
  saveBtn.style.pointerEvents = "none";
  saveBtn.innerHTML = "⏳ جاري الحفظ...";

  try {
    // انتظار أي رفع ملفات جارٍ قبل الحفظ حتى لا يضيع اسم الملف
    if (pendingUploads.audio || pendingUploads.video) {
      showMessage("⏳ انتظار انتهاء رفع الملفات قبل الحفظ...");
      const active = [pendingUploads.audio, pendingUploads.video].filter(
        Boolean,
      );
      await Promise.allSettled(active);
    }

    const audioFile =
      tempUploadedFiles.audio || document.getElementById("audioSelect").value;
    const videoFile =
      tempUploadedFiles.video || document.getElementById("video").value;
    const volume = parseInt(document.getElementById("volume").value) || 100;
    const videoVolume =
      parseInt(document.getElementById("videoVolume").value) || 100;
    const screen = parseInt(document.getElementById("screen").value) || 1;
    const oncePerLive = document.getElementById("oncePerLive").checked;
    const shortcutData = document.getElementById("shortcutData").value;
    const showOverlay = document.getElementById("showOverlayCheckbox").checked;
    const overlayText = document
      .getElementById("overlayTextInput")
      .value.trim();
    const duration =
      parseInt(document.getElementById("durationInput").value) || 5;

    const baseCommand = {
      name: actionName,
      command: commandText,
      webhookUrl: webhookUrl || undefined,
      repeat,
      interval,
      delayBefore,
      // نرسل "" عند الإزالة حتى يمسحها الـ backend فعلياً (undefined يتجاهلها)
      audio: audioFile || "",
      volume,
      video: videoFile || "",
      videoVolume,
      screen,
      targetUser,
      active: true,
      playSound: true,
      playVideo: true,
      oncePerLive,
      combo: shortcutData || undefined,
      showOverlay,
      overlayText,
      duration,
    };

    const profileId = getSelectedProfileId();
    if (profileId) baseCommand.profile = profileId;

    const isEditing = !!(editingId && editingType);
    const oldEditingId = editingId;
    const oldEditingType = editingType;

    // ✅ إذا كان التعديل وتغير النوع، نحذف القديم وننشئ جديداً
    const typeChanged =
      isEditing &&
      actionType !==
        (oldEditingType === "gift"
          ? "gift"
          : oldEditingType === "interaction"
            ? "interaction"
            : "gift");

    try {
      if (isEditing && typeChanged) {
        // 1️⃣ حذف الأمر القديم
        const deleteUrl =
          oldEditingType === "gift"
            ? `${GIFT_API}/${oldEditingId}`
            : `${INTERACT_API}/${oldEditingId}`;
        await fetchWithAuth(deleteUrl, { method: "DELETE" });

        // 2️⃣ إنشاء أمر جديد بالنوع الجديد
        let url, bodyData;
        if (actionType === "gift") {
          if (!giftId) {
            showMessage("⚠️ يرجى اختيار هدية");
            return;
          }
          url = GIFT_API;
          bodyData = { ...baseCommand, giftId, giftName };
        } else {
          url = INTERACT_API;
          bodyData = { ...baseCommand, type: actionType, keyword, threshold };
          if (actionType === "like") bodyData.threshold = threshold;
          if (actionType === "comment") bodyData.keyword = keyword;
        }

        const res = await fetchWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyData),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const details = errorData.message || `فشل الإضافة (${res.status})`;
          throw new Error(details);
        }
        showMessage("✅ تم تغيير نوع الأمر بنجاح");
      } else if (isEditing) {
        // تحديث عادي (نفس النوع)
        let url, bodyData;
        if (oldEditingType === "gift") {
          url = `${GIFT_API}/${oldEditingId}`;
          bodyData = { ...baseCommand, giftId, giftName };
        } else {
          url = `${INTERACT_API}/${oldEditingId}`;
          bodyData = { ...baseCommand, type: actionType, keyword, threshold };
          if (actionType === "like") bodyData.threshold = threshold;
          if (actionType === "comment") bodyData.keyword = keyword;
        }

        const res = await fetchWithAuth(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyData),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const details = errorData.message || `فشل التحديث (${res.status})`;
          throw new Error(details);
        }
        showMessage("✅ تم تحديث الأمر");
      } else {
        // إنشاء جديد
        let url, bodyData;
        if (actionType === "gift") {
          if (!giftId) {
            showMessage("⚠️ يرجى اختيار هدية");
            return;
          }
          url = GIFT_API;
          bodyData = { ...baseCommand, giftId, giftName };
        } else {
          url = INTERACT_API;
          bodyData = { ...baseCommand, type: actionType, keyword, threshold };
          if (actionType === "like") bodyData.threshold = threshold;
          if (actionType === "comment") bodyData.keyword = keyword;
        }

        const res = await fetchWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyData),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const details = errorData.message || `فشل الإضافة (${res.status})`;
          throw new Error(details);
        }
        showMessage("✅ تم إضافة الأمر");
        document.getElementById("shortcutData").value = "";
        document.getElementById("shortcutDisplay").textContent =
          "لم يتم التعيين";
        currentShortcutCombo = "";
      }

      // ✅ الإغلاق بعد نجاح الحفظ فقط — عند الخطأ يبقى الكارت مفتوحاً
      hideAddCard();
      tempUploadedFiles.audio = null;
      tempUploadedFiles.video = null;
      await loadCommands();
    } catch (err) {
      console.error(err);
      showMessage("❌ خطأ أثناء الحفظ: " + err.message);
      await loadCommands();
    }
  } finally {
    saveInProgress = false;
    saveBtn.disabled = false;
    saveBtn.style.opacity = "";
    saveBtn.style.pointerEvents = "";
    saveBtn.innerHTML = originalBtnHtml;
  }
}

async function loadCommands(profileIdParam = null, noCache = false) {
  try {
    // إلغاء المؤقتات القديمة
    for (const [id, timer] of autoSaveTimers) {
      clearTimeout(timer);
    }
    autoSaveTimers.clear();

    const profileId = currentUserSelectedProfile;
    const profileQuery = profileId ? `?profile=${profileId}` : "";
    const fetchOptions = noCache ? { cache: "no-store" } : {};

    const [gRes, iRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}${profileQuery}`, fetchOptions).then((r) =>
        r.json(),
      ),
      fetchWithAuth(`${INTERACT_API}${profileQuery}`, fetchOptions).then((r) =>
        r.json(),
      ),
    ]);

    const giftList = gRes && gRes.gifts ? gRes.gifts : [];
    const interactList =
      iRes && (iRes.list || iRes.commands) ? iRes.list || iRes.commands : [];

    let merged = [
      ...giftList.map((g) => ({ ...g, __type: "gift" })),
      ...interactList.map((ic) => ({ ...ic, __type: "interaction" })),
    ];

    merged.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 0;
      const orderB = b.order !== undefined ? b.order : 0;
      return orderA - orderB;
    });

    window.currentCommandsList = merged;

    const totalCommands = merged.length;
    let disabledCommandsSet = new Set();
    const warningDiv = document.getElementById("commandLimitWarning");
    const addBtn = document.querySelector(".add-btn");

    if (currentUserPlan === "free") {
      if (totalCommands >= 7) {
        warningDiv.style.display = "block";
        addBtn.disabled = true;
        addBtn.style.opacity = 0.5;
        addBtn.style.pointerEvents = "none";
        const disabledCommands = merged.slice(7);
        disabledCommands.forEach((cmd) => disabledCommandsSet.add(cmd._id));
      } else {
        warningDiv.style.display = "none";
        addBtn.disabled = false;
        addBtn.style.opacity = 1;
        addBtn.style.pointerEvents = "auto";
      }
    } else {
      warningDiv.style.display = "none";
      addBtn.disabled = false;
      addBtn.style.opacity = 1;
      addBtn.style.pointerEvents = "auto";
    }

    const tbody = document.getElementById("commandsTable");
    tbody.innerHTML = "";

    merged.forEach((cmd) => {
      cmd.type = cmd.type || (cmd.__type === "gift" ? "gift" : "comment");
      const tr = document.createElement("tr");
      tr.dataset.id = cmd._id || "";
      tr.dataset.type = cmd.__type === "gift" ? "gift" : "interaction";
      tr.dataset.giftId = cmd.giftId || "";
      tr.dataset.giftName = cmd.name || cmd.giftName || "";
      tr.dataset.order = cmd.order || 0;
      const actionKind =
        cmd.type || (cmd.__type === "gift" ? "gift" : "comment");
      tr.dataset.actionKind = actionKind;
      const isActiveChecked = cmd.active !== false ? "checked" : "";
      const playSoundVal =
        typeof cmd.playSound !== "undefined"
          ? cmd.playSound
          : typeof cmd.enableAudio !== "undefined"
            ? cmd.enableAudio
            : true;
      const playVideoVal =
        typeof cmd.playVideo !== "undefined"
          ? cmd.playVideo
          : typeof cmd.enableVideo !== "undefined"
            ? cmd.enableVideo
            : true;
      const playSoundChecked = playSoundVal ? "checked" : "";
      const playVideoChecked = playVideoVal ? "checked" : "";
      const audioValue = cmd.audio ? cmd.audio : "";
      const videoValue = cmd.video ? cmd.video : "";
      let displayName = cmd.name || cmd.giftName || "";
      const isDisabled = disabledCommandsSet.has(cmd._id);
      let giftCellContent = "";

      if (cmd.__type === "gift") {
        const rawImgUrl = getGiftImage(cmd.giftId);
        const safeImg = safeImageUrl(rawImgUrl);
        const safeTitle = escapeHtml(cmd.giftName || cmd.name || "");
        giftCellContent = `<img src="${safeImg}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${safeTitle}">`;
      } else {
        let iconFile = "";
        const actionType = cmd.type || "";
        switch (actionType) {
          case "like":
            iconFile = "like.png";
            break;
          case "follow":
            iconFile = "follow.png";
            break;
          case "share":
            iconFile = "share.png";
            break;
          case "comment":
            iconFile = "comment.png";
            break;
          default:
            iconFile = "default.png";
        }
        giftCellContent = `<img src="images/${iconFile}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${escapeHtml(actionType)}">`;
      }

      let commandCellContent = "";
      const hasCommand = cmd.command && cmd.command.trim() !== "";
      const hasWebhook = cmd.webhookUrl && cmd.webhookUrl.trim() !== "";
      const hasCombo = cmd.combo && cmd.combo.trim() !== "";

      if (hasCommand) {
        const safeCommand = escapeHtml(decodeHtmlEntities(cmd.command), true);
        commandCellContent = `<textarea class="input-like-textarea" data-field="command" rows="1" placeholder="/Command (ضع أمرًا في كل سطر)" ${isDisabled ? "disabled" : ""}>${safeCommand}</textarea>`;
      } else if (hasWebhook) {
        const safeWebhook = escapeHtml(decodeHtmlEntities(cmd.webhookUrl));
        commandCellContent = `<div style="font-size:12px; color:#1dd9e6e1; word-break:break-all;">🔗 ${safeWebhook}</div>`;
      } else if (hasCombo) {
        const safeCombo = escapeHtml(decodeHtmlEntities(cmd.combo));
        commandCellContent = `<div style="font-size:12px; color:#ff9800;">⌨️ ${safeCombo}</div>`;
      } else {
        commandCellContent = `<div style="font-size:12px; color:#888;">—</div>`;
      }

      const safeName = escapeHtml(displayName);
      const safeAudio = escapeHtml(audioValue);
      const safeVideo = escapeHtml(videoValue);

      // ===== بناء الصف مع الحقول الجديدة =====
      tr.innerHTML = `
        <td class="drag-handle" style="text-align: center; width: 50px; vertical-align: middle; padding: 2px 10px;">
          <div style="display: flex; flex-direction: row; align-items: center; gap: 6px; justify-content: center; direction: ltr;">
            <button class="move-btn" onclick="moveRowUp(this.closest('tr'))" title="نقل لأعلى" 
              style="background: linear-gradient(145deg, #2a2a2a, #1a1a1a); border: none; border-radius: 8px; color: #1dd9e6e1; cursor: pointer; font-size: 14px; width: 31px; height: 31px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05); transition: all 0.2s ease;">
              <i class="fas fa-chevron-up"></i>
            </button>
            <span class="drag-icon" 
              style="cursor: grab; font-size: 14px; line-height: 1; user-select: none; background: linear-gradient(145deg, #2a2a2a, #1a1a1a); border: none; border-radius: 8px; padding: 8px 6px; color: #888; box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);">
              <i class="fas fa-grip-vertical"></i>
            </span>
            <button class="move-btn" onclick="moveRowDown(this.closest('tr'))" title="نقل لأسفل" 
              style="background: linear-gradient(145deg, #2a2a2a, #1a1a1a); border: none; border-radius: 8px; color: #ff9800; cursor: pointer; font-size: 14px; width: 31px; height: 31px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05); transition: all 0.2s ease;">
              <i class="fas fa-chevron-down"></i>
            </button>
          </div>
        </td>
        <td style="vertical-align: middle; text-align: center;">
          <input type="checkbox" class="active-checkbox" data-field="active" ${isActiveChecked} ${isDisabled ? "disabled" : ""} style="margin: 0;">
        </td>
        <td class="options" style="white-space: nowrap;">
          <button class="delete-btn" type="button" ${isDisabled ? "disabled" : ""} style="background: none; border: none; cursor: pointer; color: #f44336; font-size: 18px; display: inline-block; margin: 0 2px;"><i class="fas fa-trash-alt"></i></button>
          <button class="edit-btn" type="button" ${isDisabled ? "disabled" : ""} style="background: none; border: none; cursor: pointer; color: #1dd9e6e1; font-size: 18px; display: inline-block; margin: 0 2px;"><i class="fas fa-edit"></i></button>
          <button class="execute-btn" type="button" ${isDisabled ? "disabled" : ""} style="background: none; border: none; cursor: pointer; color: #2196f3; font-size: 18px; display: inline-block; margin: 0 2px;"><i class="fas fa-play"></i></button>
        </td>
        <td><input type="text" value="${safeName}" data-field="name" ${isDisabled ? "disabled" : ""}></td>
        <td style="text-align: center; vertical-align: middle;">${commandCellContent}</td>
        <td><input type="number" value="${cmd.screen || 1}" data-field="screen" ${isDisabled ? "disabled" : ""}></td>
        <td><input type="number" value="${cmd.repeat || 1}" data-field="repeat" ${isDisabled ? "disabled" : ""}></td>
        <td><input type="number" value="${cmd.interval || 500}" data-field="interval" ${isDisabled ? "disabled" : ""}></td>
        <td><input type="number" value="${cmd.delayBefore || 0}" data-field="delayBefore" ${isDisabled ? "disabled" : ""}></td>
        <td>
          <input type="hidden" data-field="audio" value="${safeAudio}">
          <input type="checkbox" class="play-sound-checkbox" data-field="playSound" ${playSoundChecked} ${isDisabled ? "disabled" : ""}>
        </td>
        <td>
          <input type="hidden" data-field="video" value="${safeVideo}">
          <input type="checkbox" class="video-checkbox" data-field="playVideo" ${playVideoChecked} ${isDisabled ? "disabled" : ""}>
        </td>
        <td class="fathertd">
          <input type="range" min="0" max="100" step="1" value="${cmd.volume || 100}" data-field="volume" oninput="this.nextElementSibling.textContent = this.value" style="width:100px;" ${isDisabled ? "disabled" : ""}>
          <span class="numvolume">${cmd.volume || 100}</span>
        </td>
        <td class="fathertd">
          <input type="range" min="0" max="100" step="1" value="${cmd.videoVolume || 100}" data-field="videoVolume" oninput="this.nextElementSibling.textContent = this.value" style="width:100px;" ${isDisabled ? "disabled" : ""}>
          <span class="numvolume">${cmd.videoVolume || 100}</span>
        </td>
        <td class="gift-cell" style="text-align:center;">${giftCellContent}</td>
`;

      if (isDisabled) tr.classList.add("disabled-row");
      tbody.appendChild(tr);

      // ربط الأحداث للأزرار والحقول
      if (!isDisabled) {
        tr.querySelector(".edit-btn").addEventListener("click", () =>
          showAddCard(cmd),
        );
        tr.querySelector(".execute-btn").addEventListener("click", () =>
          executeCommand(cmd._id, tr.dataset.type),
        );
        tr.querySelector(".delete-btn").addEventListener("click", () =>
          deleteCommand(cmd._id, tr.dataset.type),
        );

        const rowInputs = tr.querySelectorAll(
          "input[data-field], textarea[data-field], select[data-field]",
        );
        rowInputs.forEach((inp) => {
          if (inp.type === "checkbox") {
            inp.addEventListener("change", () => {
              const id = tr.dataset.id;
              if (id && autoSaveTimers.has(id)) {
                clearTimeout(autoSaveTimers.get(id));
                autoSaveTimers.delete(id);
              }
              saveRowFromTr(tr);
            });
          } else {
            inp.addEventListener("input", () => scheduleAutoSave(tr));
            inp.addEventListener("blur", () => {
              const id = tr.dataset.id;
              if (id && autoSaveTimers.has(id)) {
                clearTimeout(autoSaveTimers.get(id));
                autoSaveTimers.delete(id);
              }
              saveRowFromTr(tr);
            });
          }
        });
      }
    });

    enableDragAndDrop();
    loadHotkeyCommands();
    applyHotkeySettings();
    renderHotkeysList();
  } catch (err) {
    console.error("خطأ في تحميل الأوامر:", err);
  }
}
window.loadCommands = loadCommands;

function scheduleAutoSave(tr) {
  const id = tr.dataset.id;
  if (!id) return;
  if (autoSaveTimers.has(id)) clearTimeout(autoSaveTimers.get(id));
  const t = setTimeout(() => {
    autoSaveTimers.delete(id);
    saveRowFromTr(tr);
  }, 800);
  autoSaveTimers.set(id, t);
}

async function saveRowFromTr(tr) {
  const id = tr.dataset.id;
  const rowType = tr.dataset.type;
  if (!id) return showMessage("⚠️ لا يمكن حفظ أمر بدون ID");
  const inputs = tr.querySelectorAll(
    "input[data-field], textarea[data-field], select[data-field]",
  );
  const body = {};
  inputs.forEach((inp) => {
    const field = inp.dataset.field;
    if (!field) return;
    if (inp.type === "checkbox") body[field] = !!inp.checked;
    else if (inp.type === "range" || inp.type === "number") {
      if (field === "threshold" || field === "duration") {
        body[field] = parseInt(inp.value, 10) || 0;
      } else {
        body[field] = parseInt(inp.value, 10) || 0;
      }
    } else if (field === "combo") {
      body[field] = inp.value.trim() || null;
    } else if (field === "command" || field === "webhookUrl") {
      // فك تشفير أي entities متبقية قبل الحفظ لتنظيف البيانات القديمة
      body[field] = decodeHtmlEntities(inp.value);
    } else {
      body[field] = inp.value;
    }
  });
  // التأكد من الحقول الأساسية
  body.giftId = tr.dataset.giftId || body.giftId || null;
  body.giftName = tr.dataset.giftName || body.giftName || "Unknown Gift";
  if (
    typeof body.type === "undefined" ||
    body.type === "" ||
    body.type === null
  ) {
    body.type =
      tr.dataset.actionKind || (rowType === "gift" ? "gift" : "comment");
  }
  if (!body.name || String(body.name).trim() === "") {
    showMessage("⚠️ لازم تحط اسم للأمر قبل الحفظ");
    return;
  }
  const profileId = getSelectedProfileId();
  if (profileId) body.profile = profileId;

  try {
    if (rowType === "gift") {
      await fetchWithAuth(`${GIFT_API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetchWithAuth(`${INTERACT_API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    showMessage("✅ تم الحفظ تلقائيًا");
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ أثناء الحفظ");
  }
}

async function moveRowUp(tr) {
  const prev = tr.previousElementSibling;
  if (!prev) {
    showMessage("⚠️ هذا الأمر في الأعلى بالفعل");
    return;
  }
  const tbody = tr.parentElement;
  tbody.insertBefore(tr, prev);
  const rows = Array.from(tbody.querySelectorAll("tr"));
  rows.forEach((row, index) => {
    row.dataset.order = index;
  });
  const orderedIds = rows
    .map((r) => r.dataset.id)
    .filter((id) => id && id !== "");
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/commands/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    if (!data.success) {
      showMessage("❌ فشل حفظ الترتيب، جاري استعادة الحالة السابقة");
      await loadCommands();
    } else {
      showMessage("✅ تم نقل الأمر لأعلى");
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال، جاري استعادة الحالة السابقة");
    await loadCommands();
  }
}

async function moveRowDown(tr) {
  const next = tr.nextElementSibling;
  if (!next) {
    showMessage("⚠️ هذا الأمر في الأسفل بالفعل");
    return;
  }
  const tbody = tr.parentElement;
  tbody.insertBefore(next, tr);
  const rows = Array.from(tbody.querySelectorAll("tr"));
  rows.forEach((row, index) => {
    row.dataset.order = index;
  });
  const orderedIds = rows
    .map((r) => r.dataset.id)
    .filter((id) => id && id !== "");
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/commands/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    if (!data.success) {
      showMessage("❌ فشل حفظ الترتيب، جاري استعادة الحالة السابقة");
      await loadCommands();
    } else {
      showMessage("✅ تم نقل الأمر لأسفل");
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال، جاري استعادة الحالة السابقة");
    await loadCommands();
  }
}

async function executeCommand(id, rowType) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (!tr) return showMessage("⚠️ لم يتم العثور على السطر");
  const activeCheckbox = tr.querySelector(".active-checkbox");
  const isActive = !!(activeCheckbox && activeCheckbox.checked);
  if (!isActive) return showMessage("⚠️ الأمر متوقف لأنه غير مفعل");

  showMessage("⚡ جاري تنفيذ الأمر...");

  const audioFile =
    tr.querySelector('input[data-field="audio"]')?.value || null;
  const videoFile =
    tr.querySelector('input[data-field="video"]')?.value || null;
  const volume = parseInt(
    tr.querySelector('input[data-field="volume"]')?.value || 100,
  );
  const videoVolume = parseInt(
    tr.querySelector('input[data-field="videoVolume"]')?.value || 100,
  );
  const screen = parseInt(
    tr.querySelector('input[data-field="screen"]')?.value || 1,
  );
  const soundCheckbox = tr.querySelector(".play-sound-checkbox");
  const videoCheckbox = tr.querySelector(".video-checkbox");
  const enableAudio = !!(soundCheckbox && soundCheckbox.checked);
  const enableVideo = !!(videoCheckbox && videoCheckbox.checked);

  try {
    const apiUrl =
      rowType === "gift" ? `${GIFT_API}/${id}` : `${INTERACT_API}/${id}`;
    await fetchWithAuth(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        active: isActive,
        playSound: enableAudio,
        playVideo: enableVideo,
        audio: audioFile,
        video: videoFile,
        volume,
        videoVolume,
        screen,
      }),
    });
  } catch (err) {
    console.warn("فشل تحديث إعدادات الأمر:", err.message);
  }

  try {
    const execUrl =
      rowType === "gift"
        ? `${GIFT_API}/${id}/execute`
        : `${INTERACT_API}/${id}/execute`;
    const execRes = await fetchWithAuth(execUrl, { method: "POST" });
    if (execRes.ok) {
      showMessage("✅ تم تنفيذ الأمر بنجاح");
    } else {
      showMessage("❌ فشل تنفيذ الأمر — راجع الكونسول");
    }
  } catch (err) {
    console.error("خطأ أثناء تنفيذ الأمر:", err);
    showMessage("❌ خطأ أثناء تنفيذ الأمر");
  }
}

async function deleteCommand(id, rowType) {
  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا الأمر؟",
    "حذف الأمر",
  );
  if (!confirmed) return;
  if (!id) {
    showMessage("⚠️ معرف الأمر غير صالح");
    return;
  }

  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    tr.remove();
    showMessage("🗑 تم حذف الأمر محلياً، جاري المزامنة مع الخادم...");
  }
  if (autoSaveTimers.has(id)) {
    clearTimeout(autoSaveTimers.get(id));
    autoSaveTimers.delete(id);
  }

  try {
    let audioFile = null;
    let videoFile = null;
    const url =
      rowType === "gift" ? `${GIFT_API}/${id}` : `${INTERACT_API}/${id}`;

    try {
      const res = await fetchWithAuth(url);
      if (res.ok) {
        const json = await res.json();
        const commandData =
          rowType === "gift" ? json.gift : json.command || json;
        if (commandData) {
          audioFile = commandData.audio;
          videoFile = commandData.video;
        }
      }
    } catch (fetchErr) {
      console.warn("⚠️ فشل جلب بيانات الأمر:", fetchErr.message);
    }

    if (videoFile) {
      try {
        await fetchWithAuth(
          `${API_BASE}/api/video/${encodeURIComponent(videoFile)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.warn("فشل حذف الفيديو:", err.message);
      }
    }
    if (audioFile) {
      try {
        await fetchWithAuth(
          `${API_BASE}/api/audio/${encodeURIComponent(audioFile)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.warn("فشل حذف الصوت:", err.message);
      }
    }

    const deleteRes = await fetchWithAuth(url, { method: "DELETE" });
    if (deleteRes.ok) {
      showMessage("✅ تم حذف الأمر نهائياً");
    } else if (deleteRes.status === 404) {
      showMessage("🗑 الأمر غير موجود بالفعل (تم حذفه محلياً)");
    } else {
      showMessage("⚠️ فشل حذف الأمر من الخادم، لكن تم حذفه محلياً");
    }
    await checkStorageNotifications();
  } catch (err) {
    console.error("❌ خطأ أثناء حذف الأمر:", err);
    showMessage("❌ خطأ أثناء حذف الأمر: " + err.message);
    await loadCommands(true);
  }
}

function enableDragAndDrop() {
  const tbody = document.getElementById("commandsTable");
  if (!tbody) return;
  if (tbody._sortable) {
    tbody._sortable.destroy();
  }
  tbody._sortable = new Sortable(tbody, {
    animation: 150,
    handle: ".drag-icon",
    scroll: true,
    scrollSensitivity: 30,
    scrollSpeed: 10,
    bubbleScroll: true,
    onEnd: async function (evt) {
      const rows = Array.from(tbody.querySelectorAll("tr"));
      rows.forEach((row, index) => {
        row.dataset.order = index;
      });
      const orderedIds = rows
        .map((r) => r.dataset.id)
        .filter((id) => id && id !== "");
      if (orderedIds.length === 0) return;
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/commands/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage("✅ تم حفظ الترتيب الجديد");
        } else {
          showMessage("❌ فشل حفظ الترتيب، جاري الاستعادة");
          await loadCommands();
        }
      } catch (err) {
        console.error(err);
        showMessage("❌ خطأ في الاتصال، جاري الاستعادة");
        await loadCommands();
      }
    },
  });
}

// ============================================================
// دوال التصدير والاستيراد
// ============================================================
function buildCommandSelectionTable(commands, defaultChecked = true) {
  window.currentCommandsList = commands;
  const tbody = document.getElementById("commandSelectionTableBody");
  tbody.innerHTML = "";
  const selectAll = document.getElementById("select-all-commands");
  selectAll.checked = defaultChecked;

  commands.forEach((cmd, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const tdSelect = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "command-checkbox";
    checkbox.dataset.index = index;
    checkbox.checked = defaultChecked;
    tdSelect.appendChild(checkbox);
    tr.appendChild(tdSelect);

    const tdName = document.createElement("td");
    tdName.style.textAlign = "right";
    tdName.textContent = cmd.name || cmd.giftName || "بدون اسم";
    if (cmd.combo) {
      const span = document.createElement("span");
      span.style.color = "#ff9800";
      span.style.fontSize = "12px";
      span.textContent = ` ⌨️ ${cmd.combo}`;
      tdName.appendChild(span);
    }
    tr.appendChild(tdName);

    const tdCommand = document.createElement("td");
    tdCommand.style.textAlign = "right";
    const div = document.createElement("div");
    div.style.maxWidth = "250px";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.textContent = cmd.command || "";
    tdCommand.appendChild(div);
    if (cmd.webhookUrl) {
      const small = document.createElement("small");
      small.style.color = "#1dd9e6e1";
      small.textContent = ` 🔗 ${cmd.webhookUrl}`;
      tdCommand.appendChild(small);
    }
    tr.appendChild(tdCommand);

    const tdScreen = document.createElement("td");
    tdScreen.textContent = cmd.screen || 1;
    tr.appendChild(tdScreen);

    const tdRepeat = document.createElement("td");
    tdRepeat.textContent = cmd.repeat || 1;
    tr.appendChild(tdRepeat);

    const tdInterval = document.createElement("td");
    tdInterval.textContent = cmd.interval || 500;
    tr.appendChild(tdInterval);

    const tdDelay = document.createElement("td");
    tdDelay.textContent = cmd.delayBefore || 0;
    tr.appendChild(tdDelay);

    const tdSound = document.createElement("td");
    tdSound.textContent = cmd.audio ? "🎵" : "";
    tr.appendChild(tdSound);

    const tdVideo = document.createElement("td");
    tdVideo.textContent = cmd.video ? "🎬" : "";
    tr.appendChild(tdVideo);

    const tdVideoVol = document.createElement("td");
    tdVideoVol.textContent = cmd.videoVolume || 100;
    tr.appendChild(tdVideoVol);

    tbody.appendChild(tr);
  });
}

function buildDuplicateTable(commands) {
  const tbody = document.getElementById("duplicateTableBody");
  tbody.innerHTML = "";

  commands.forEach((cmd, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const tdReplace = document.createElement("td");
    const replaceCheck = document.createElement("input");
    replaceCheck.type = "checkbox";
    replaceCheck.className = "duplicate-replace-checkbox";
    replaceCheck.dataset.index = index;
    replaceCheck.checked = true;
    tdReplace.appendChild(replaceCheck);
    tr.appendChild(tdReplace);

    const tdName = document.createElement("td");
    tdName.textContent = cmd.name || cmd.giftName || "بدون اسم";
    tr.appendChild(tdName);

    const tdCommand = document.createElement("td");
    tdCommand.style.textAlign = "right";
    const div = document.createElement("div");
    div.style.maxWidth = "250px";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.textContent = cmd.command || "";
    tdCommand.appendChild(div);
    if (cmd.webhookUrl) {
      const small = document.createElement("small");
      small.style.color = "#1dd9e6e1";
      small.textContent = ` 🔗 ${cmd.webhookUrl}`;
      tdCommand.appendChild(small);
    }
    tr.appendChild(tdCommand);

    const tdScreen = document.createElement("td");
    tdScreen.textContent = cmd.screen || 1;
    tr.appendChild(tdScreen);

    const tdRepeat = document.createElement("td");
    tdRepeat.textContent = cmd.repeat || 1;
    tr.appendChild(tdRepeat);

    const tdInterval = document.createElement("td");
    tdInterval.textContent = cmd.interval || 500;
    tr.appendChild(tdInterval);

    const tdDelay = document.createElement("td");
    tdDelay.textContent = cmd.delayBefore || 0;
    tr.appendChild(tdDelay);

    const tdSound = document.createElement("td");
    tdSound.textContent = cmd.audio ? "🎵" : "";
    tr.appendChild(tdSound);

    const tdVideo = document.createElement("td");
    tdVideo.textContent = cmd.video ? "🎬" : "";
    tr.appendChild(tdVideo);

    const tdVideoVol = document.createElement("td");
    tdVideoVol.textContent = cmd.videoVolume || 100;
    tr.appendChild(tdVideoVol);

    tbody.appendChild(tr);
  });
}

async function refreshExistingCommands() {
  const profileId = getSelectedProfileId();
  if (!profileId) return;
  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}?profile=${profileId}`),
      fetchWithAuth(`${INTERACT_API}?profile=${profileId}`),
    ]);
    const giftsData = await giftsRes.json();
    const interactData = await interactRes.json();
    const giftList = giftsData.gifts || [];
    const interactList = interactData.list || [];

    const newMap = new Map();
    giftList.forEach((g) => {
      if (g.giftId) newMap.set(`gift_${g.giftId}`, true);
    });
    interactList.forEach((cmd) => {
      let key = `interact_${cmd.type}`;
      if (cmd.type === "comment") key += `_${cmd.keyword || ""}`;
      else if (cmd.type === "like") key += `_${cmd.threshold || 0}`;
      else key += `_${cmd.keyword || ""}`;
      newMap.set(key, true);
    });
    existingCommandsMap = newMap;
  } catch (err) {
    console.warn("فشل تحميل قائمة الأوامر الموجودة", err);
  }
}

// ============================================================
// جدول اختصارات البروفايل في مودال الأوامر (نسخ/اضافة البروفايل)
// ============================================================
async function loadCurrentProfileHotkeys() {
  const profileId = getSelectedProfileId();
  if (!profileId) {
    currentProfileHotkeys = [];
    return;
  }
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey?profile=${profileId}`,
    );
    const data = await res.json();
    currentProfileHotkeys = data.success && data.hotkeys ? data.hotkeys : [];
  } catch (err) {
    console.warn("فشل تحميل اختصارات البروفايل", err);
    currentProfileHotkeys = [];
  }
}

// وصف الأمر المرتبط بالاختصار حسب مصدره (قاعدة البيانات أو ملف .tfc)
function describeHotkeyCommand(hk) {
  if (hk.__fromFile) {
    const ref = hk.ref || {};
    if (hk.commandType === "gift")
      return `هدية #${ref.giftId ?? ""} ${ref.name || ""}`.trim();
    const parts = [ref.type || "تفاعل"];
    if (ref.keyword) parts.push(`كلمة: ${ref.keyword}`);
    if (ref.threshold) parts.push(`عدد: ${ref.threshold}`);
    if (ref.combo) parts.push(`⌨️ ${ref.combo}`);
    return parts.join(" - ");
  }
  const cmd = (window.currentCommandsList || []).find(
    (c) => c._id && String(c._id) === String(hk.commandId),
  );
  return cmd ? cmd.name || cmd.giftName || "بدون اسم" : "أمر محذوف";
}

function buildHotkeySelectionTable(hotkeys, mode) {
  const area = document.getElementById("hotkeysSelectionArea");
  const tbody = document.getElementById("hotkeysSelectionTbody");
  if (!area || !tbody) return;
  tbody.innerHTML = "";

  if (!hotkeys || hotkeys.length === 0) {
    area.style.display = "none";
    return;
  }

  const existingKeys = new Set(currentProfileHotkeys.map((h) => h.key));

  hotkeys.forEach((hk, index) => {
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "hotkey-checkbox";
    check.dataset.index = index;
    check.checked = true;
    tdCheck.appendChild(check);
    tr.appendChild(tdCheck);

    const tdKey = document.createElement("td");
    tdKey.style.color = "#ff9800";
    tdKey.textContent = hk.key || "";
    tr.appendChild(tdKey);

    const tdCmd = document.createElement("td");
    tdCmd.style.textAlign = "right";
    const div = document.createElement("div");
    div.style.maxWidth = "250px";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.textContent = describeHotkeyCommand(hk);
    tdCmd.appendChild(div);
    tr.appendChild(tdCmd);

    const tdType = document.createElement("td");
    tdType.textContent = hk.commandType === "gift" ? "هدية" : "تفاعل";
    tr.appendChild(tdType);

    const tdStatus = document.createElement("td");
    if (mode === "import" && existingKeys.has(hk.key)) {
      const badge = document.createElement("span");
      badge.style.color = "#ff9800";
      badge.textContent = "مكرر — سيُستبدل";
      tdStatus.appendChild(badge);
    } else {
      tdStatus.textContent = hk.active === false ? "متوقف" : "نشط";
    }
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });

  document.getElementById("select-all-hotkeys").checked = true;
  area.style.display = "block";
}

function setupHotkeySelectAll() {
  const selectAll = document.getElementById("select-all-hotkeys");
  if (!selectAll) return;
  selectAll.onchange = function () {
    document
      .querySelectorAll("#hotkeysSelectionTbody .hotkey-checkbox")
      .forEach((cb) => (cb.checked = this.checked));
  };
}

function hideHotkeysSelectionArea() {
  const area = document.getElementById("hotkeysSelectionArea");
  if (area) area.style.display = "none";
}

async function showExportModal() {
  currentCommandModalMode = "export";
  document.getElementById("copyTargetWrap").style.display = "none";
  document.getElementById("select-all-label").textContent = "تحديد الكل";
  document.getElementById("commandModalTitle").textContent = "تصدير الأوامر";
  document.getElementById("confirmCommandAction").textContent = "تحميل";
  document.getElementById("duplicateCommandsArea").style.display = "none";
  hideHotkeysSelectionArea();

  const profileId = getSelectedProfileId();
  if (!profileId) {
    showMessage("⚠️ اختر بروفايل أولاً");
    return;
  }
  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}?profile=${profileId}`).then((r) => r.json()),
      fetchWithAuth(`${INTERACT_API}?profile=${profileId}`).then((r) =>
        r.json(),
      ),
    ]);
    const giftCommands = giftsRes.gifts || [];
    const interactCommands = interactRes.list || [];
    const allCommands = [
      ...giftCommands.map((c) => ({ ...c, __type: "gift" })),
      ...interactCommands.map((c) => ({ ...c, __type: "interaction" })),
    ];
    buildCommandSelectionTable(allCommands, true);

    const selectAll = document.getElementById("select-all-commands");
    selectAll.onchange = function () {
      document
        .querySelectorAll("#commandSelectionTableBody .command-checkbox")
        .forEach((cb) => (cb.checked = this.checked));
    };

    document.getElementById("commandSelectionModal").style.display = "flex";
  } catch (err) {
    console.error(err);
    showMessage("❌ فشل تحميل الأوامر");
  }
}

async function showImportModal() {
  currentCommandModalMode = "import";
  document.getElementById("copyTargetWrap").style.display = "none";
  document.getElementById("select-all-label").textContent = "استبدال الكل";
  document.getElementById("commandModalTitle").textContent = "استيراد الأوامر";
  document.getElementById("confirmCommandAction").textContent = "إضافة";
  document.getElementById("duplicateCommandsArea").style.display = "none";
  document.getElementById("duplicateTableBody").innerHTML = "";
  hideHotkeysSelectionArea();

  await refreshExistingCommands();
  await loadCurrentProfileHotkeys();

  nonDuplicateCommands = [];
  duplicateCommands = [];

  for (const cmd of importedCommands) {
    let isDuplicate = false;
    if (cmd.giftId !== undefined && cmd.giftId !== null) {
      isDuplicate = existingCommandsMap.has(`gift_${cmd.giftId}`);
    } else {
      let key = `interact_${cmd.type}`;
      if (cmd.type === "comment") key += `_${cmd.keyword || ""}`;
      else if (cmd.type === "like") key += `_${cmd.threshold || 0}`;
      else key += `_${cmd.keyword || ""}`;
      isDuplicate = existingCommandsMap.has(key);
    }
    if (isDuplicate) {
      duplicateCommands.push(cmd);
    } else {
      nonDuplicateCommands.push(cmd);
    }
  }

  buildCommandSelectionTable(nonDuplicateCommands, true);

  if (duplicateCommands.length > 0) {
    document.getElementById("duplicateCommandsArea").style.display = "block";
    buildDuplicateTable(duplicateCommands);
  }

  // جدول اختصارات الملف
  document.getElementById("hotkeysAreaTitle").textContent =
    "اختصارات الملف — حدد ما تريد استيراده";
  document.getElementById("select-all-hotkeys-label").textContent =
    "تحديد الكل";
  buildHotkeySelectionTable(
    importedHotkeys.map((h) => ({ ...h, __fromFile: true })),
    "import",
  );
  setupHotkeySelectAll();

  const selectAll = document.getElementById("select-all-commands");
  selectAll.onchange = null;
  selectAll.onchange = function () {
    document
      .querySelectorAll(".duplicate-replace-checkbox")
      .forEach((cb) => (cb.checked = this.checked));
  };

  document.querySelectorAll(".duplicate-replace-checkbox").forEach((cb) => {
    cb.addEventListener("change", function () {
      const all = document.querySelectorAll(".duplicate-replace-checkbox");
      const checked = document.querySelectorAll(
        ".duplicate-replace-checkbox:checked",
      );
      selectAll.checked = all.length === checked.length;
    });
  });

  let isSharedExport = false;
  for (const cmd of importedCommands) {
    if (
      (cmd.audio &&
        (cmd.audio.startsWith("http://") ||
          cmd.audio.startsWith("https://"))) ||
      (cmd.video &&
        (cmd.video.startsWith("http://") || cmd.video.startsWith("https://")))
    ) {
      isSharedExport = true;
      break;
    }
  }
  window.isSharedExport = isSharedExport;

  document.getElementById("commandSelectionModal").style.display = "flex";
}

async function downloadJSON(jsonStr, defaultFilename) {
  // حفظ واحد فقط عبر رابط Blob - showSaveFilePicker كان يسبب إنشاء ملف فارغ
  // ثم إعادة الحفظ مرة ثانية في Electron
  fallbackDownload(jsonStr, defaultFilename);
}

function fallbackDownload(jsonStr, filename) {
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMessage("✅ تم التحميل إلى مجلد التنزيلات");
}

// --- نسخ البروفايل (الواجهة القديمة: يعمل تلقائياً على البروفايل الحالي) ---
// مثل الأصل تماماً: يفتح قائمة أوامر البروفايل الحالي وتحمّل الملف المشفر
async function showCopyProfileModal() {
  const sourceId = getSelectedProfileId();
  if (!sourceId) {
    showMessage("⚠️ اختر بروفايل أولاً");
    return;
  }
  currentCommandModalMode = "copy";
  document.getElementById("copyTargetWrap").style.display = "none";
  document.getElementById("select-all-label").textContent = "تحديد الكل";
  document.getElementById("commandModalTitle").textContent = "تصدير الأوامر";
  document.getElementById("confirmCommandAction").textContent = "تحميل";
  document.getElementById("duplicateCommandsArea").style.display = "none";

  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}?profile=${sourceId}`).then((r) => r.json()),
      fetchWithAuth(`${INTERACT_API}?profile=${sourceId}`).then((r) =>
        r.json(),
      ),
    ]);
    const giftCommands = giftsRes.gifts || [];
    const interactCommands = interactRes.list || [];
    const allCommands = [
      ...giftCommands.map((c) => ({ ...c, __type: "gift" })),
      ...interactCommands.map((c) => ({ ...c, __type: "interaction" })),
    ];
    if (allCommands.length === 0) {
      showMessage("⚠️ لا توجد أوامر في هذا البروفايل لنسخها");
      return;
    }
    buildCommandSelectionTable(allCommands, true);

    const selectAll = document.getElementById("select-all-commands");
    selectAll.onchange = function () {
      document
        .querySelectorAll("#commandSelectionTableBody .command-checkbox")
        .forEach((cb) => (cb.checked = this.checked));
    };

    // جدول اختصارات البروفايل لتحديد ما يُصدَّر مع الملف
    await loadCurrentProfileHotkeys();
    document.getElementById("hotkeysAreaTitle").textContent =
      "اختصارات البروفايل — حدد ما يُضمَّن في الملف";
    document.getElementById("select-all-hotkeys-label").textContent =
      "تحديد الكل";
    buildHotkeySelectionTable(currentProfileHotkeys, "copy");
    setupHotkeySelectAll();

    document.getElementById("commandSelectionModal").style.display = "flex";
  } catch (err) {
    console.error(err);
    showMessage("❌ فشل تحميل الأوامر");
  }
}

// --- اضافة البروفايل (الواجهة القديمة: مودال اختيار الأوامر مع كشف المكررات) ---
// الملف يُقرأ ويُفك تشفيره في الباك اند ثم تُعرض الأوامر في مودال الاستيراد
function showAddProfileFromFile() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".tfc";
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showMessage("⏳ جارٍ قراءة الملف من الخادم...");
    try {
      const formData = new FormData();
      formData.append("tfcFile", file);
      const res = await fetchWithAuth(`${API_BASE}/api/profiles/parse-file`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.success || !Array.isArray(data.commands)) {
        showMessage("❌ " + (data.message || "ملف غير صالح"));
        return;
      }
      showMessage(`✅ تم قراءة ${data.commands.length} أمر من الملف`);
      importedCommands = data.commands;
      importedHotkeys = Array.isArray(data.hotkeys) ? data.hotkeys : [];
      showImportModal();
    } catch (err) {
      console.error(err);
      showMessage("❌ خطأ في الاتصال أثناء قراءة الملف");
    }
  };
  fileInput.click();
}

document
  .getElementById("copy-profile-btn")
  .addEventListener("click", showCopyProfileModal);
document
  .getElementById("add-profile-btn")
  .addEventListener("click", showAddProfileFromFile);

document
  .getElementById("confirmCommandAction")
  .addEventListener("click", async () => {
    const btn = document.getElementById("confirmCommandAction");
    try {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.pointerEvents = "none";

      if (currentCommandModalMode === "copy") {
        // مثل القديم: يعمل تلقائياً على البروفايل الحالي - تصدير الأوامر المحددة
        const sourceId = getSelectedProfileId();
        if (!sourceId) {
          showMessage("⚠️ لا يوجد بروفايل محدد");
          return;
        }
        const checkedIndices = Array.from(
          document.querySelectorAll(
            "#commandSelectionTableBody .command-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const selectedCommands = checkedIndices.map(
          (i) => window.currentCommandsList[i],
        );
        if (selectedCommands.length === 0) {
          showMessage("⚠️ لم تختر أي أمر");
          return;
        }
        const commandIds = selectedCommands
          .map((c) => (c._id ? String(c._id) : null))
          .filter(Boolean);

        // اختصارات محددة للتصدير (فارغ = كل اختصارات الأوامر المحددة)
        const checkedHotkeyIndices = Array.from(
          document.querySelectorAll(
            "#hotkeysSelectionTbody .hotkey-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const hotkeyIds = checkedHotkeyIndices
          .map((i) =>
            currentProfileHotkeys[i] && currentProfileHotkeys[i]._id
              ? String(currentProfileHotkeys[i]._id)
              : null,
          )
          .filter(Boolean);

        // تصدير ملف .tfc مشفر من الباك اند للمشاركة مع الآخرين
        try {
          const res = await fetchWithAuth(
            `${API_BASE}/api/profiles/export-file/${sourceId}?commandIds=${encodeURIComponent(commandIds.join(","))}` +
              (hotkeyIds.length > 0
                ? `&hotkeyIds=${encodeURIComponent(hotkeyIds.join(","))}`
                : ""),
          );
          if (!res.ok) {
            let msg = "";
            try {
              msg = (await res.json()).message || "";
            } catch {}
            showMessage("❌ فشل تصدير الملف: " + msg);
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `profile_${sourceId}_commands.tfc`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showMessage(
            "✅ تم تحميل الملف المشفر — أرسله لمن تريد، لا يُفتح إلا داخل التطبيق",
          );
          document.getElementById("commandSelectionModal").style.display =
            "none";
        } catch (err) {
          console.error(err);
          showMessage("❌ خطأ في الاتصال أثناء التصدير");
        }
      } else if (currentCommandModalMode === "export") {
        const profileId = getSelectedProfileId();
        if (!profileId) {
          showMessage("⚠️ لا يوجد بروفايل محدد");
          return;
        }
        // التصدير يتم من الباك اند: ملف .tfc مشفر بالكامل (AES-256-GCM)
        const res = await fetchWithAuth(
          `${API_BASE}/api/profiles/export-file/${profileId}`,
        );
        if (!res.ok) {
          let msg = "";
          try {
            msg = (await res.json()).message || "";
          } catch {}
          showMessage("❌ فشل تصدير البروفايل: " + msg);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `profile_${profileId}_commands.tfc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage("✅ تم تحميل البروفايل المشفر (.tfc)");
        document.getElementById("commandSelectionModal").style.display = "none";
      } else if (currentCommandModalMode === "import") {
        const selectedNonDuplicateIndices = Array.from(
          document.querySelectorAll(
            "#commandSelectionTableBody .command-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const selectedNonDuplicate = selectedNonDuplicateIndices.map(
          (i) => nonDuplicateCommands[i],
        );
        const replaceChecks = document.querySelectorAll(
          ".duplicate-replace-checkbox:checked",
        );
        const selectedDuplicateIndices = Array.from(replaceChecks).map((cb) =>
          parseInt(cb.dataset.index),
        );
        const selectedDuplicate = selectedDuplicateIndices.map(
          (i) => duplicateCommands[i],
        );

        // الاختصارات المحددة من ملف .tfc
        const selectedHotkeyIndices = Array.from(
          document.querySelectorAll(
            "#hotkeysSelectionTbody .hotkey-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const selectedHotkeys = selectedHotkeyIndices
          .map((i) => importedHotkeys[i])
          .filter(Boolean);

        if (
          selectedNonDuplicate.length === 0 &&
          selectedDuplicate.length === 0 &&
          selectedHotkeys.length === 0
        ) {
          showMessage("⚠️ لم تختر أي أمر");
          return;
        }

        const profileId = getSelectedProfileId();

        if (window.isSharedExport) {
          const allSelected = [...selectedNonDuplicate, ...selectedDuplicate];
          if (allSelected.length === 0 && selectedHotkeys.length === 0) {
            showMessage("⚠️ لم تختر أي أمر");
            return;
          }
          const gifts = allSelected.filter(
            (c) => c.giftId || c.__type === "gift",
          );
          const interactions = allSelected.filter(
            (c) => !c.giftId && c.__type !== "gift",
          );

          try {
            const res = await fetchWithAuth(
              `${API_BASE}/api/profiles/import-shared`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: { gifts, interactions, hotkeys: selectedHotkeys },
                  targetProfile: profileId,
                }),
              },
            );
            const data = await res.json();
            if (data.success) {
              showMessage(
                "✅ تم استيراد البروفايل المشترك بنجاح (مع رفع الوسائط)",
              );
              await loadCommands(true);
              await loadHotkeyCommands();
              await applyHotkeySettings();
            } else {
              showMessage(
                "❌ فشل استيراد البروفايل المشترك: " +
                  (data.message || "خطأ غير معروف"),
              );
            }
          } catch (err) {
            console.error(err);
            showMessage("❌ خطأ في الاتصال أثناء الاستيراد المشترك");
          }
        } else {
          let importSuccess = true;
          let hotkeysSent = selectedHotkeys.length === 0;
          try {
            if (selectedNonDuplicate.length > 0) {
              const res = await fetchWithAuth(
                `${API_BASE}/api/profiles/import`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    commands: selectedNonDuplicate,
                    replace: false,
                    profile: profileId,
                    hotkeys: selectedHotkeys,
                  }),
                },
              );
              hotkeysSent = true;
              const data = await res.json();
              if (!data.success) {
                importSuccess = false;
                showMessage(
                  "❌ فشل استيراد الأوامر الجديدة: " +
                    (data.message || "خطأ غير معروف"),
                );
              }
            } else if (selectedHotkeys.length > 0) {
              // استيراد اختصارات فقط بدون أوامر
              const res = await fetchWithAuth(
                `${API_BASE}/api/profiles/import`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    commands: [],
                    replace: false,
                    profile: profileId,
                    hotkeys: selectedHotkeys,
                  }),
                },
              );
              hotkeysSent = true;
              const data = await res.json();
              if (!data.success) {
                importSuccess = false;
                showMessage(
                  "❌ فشل استيراد الاختصارات: " +
                    (data.message || "خطأ غير معروف"),
                );
              }
            }
            if (importSuccess && selectedDuplicate.length > 0) {
              const res = await fetchWithAuth(
                `${API_BASE}/api/profiles/import`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    commands: selectedDuplicate,
                    replace: true,
                    profile: profileId,
                    hotkeys: hotkeysSent ? [] : selectedHotkeys,
                  }),
                },
              );
              const data = await res.json();
              if (!data.success) {
                importSuccess = false;
                showMessage(
                  "❌ فشل استيراد الأوامر المكررة: " +
                    (data.message || "خطأ غير معروف"),
                );
              }
            }
          } catch (err) {
            console.error(err);
            importSuccess = false;
            showMessage("❌ خطأ في الاتصال أثناء الاستيراد");
          }
          if (importSuccess) {
            showMessage("✅ تم الاستيراد بنجاح");
            await loadCommands(true);
            await loadHotkeyCommands();
            await applyHotkeySettings();
          }
        }
        document.getElementById("commandSelectionModal").style.display = "none";
      }
    } catch (err) {
      console.error(err);
      showMessage("❌ حدث خطأ غير متوقع: " + err.message);
    } finally {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  });

document.getElementById("cancelCommandAction").addEventListener("click", () => {
  document.getElementById("commandSelectionModal").style.display = "none";
});
document.getElementById("close-command-modal").addEventListener("click", () => {
  document.getElementById("commandSelectionModal").style.display = "none";
});

// ============================================================
// دوال الاتصال بـ TikTok
// ============================================================
async function performDisconnect() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/tiktok-disconnect`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`فشل الاتصال: ${res.status}`);
    const data = await res.json();
    if (data.success) {
      showMessage("✅ تم قطع الاتصال");
      isLiveConnected = false;
      document.getElementById("send-usertik").textContent =
        "Connect to TikTok LIVE";
      document.getElementById("send-usertik").style.backgroundColor = "";
      document.getElementById("connect-text").textContent = "Disconnected";
      document.getElementById("connect-text").style.color = "red";
      document.getElementById("connect-profile-aside").style.pointerEvents =
        "auto";
      document.getElementById("connect-profile-aside").style.opacity = 1;
      updateStreamerImages(true);
    } else {
      showMessage("❌ فشل قطع الاتصال: " + (data.message || "خطأ غير معروف"));
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال بالسيرفر (تعذر قطع الاتصال)");
  }
}

async function performConnect(username) {
  if (!username) return;
  const connectBtn = document.getElementById("send-usertik");
  const connectProfile = document.getElementById("connect-profile-aside");
  const connectText = document.getElementById("connect-text");

  connectBtn.disabled = true;
  connectProfile.style.pointerEvents = "none";
  connectBtn.style.opacity = 0.6;
  connectProfile.style.opacity = 0.6;
  connectText.textContent = "Connecting...";
  connectText.style.color = "orange";

  try {
    const res = await fetchWithAuth(`${API_BASE}/api/tiktok-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();

    if (data.success) {
      let attempts = 0;
      const maxAttempts = 15;
      let intervalId = null;

      const checkAndUpdate = async () => {
        attempts++;
        await checkLiveStatus();
        if (isLiveConnected || attempts >= maxAttempts) {
          if (intervalId) clearInterval(intervalId);
          connectBtn.disabled = false;
          connectProfile.style.pointerEvents = "auto";
          connectBtn.style.opacity = 1;
          connectProfile.style.opacity = 1;

          if (isLiveConnected) {
            connectText.textContent = "Connected";
            connectText.style.color = "#1dd9e6e1";
            connectBtn.textContent = "Disconnect";
            connectBtn.style.backgroundColor = "#f44336";
          } else {
            showMessage("⚠️ الحساب غير متصل أو ليس لايف");
            connectText.textContent = "Disconnected";
            connectText.style.color = "red";
            connectBtn.textContent = "Connect to TikTok LIVE";
            connectBtn.style.backgroundColor = "";
            isLiveConnected = false;
          }
        }
      };

      intervalId = setInterval(checkAndUpdate, 1000);
      await checkAndUpdate();
    } else {
      showMessage(
        "❌ فشل تعيين اسم المستخدم: " + (data.message || "خطأ غير معروف"),
      );
      connectBtn.disabled = false;
      connectProfile.style.pointerEvents = "auto";
      connectBtn.style.opacity = 1;
      connectProfile.style.opacity = 1;
      connectText.textContent = "Disconnected";
      connectText.style.color = "red";
      connectBtn.textContent = "Connect to TikTok LIVE";
      connectBtn.style.backgroundColor = "";
      isLiveConnected = false;
    }
    updateStreamerImages(true);
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال بالسيرفر");
    connectBtn.disabled = false;
    connectProfile.style.pointerEvents = "auto";
    connectBtn.style.opacity = 1;
    connectProfile.style.opacity = 1;
    connectText.textContent = "Disconnected";
    connectText.style.color = "red";
    connectBtn.textContent = "Connect to TikTok LIVE";
    connectBtn.style.backgroundColor = "";
    isLiveConnected = false;
  }
}

function showDisconnectConfirm(usernameForConnect = null) {
  pendingUsername = usernameForConnect;
  document.getElementById("disconnectMessage").innerText =
    "هل تريد قطع الاتصال بالبث المباشر؟";
  document.getElementById("disconnectModal").style.display = "flex";
}

function closeDisconnectModal() {
  document.getElementById("disconnectModal").style.display = "none";
  pendingUsername = null;
}

async function confirmDisconnect() {
  closeDisconnectModal();
  await performDisconnect();
  if (pendingUsername) {
    await performConnect(pendingUsername);
    pendingUsername = null;
  }
}

document.getElementById("send-usertik").addEventListener("click", (event) =>
  withButtonLock(event.currentTarget, async () => {
    const username = document.getElementById("user-tiktok").value.trim();
    lastEnteredUsername = username;
    if (isLiveConnected) {
      showDisconnectConfirm(username);
    } else {
      if (!username) {
        showMessage("⚠️ الرجاء إدخال اسم المستخدم");
        return;
      }
      await performConnect(username);
    }
  }),
);

// ============================================================
// دوال الشاشات (Screens)
// ============================================================
async function loadScreens(force = false) {
  const container = document.getElementById("screensContainer");
  if (!container) return;
  if (screensLoaded && !force) {
    console.log("⏭️ الشاشات محملة مسبقاً، تخطي الطلب");
    return;
  }
  container.innerHTML =
    '<div class="loading-screens">⏳ جاري تحميل روابط الشاشات...</div>';
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/user/screen-token`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const token = data.token;
    let html = '<div class="screens-grid">';
    for (let i = 1; i <= 10; i++) {
      // ✅ الرابط الطويل مباشرة (دون widgetId)
      const screenUrl = `${API_BASE}/screens/${token}/${i}.html`;
      const safeUrl = escapeHtml(screenUrl);
      html += `
        <div class="screen-card">
          <div class="screen-number">${i}</div>
          <div class="screen-url" dir="ltr">${safeUrl}</div>
          <button class="copy-url-btn" data-url="${safeUrl}">📋 نسخ الرابط</button>
        </div>
      `;
    }
    html += "</div>";
    container.innerHTML = html;
    screensLoaded = true;

    document.querySelectorAll(".copy-url-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        navigator.clipboard.writeText(url);
        btn.textContent = "✅ تم النسخ!";
        setTimeout(() => (btn.textContent = "📋 نسخ الرابط"), 2000);
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="error-message">❌ فشل تحميل الروابط: ${escapeHtml(err.message)}</div>`;
    screensLoaded = false;
  }
}

// ============================================================
// دوال المشرف (Admin)
// ============================================================
async function loadAdminDashboard() {
  const adminContainer = document.getElementById("adminDashboardContainer");
  if (!adminContainer) return;

  adminContainer.innerHTML = `<div class="loading-dashboard">⏳ جاري تحميل بيانات لوحة التحكم...</div>`;

  try {
    const [statsRes, usersRes] = await Promise.all([
      fetchWithAuth(`${API_BASE}/api/admin/stats`),
      fetchWithAuth(`${API_BASE}/api/admin/users`),
    ]);
    const stats = await statsRes.json();
    const usersData = await usersRes.json();
    if (!stats.success || !usersData.success)
      throw new Error("فشل تحميل البيانات");

    window.allAdminUsers = usersData.users;

    const statsHtml = `
      <div class="dashboard-stats-grid">
        <div class="stat-card"><div class="stat-value">${stats.stats.totalUsers}</div><div class="stat-label">إجمالي المستخدمين</div></div>
        <div class="stat-card"><div class="stat-value">${stats.stats.paidUsers}</div><div class="stat-label">مشتركين مدفوعين</div></div>
        <div class="stat-card"><div class="stat-value">${stats.stats.freeUsers}</div><div class="stat-label">مستخدمين مجانيين</div></div>
        <div class="stat-card"><div class="stat-value">${stats.stats.totalCommands}</div><div class="stat-label">إجمالي الأوامر</div></div>
        <div class="stat-card"><div class="stat-value">${stats.stats.activeLiveUsers}</div><div class="stat-label">بثوث حية نشطة</div></div>
      </div>
    `;

    // ===== قسم إدارة الإشعارات =====
    const notificationsHtml = `
    <div style="margin-top: 30px; background: #1e1e1e; padding: 20px; border-radius: 12px; border: 1px solid #333;">
      <h3 style="color: #ff6b6b;">🔔 إدارة الإشعارات العاجلة</h3>
      
      <!-- نموذج الإضافة -->
      <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; background: #2a2a2a; padding: 15px; border-radius: 8px;">
        <input type="text" id="adminNotificationText" placeholder="نص الإشعار..." style="flex: 2; padding: 10px; background: #333; border: 1px solid #555; color: white; border-radius: 6px;">
        <input type="number" id="adminNotificationDuration" placeholder="المدة" value="1" style="width: 80px; padding: 10px; background: #333; border: 1px solid #555; color: white; border-radius: 6px;">
        <select id="adminNotificationUnit" style="padding: 10px; background: #333; border: 1px solid #555; color: white; border-radius: 6px;">
          <option value="second">ثانية</option>
          <option value="minute" selected>دقيقة</option>
          <option value="hour">ساعة</option>
        </select>
        <button id="adminSendNotificationBtn" class="btn btn-danger" style="background: #dc3545;">إرسال الإشعار</button>
      </div>
      
      <!-- قائمة الإشعارات -->
      <div id="adminNotificationList" style="max-height: 300px; overflow-y: auto; margin-top: 10px;">
        <table style="width:100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background:#333;">
              <th style="padding:8px; text-align:right;">النص</th>
              <th style="padding:8px; text-align:center;">المدة</th>
              <th style="padding:8px; text-align:center;">الوحدة</th>
              <th style="padding:8px; text-align:center;">تنتهي في</th>
              <th style="padding:8px; text-align:center;">الحالة</th>
              <th style="padding:8px; text-align:center;">إجراءات</th>
            </tr>
          </thead>
          <tbody id="adminNotificationsTbody"></tbody>
        </table>
      </div>
      <div id="adminNotificationResult" style="margin-top: 10px; color: #aaa;"></div>
    </div>
    `;

    const searchHtml = `
      <div class="admin-search-bar" style="display:flex; gap:10px; align-items:center; margin:15px 0; flex-wrap:wrap; background:#1e1e1e; padding:12px; border-radius:8px; direction:rtl;">
        <input type="text" id="adminSearchEmail" placeholder="🔍 بحث بالبريد الإلكتروني..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid #333; border-radius:4px; background:#2a2a2a; color:white; outline:none;">
        <input type="text" id="adminSearchTiktok" placeholder="🔍 بحث بـ TikTok Username..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid #333; border-radius:4px; background:#2a2a2a; color:white; outline:none;">
        <button id="adminSearchClear" style="padding:8px 16px; background:#555; border:none; border-radius:4px; color:white; cursor:pointer;">✖ مسح</button>
      </div>
    `;

    let usersHtml = `<div class="dashboard-users-table-container"><table class="dashboard-users-table"><thead><tr>
      <th>البريد الإلكتروني</th>
      <th>الخطة</th>
      <th>النوع</th>
      <th>تاريخ الانتهاء</th>
      <th>الدور</th>
      <th>TikTok</th>
      <th>الحالة</th>
      <th>عدد الأوامر</th>
      <th>تاريخ التسجيل</th>
      <th>إجراءات</th>
    </tr></thead><tbody id="adminTableBody">`;
    usersHtml += `</tbody></table></div>`;

    adminContainer.innerHTML =
      statsHtml + notificationsHtml + searchHtml + usersHtml;

    // ===== ربط زر إرسال الإشعار =====
    document
      .getElementById("adminSendNotificationBtn")
      ?.addEventListener("click", async function () {
        const text = document
          .getElementById("adminNotificationText")
          .value.trim();
        const duration =
          parseInt(
            document.getElementById("adminNotificationDuration").value,
          ) || 1;
        const unit = document.getElementById("adminNotificationUnit").value;
        if (!text) {
          document.getElementById("adminNotificationResult").textContent =
            "⚠️ أدخل نص الإشعار";
          return;
        }
        try {
          const res = await fetchWithAuth(
            `${API_BASE}/api/admin/notification`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                durationValue: duration,
                durationUnit: unit,
              }),
            },
          );
          const data = await res.json();
          if (data.success) {
            document.getElementById("adminNotificationResult").textContent =
              "✅ تم إرسال الإشعار بنجاح";
            document.getElementById("adminNotificationText").value = "";
            loadAdminNotifications();
          } else {
            document.getElementById("adminNotificationResult").textContent =
              "❌ فشل الإرسال: " + (data.message || "");
          }
        } catch (err) {
          document.getElementById("adminNotificationResult").textContent =
            "❌ خطأ في الاتصال";
        }
      });

    function renderFilteredUsers(filteredUsers) {
      const tbody = document.getElementById("adminTableBody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (!filteredUsers || filteredUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#888;">❌ لا توجد نتائج مطابقة</td></tr>`;
        return;
      }
      const now = new Date();
      filteredUsers.forEach((user) => {
        const expiry = user.subscriptionExpiry
          ? new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")
          : "غير محدد";
        const planBadge =
          user.plan === "paid"
            ? '<span class="badge-paid">مدفوع</span>'
            : '<span class="badge-free">مجاني</span>';
        const planType = user.planType
          ? user.planType === "monthly"
            ? "شهري"
            : "سنوي"
          : "—";
        const roleBadge =
          user.role === "admin"
            ? '<span class="badge-admin">مدير</span>'
            : '<span class="badge-user">مستخدم</span>';
        const liveStatusHtml = user.isLiveNow
          ? '<span class="status-live">🟢 مباشر</span>'
          : '<span class="status-offline">⚫ غير متصل</span>';
        const tiktokHtml = user.tiktokUsername
          ? `<span class="tiktok-user">@${escapeHtml(user.tiktokUsername)}</span>`
          : "—";
        const expiryDate = user.subscriptionExpiry
          ? new Date(user.subscriptionExpiry)
          : null;
        const isPaid = user.plan === "paid";
        const isActive = isPaid && expiryDate && expiryDate > now;

        const makeAdminDisabled =
          user.role === "admin"
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : "";
        const removeAdminDisabled =
          user.role !== "admin"
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : "";
        const renewDisabled =
          isPaid && isActive
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : "";
        const downgradeDisabled =
          !isPaid || !isActive
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : "";

        const actionsHtml = `
          <button class="admin-delete-user" data-id="${user.id}">حذف الحساب</button>
          <button class="admin-remove-admin" data-id="${user.id}" ${removeAdminDisabled}>إزالة المدير</button>
          <button class="admin-make-admin" data-id="${user.id}" ${makeAdminDisabled}>ترقية مدير</button>
          <button class="admin-downgrade" data-id="${user.id}" ${downgradeDisabled}>الغاء الاشتراك</button>
          <button class="admin-renew-yearly" data-id="${user.id}" data-plan="yearly" ${renewDisabled}>اشتراك سنه</button>
          <button class="admin-renew-monthly" data-id="${user.id}" data-plan="monthly" ${renewDisabled}>اشتراك شهر</button>
        `;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(user.email)}</td>
          <td>${planBadge}</td>
          <td>${planType}</td>
          <td>${expiry}</td>
          <td>${roleBadge}</td>
          <td>${tiktokHtml}</td>
          <td>${liveStatusHtml}</td>
          <td>${user.commandCount}</td>
          <td>${new Date(user.createdAt).toLocaleDateString("ar-EG")}</td>
          <td>${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
      });
      attachAdminButtonEvents();
    }

    function filterUsers() {
      const emailInput = document.getElementById("adminSearchEmail");
      const tiktokInput = document.getElementById("adminSearchTiktok");
      const emailQuery = emailInput
        ? emailInput.value.trim().toLowerCase()
        : "";
      const tiktokQuery = tiktokInput
        ? tiktokInput.value.trim().toLowerCase()
        : "";
      if (!window.allAdminUsers) return;
      let filtered = window.allAdminUsers;
      if (emailQuery)
        filtered = filtered.filter((user) =>
          user.email.toLowerCase().includes(emailQuery),
        );
      if (tiktokQuery)
        filtered = filtered.filter((user) =>
          (user.tiktokUsername || "").toLowerCase().includes(tiktokQuery),
        );
      renderFilteredUsers(filtered);
    }

    renderFilteredUsers(window.allAdminUsers);

    document
      .querySelectorAll("#adminSearchEmail, #adminSearchTiktok")
      .forEach((input) => {
        input.addEventListener("input", () => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(filterUsers, 300);
        });
      });

    document
      .getElementById("adminSearchClear")
      ?.addEventListener("click", () => {
        document.getElementById("adminSearchEmail").value = "";
        document.getElementById("adminSearchTiktok").value = "";
        filterUsers();
      });
    loadAdminNotifications();
    attachAdminButtonEvents();
  } catch (err) {
    adminContainer.innerHTML = `<div class="error-message">❌ فشل تحميل لوحة التحكم: ${err.message}</div>`;
  }
}

// تحميل قائمة الإشعارات (للوحة الأدمن)
async function loadAdminNotifications() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/admin/notifications`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const tbody = document.getElementById("adminNotificationsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (data.notifications.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888;">لا توجد إشعارات</td></tr>`;
      return;
    }
    data.notifications.forEach((n) => {
      const tr = document.createElement("tr");
      tr.dataset.id = n._id;
      const now = new Date();
      const isExpired = new Date(n.expiresAt) < now;
      const isActive = n.isActive && !isExpired;
      tr.innerHTML = `
        <td style="padding:8px; text-align:right;">${escapeHtml(n.text)}</td>
        <td style="text-align:center;">${n.durationValue || "?"}</td>
        <td style="text-align:center;">${n.durationUnit === "hour" ? "ساعة" : n.durationUnit === "minute" ? "دقيقة" : "ثانية"}</td>
        <td style="text-align:center;">${new Date(n.expiresAt).toLocaleString("ar-EG")}</td>
        <td style="text-align:center;">${isActive ? "🟢 نشط" : "🔴 منتهي/غير نشط"}</td>
        <td style="text-align:center;">
          <button class="admin-edit-notification" data-id="${n._id}" style="background:#ffc107; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;">✏️ تعديل</button>
          <button class="admin-delete-notification" data-id="${n._id}" style="background:#dc3545; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; color:white;">🗑️ حذف</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    attachNotificationAdminEvents();
  } catch (err) {
    console.error("فشل تحميل الإشعارات:", err);
  }
}

// ربط أحداث التعديل والحذف
function attachNotificationAdminEvents() {
  document.querySelectorAll(".admin-edit-notification").forEach((btn) => {
    btn.removeEventListener("click", handleEditNotification);
    btn.addEventListener("click", handleEditNotification);
  });
  document.querySelectorAll(".admin-delete-notification").forEach((btn) => {
    btn.removeEventListener("click", handleDeleteNotification);
    btn.addEventListener("click", handleDeleteNotification);
  });
}

// معالج تعديل الإشعار
async function handleEditNotification(e) {
  const id = e.currentTarget.dataset.id;
  // نفتح مودال تعديل بسيط (استخدم prompt أو مودال مخصص)
  const newText = prompt("أدخل النص الجديد للإشعار:");
  if (newText === null) return;
  const newDuration = prompt("أدخل المدة الجديدة (رقم):");
  if (newDuration === null) return;
  const unit = prompt("أدخل الوحدة (second/minute/hour):", "minute");
  if (unit === null) return;
  if (!["second", "minute", "hour"].includes(unit)) {
    showMessage("⚠️ وحدة غير صالحة");
    return;
  }
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/admin/notification/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: newText.trim(),
          durationValue: parseInt(newDuration),
          durationUnit: unit,
          isActive: true,
        }),
      },
    );
    const data = await res.json();
    if (data.success) {
      showMessage("✅ تم تعديل الإشعار");
      loadAdminNotifications();
    } else {
      showMessage("❌ فشل التعديل: " + data.message);
    }
  } catch (err) {
    showMessage("❌ خطأ في الاتصال");
  }
}

// معالج حذف الإشعار
async function handleDeleteNotification(e) {
  const id = e.currentTarget.dataset.id;
  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا الإشعار نهائياً؟",
    "تأكيد الحذف",
  );
  if (!confirmed) return;
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/admin/notification/${id}`,
      {
        method: "DELETE",
      },
    );
    const data = await res.json();
    if (data.success) {
      showMessage("✅ تم حذف الإشعار");
      loadAdminNotifications();
    } else {
      showMessage("❌ فشل الحذف: " + data.message);
    }
  } catch (err) {
    showMessage("❌ خطأ في الاتصال");
  }
}

function attachAdminButtonEvents() {
  const container = document.getElementById("adminDashboardContainer");
  if (!container) return;

  if (container._adminClickHandler) {
    container.removeEventListener("click", container._adminClickHandler);
  }

  const handler = async function (event) {
    const target = event.target.closest("button");
    if (!target) return;

    if (
      target.classList.contains("admin-renew-monthly") ||
      target.classList.contains("admin-renew-yearly")
    ) {
      const id = target.dataset.id;
      const plan =
        target.dataset.plan ||
        (target.classList.contains("admin-renew-monthly")
          ? "monthly"
          : "yearly");
      const planName = plan === "monthly" ? "شهري" : "سنوي";
      const confirmed = await showConfirm(
        `تجديد الاشتراك (${planName}) للمستخدم؟`,
        "تأكيد التجديد",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/admin/user/${id}/renew`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planType: plan }),
          },
        );
        const data = await res.json();
        showMessage(data.success ? "✅ تم التجديد بنجاح" : "❌ فشل التجديد");
        if (data.success) setTimeout(() => loadAdminDashboard(), 500);
      } catch (err) {
        showMessage("❌ خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-downgrade")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "إزالة الترقية وجعل المستخدم مجانياً؟",
        "تأكيد إلغاء الاشتراك",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/admin/user/${id}/downgrade`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(data.success ? "✅ تمت إزالة الترقية" : "❌ فشلت العملية");
        if (data.success) setTimeout(() => loadAdminDashboard(), 500);
      } catch (err) {
        showMessage("❌ خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-make-admin")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "ترقية المستخدم إلى مدير؟",
        "تأكيد الترقية",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/admin/user/${id}/make-admin`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(data.success ? "✅ تمت الترقية" : "❌ فشلت الترقية");
        if (data.success) setTimeout(() => loadAdminDashboard(), 500);
      } catch (err) {
        showMessage("❌ خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-remove-admin")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "هل أنت متأكد من إزالة صلاحية المدير عن هذا المستخدم؟",
        "تأكيد إزالة المدير",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/admin/user/${id}/remove-admin`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "✅ تمت إزالة صلاحية المدير"
            : "❌ فشلت العملية: " + (data.message || ""),
        );
        if (data.success) setTimeout(() => loadAdminDashboard(), 500);
      } catch (err) {
        showMessage("❌ خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-delete-user")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "حذف المستخدم وجميع أوامره؟ هذا الإجراء لا يمكن التراجع عنه.",
        "تأكيد الحذف",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/admin/user/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        showMessage(data.success ? "✅ تم الحذف" : "❌ فشل الحذف");
        if (data.success) setTimeout(() => loadAdminDashboard(), 500);
      } catch (err) {
        showMessage("❌ خطأ في الاتصال");
      }
      return;
    }
  };

  container.addEventListener("click", handler);
  container._adminClickHandler = handler;
}

// ============================================================
// لوحة عداد الفوز/الخسارة الأصلية (بدون حقن صفحات خارجية)
// ============================================================
let winsPanelInitDone = false;
async function initWinsPanel() {
  if (winsPanelInitDone) {
    // تحديث الأرقام والإعدادات عند كل فتح للسيكشن
    if (typeof window.winsLoadSettings === "function")
      window.winsLoadSettings();
    return;
  }
  winsPanelInitDone = true;

  const $ = (id) => document.getElementById(id);
  let screenToken = null;
  let saveTimer = null;

  async function getScreenToken() {
    if (screenToken) return screenToken;
    const res = await fetchWithAuth(`${API_BASE}/api/user/screen-token`);
    const data = await res.json();
    const linkInput = $("smwLinkUrl");
    if (data.success) {
      screenToken = data.token;
      // ✅ الرابط الطويل فقط (تجاهل widgetId تماماً)
      if (linkInput) {
        linkInput.value = `${API_BASE}/overlay/wins.html?token=${screenToken}`;
      }
    } else if (linkInput) {
      linkInput.value = "فشل تحميل الرابط — تأكد من تسجيل الدخول";
    }
    return screenToken;
  }

  function applySettings(s) {
    $("smwWinVal").innerText = s.wins || 0;
    $("smwLossVal").innerText = s.losses || 0;
    $("smwPrevWNum").innerText = s.wins || 0;
    $("smwPrevLNum").innerText = s.losses || 0;
    $("smwPrevWLabel").innerText = s.winLabel || "WIN";
    $("smwPrevLLabel").innerText = s.lossLabel || "LOSE";
    $("smwWinLabel").value = s.winLabel || "WIN";
    $("smwLossLabel").value = s.lossLabel || "LOSE";
    $("smwTheme").value = s.theme || "pscontroller";
    $("smwWidth").value = s.width || 285;
    const box = $("smwPreview");
    box.className = "smw-box " + (s.theme || "pscontroller");
    box.style.minWidth = (s.width || 285) + "px";
    const bow = $("smwKittyBow");
    if (bow)
      bow.style.display =
        (s.theme || "pscontroller") === "kitty" ? "block" : "none";
  }

  async function loadSettings() {
    try {
      const token = await getScreenToken();
      if (!token) return;
      const res = await fetchWithAuth(
        `${API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
      );
      const data = await res.json();
      if (data.success) applySettings(data.settings);
    } catch (e) {
      console.error("فشل تحميل إعدادات العداد:", e);
    }
  }
  window.winsLoadSettings = loadSettings;

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const token = await getScreenToken();
        if (!token) return;
        const res = await fetchWithAuth(
          `${API_BASE}/api/wins-settings?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wins: parseInt($("smwWinVal").innerText) || 0,
              losses: parseInt($("smwLossVal").innerText) || 0,
              winLabel: $("smwWinLabel").value || "WIN",
              lossLabel: $("smwLossLabel").value || "LOSE",
              theme: $("smwTheme").value,
              width: parseInt($("smwWidth").value) || 285,
            }),
          },
        );
        const data = await res.json();
        if (data.success) applySettings(data.settings);
      } catch (e) {
        console.error("فشل حفظ إعدادات العداد:", e);
      }
    }, 400);
  }

  function add(type, val) {
    const id = type === "wins" ? "smwWinVal" : "smwLossVal";
    const current = parseInt($(id).innerText) || 0;
    $(id).innerText = Math.max(0, current + val);
    saveSettings();
  }

  $("smwWinPlus").onclick = () => add("wins", 1);
  $("smwWinMinus").onclick = () => add("wins", -1);
  $("smwLossPlus").onclick = () => add("losses", 1);
  $("smwLossMinus").onclick = () => add("losses", -1);
  $("smwReset").onclick = () => {
    $("smwWinVal").innerText = 0;
    $("smwLossVal").innerText = 0;
    saveSettings();
  };
  $("smwWinLabel").addEventListener("input", saveSettings);
  $("smwLossLabel").addEventListener("input", saveSettings);
  $("smwTheme").addEventListener("change", () => {
    const box = $("smwPreview");
    box.className = "smw-box " + $("smwTheme").value;
    const bow = $("smwKittyBow");
    if (bow)
      bow.style.display = $("smwTheme").value === "kitty" ? "block" : "none";
    saveSettings();
  });
  $("smwWidth").addEventListener("input", () => {
    $("smwPreview").style.minWidth =
      (parseInt($("smwWidth").value) || 285) + "px";
    saveSettings();
  });
  $("smwCopyLink").onclick = async () => {
    try {
      const token = await getScreenToken();
      if (!token) return showMessage("❌ فشل الحصول على التوكن");
      const url = $("smwLinkUrl").value;
      await navigator.clipboard.writeText(url);
      showMessage("✅ تم نسخ رابط العداد لـ OBS");
    } catch (e) {
      showMessage("❌ خطأ في النسخ");
    }
  };

  // تحديثات لحظية من السوكيت (مثلاً من جهاز/تابلت تاني)
  const joinWins = async () => {
    try {
      const token = await getScreenToken();
      if (token && frontendSocket && frontendSocket.connected) {
        frontendSocket.emit("get-wins-settings", token);
      }
    } catch (e) {}
  };
  if (frontendSocket) {
    frontendSocket.on("wins-updated", (s) => s && applySettings(s));
    frontendSocket.on("wins-initial", (s) => s && applySettings(s));
    if (frontendSocket.connected) joinWins();
    else frontendSocket.on("connect", joinWins);
  }

  loadSettings();
}

// ============================================================
// دوال Overlay
// ============================================================\

async function loadOverlayTab(tab) {
  const winsPanel = document.getElementById("winsPanelNative");
  const listsPanel = document.getElementById("listsPanelNative");

  document.querySelectorAll(".overlay-tab-btn").forEach((btn) => {
    const isTab = btn.dataset.tab === tab;
    btn.classList.toggle("active", isTab);
    btn.style.background = isTab ? "#1dd9e6e1" : "transparent";
    btn.style.color = isTab ? "#000" : "#aaa";
  });

  if (tab === "wins") {
    if (listsPanel) listsPanel.style.display = "none";
    if (winsPanel) {
      winsPanel.style.display = "block";
      initWinsPanel();
    }
  } else {
    if (winsPanel) winsPanel.style.display = "none";
    if (listsPanel) {
      listsPanel.style.display = "block";
      initListsPanel();
    }
  }
}

// ============================================================
// لوحة قوائم الأوفرلاى الأصلية (بدون حقن صفحات خارجية)
// ============================================================
let listsPanelInitDone = false;
let listsRetryTimer = null;
async function initListsPanel() {
  if (listsPanelInitDone) {
    // تحديث البيانات والروابط عند كل فتح للسيكشن
    if (typeof listsRefreshData === "function") listsRefreshData();
    return;
  }
  listsPanelInitDone = true;

  let screenToken = null;
  let widgetCid = null;
  async function getToken() {
    if (screenToken) return screenToken;
    const res = await fetchWithAuth(`${API_BASE}/api/user/screen-token`);
    const data = await res.json();
    if (data.success) {
      screenToken = data.token;
      widgetCid = data.widgetId || null;
    }
    return screenToken;
  }
  // رابط قصير للأوفرلاي عبر الدومين الرئيسي مع الرجوع للطويل عند غياب cid
  function overlayLink(token, id) {
    return `${API_BASE}/overlay/overlay.html?token=${token}&id=${id}`;
  }
  async function getSettings(token) {
    const res = await fetchWithAuth(
      `${API_BASE}/api/overlay-settings?token=${encodeURIComponent(token)}`,
    );
    return res.json();
  }
  async function postSettings(token, payload) {
    const res = await fetchWithAuth(
      `${API_BASE}/api/overlay-settings?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return res.json();
  }

  class ListController {
    constructor(id) {
      this.id = id;
      this.crowned = new Set();
      this.titleEl = document.getElementById(`smlTitle${id}`);
      this.namesEl = document.getElementById(`smlNames${id}`);
      this.themeEl = document.getElementById(`smlTheme${id}`);
      this.glowEl = document.getElementById(`smlGlow${id}`);
      this.badgeEl = document.getElementById(`smlBadge${id}`);
      this.crownList = document.getElementById(`smlCrowns${id}`);
      this.widthEl = document.getElementById(`smlWidth${id}`);
      this.heightEl = document.getElementById(`smlHeight${id}`);
      this.statusEl = document.getElementById(`smlStatus${id}`);
      this.saveTimer = null;
      this.bind();
      this.load();
    }
    async load() {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await getSettings(token);
        if (!data.success) return;
        const o =
          this.id === 1 ? data.settings.overlay1 : data.settings.overlay2;
        this.titleEl.value = o.title || "";
        this.namesEl.value = o.names || "";
        this.themeEl.value =
          o.theme || (this.id === 1 ? "theme-neon" : "theme-gold");
        this.glowEl.value =
          o.glowColor || (this.id === 1 ? "#00ffe1" : "#ffcc00");
        this.badgeEl.value =
          o.badgeColor || (this.id === 1 ? "#ff0055" : "#a855f7");
        this.widthEl.value = o.width || 285;
        this.heightEl.value = o.maxHeight || 500;
        this.crowned = new Set(o.crowns || []);
        this.renderCrowns();
      } catch (e) {
        console.error("فشل تحميل إعدادات القائمة:", e);
      }
    }
    save() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(async () => {
        try {
          const token = await getToken();
          if (!token) return;
          const payload = {};
          payload[this.id === 1 ? "overlay1" : "overlay2"] = {
            title: this.titleEl.value,
            names: this.namesEl.value,
            theme: this.themeEl.value,
            glowColor: this.glowEl.value,
            badgeColor: this.badgeEl.value,
            crowns: Array.from(this.crowned),
            width: parseInt(this.widthEl.value) || 285,
            maxHeight: parseInt(this.heightEl.value) || 500,
          };
          await postSettings(token, payload);
          this.statusEl.textContent = "✓ تم الحفظ";
          setTimeout(() => (this.statusEl.textContent = ""), 1500);
        } catch (e) {
          this.statusEl.textContent = "⚠️ فشل الحفظ";
        }
      }, 400);
    }
    renderCrowns() {
      const names = this.namesEl.value
        .split("\n")
        .filter((s) => s.trim() !== "");
      this.crownList.innerHTML = "";
      if (names.length === 0) {
        this.crownList.innerHTML =
          '<span style="color:#666;font-size:0.75rem">لا توجد أسماء — أضف أسماء في الحقل أعلاه</span>';
        return;
      }
      names.forEach((name, idx) => {
        const btn = document.createElement("button");
        const isCrowned = this.crowned.has(idx);
        btn.className = "sml-crown-btn" + (isCrowned ? " active" : "");
        btn.textContent = (isCrowned ? "👑 " : "⚪ ") + name.trim();
        btn.onclick = () => {
          if (this.crowned.has(idx)) this.crowned.delete(idx);
          else this.crowned.add(idx);
          this.renderCrowns();
          this.save();
        };
        this.crownList.appendChild(btn);
      });
    }
    bind() {
      [this.titleEl, this.themeEl, this.glowEl, this.badgeEl].forEach((el) => {
        el.addEventListener("input", () => this.save());
        el.addEventListener("change", () => this.save());
      });
      this.widthEl.addEventListener("input", () => this.save());
      this.heightEl.addEventListener("input", () => this.save());
      this.namesEl.addEventListener("input", () => {
        this.renderCrowns();
        this.save();
      });
    }
  }

  const ctrls = [new ListController(1), new ListController(2)];

  // دالة تحديث الروابط والإعدادات — تُستدعى عند كل فتح للسيكشن وعند إعادة المحاولة
  window.listsRefreshData = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      document.getElementById("smlLink1").textContent = overlayLink(token, 1);
      document.getElementById("smlLink2").textContent = overlayLink(token, 2);
      const data = await getSettings(token);
      if (data.success) ctrls.forEach((c) => c.load());
    } catch (e) {}
  };
  window.listsRefreshData();
  // إعادة محاولة تلقائية إذا فشل جلب التوكن في المرة الأولى
  clearTimeout(listsRetryTimer);
  listsRetryTimer = setTimeout(() => {
    const l1 = document.getElementById("smlLink1");
    if (l1 && !l1.textContent.startsWith("http")) window.listsRefreshData();
  }, 5000);

  // روابط OBS + أزرار النسخ والمسح
  try {
    const token = await getToken();
    if (token) {
      document.getElementById("smlLink1").textContent = overlayLink(token, 1);
      document.getElementById("smlLink2").textContent = overlayLink(token, 2);
    }
  } catch (e) {}
  document.querySelectorAll(".sml-copy").forEach((btn) => {
    btn.onclick = () => {
      const link = document.getElementById("smlLink" + btn.dataset.overlay);
      if (!link.textContent.startsWith("http")) {
        showMessage("⚠️ الرابط لم يجهز بعد — جاري الاتصال، جرّب بعد لحظات");
        return;
      }
      navigator.clipboard.writeText(link.textContent);
      showMessage("✅ تم نسخ رابط OBS");
    };
  });
  document.querySelectorAll(".sml-reset").forEach((btn) => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.overlay);
      const ctrl = ctrls[id - 1];
      try {
        const token = await getToken();
        if (!token) return;
        const payload = {};
        payload[id === 1 ? "overlay1" : "overlay2"] = {
          title: ctrl.titleEl.value,
          names: "",
          theme: ctrl.themeEl.value,
          glowColor: ctrl.glowEl.value,
          badgeColor: ctrl.badgeEl.value,
          crowns: [],
          width: parseInt(ctrl.widthEl.value) || 285,
          maxHeight: parseInt(ctrl.heightEl.value) || 500,
        };
        const result = await postSettings(token, payload);
        if (result.success) {
          showMessage("✅ تم مسح الأسماء");
          ctrl.load();
        }
      } catch (e) {
        showMessage("❌ خطأ في المسح");
      }
    };
  });
}

// ============================================================
// دوال HOTKEY (النظام الكامل)
// ============================================================

// دالة التحقق من صحة المفتاح (تدعم المعدلات: Ctrl+Alt+Shift+F1 مثلاً)
const HOTKEY_VALID_KEYS = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "Space",
  "Enter",
  "Backspace",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Shift",
  "Ctrl",
  "Alt",
  "Win",
  "Menu",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

function isValidHotkeyKey(key) {
  if (!key) return false;
  const parts = String(key)
    .split("+")
    .map((p) => p.trim());
  const actualKey = parts.pop();
  const modifiers = new Set(["Ctrl", "Alt", "Shift"]);
  for (const part of parts) {
    if (!modifiers.has(part)) return false;
    // لا تكرار لنفس المعدل
    if (parts.filter((p) => p === part).length > 1) return false;
  }
  return HOTKEY_VALID_KEYS.includes(actualKey);
}

// باراميتر البروفايل الحالي لنداءات hotkey (فارغ إذا لم يحدد)
function hotkeyProfileQuery(prefix = "?") {
  const p = getSelectedProfileId();
  return p ? `${prefix}profile=${p}` : "";
}

// تحميل إعدادات Hotkey
async function loadHotkeySettings() {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    if (
      data.success &&
      Array.isArray(data.hotkeys) &&
      data.hotkeys.length > 0
    ) {
      // اختيار الاختصار النشط، أو الأول إذا لم يوجد نشط
      const hk =
        data.hotkeys.find((h) => h.active !== false) || data.hotkeys[0];
      hotkeySettings = {
        key: hk.key || "",
        commandId: hk.commandId || null,
        commandType: hk.commandType || null,
        active: hk.active !== false,
      };
    } else {
      // لا توجد اختصارات
      hotkeySettings = {
        key: "",
        commandId: null,
        commandType: null,
        active: false,
      };
    }
    applyHotkeySettings();
    renderHotkeysList();
  } catch (err) {
    console.warn("⚠️ فشل تحميل إعدادات hotkey من السيرفر", err);
    const statusEl = document.getElementById("hotkeyStatus");
    if (statusEl) {
      statusEl.textContent = "❌ فشل تحميل الإعدادات";
      statusEl.style.color = "var(--error-color, #f44336)";
    }
    hotkeySettings = {
      key: "",
      commandId: null,
      commandType: null,
      active: false,
    };
    applyHotkeySettings();
    renderHotkeysList();
  }
}
// حفظ إعدادات Hotkey إلى السيرفر
async function saveHotkeySettingsToServer(settings) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/hotkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...settings,
        profile: getSelectedProfileId() || undefined,
      }),
    });
    const data = await res.json();
    if (data.success) {
      console.log("✅ تم حفظ إعدادات hotkey على السيرفر");
      return true;
    } else {
      console.warn("⚠️ فشل حفظ الإعدادات على السيرفر:", data.message);
      return false;
    }
  } catch (err) {
    console.error("❌ خطأ في حفظ hotkey", err);
    return false;
  }
}

// تحديث التسجيل في الخلفية
async function updateHotkeyRegistration() {
  if (!window.electronAPI || !window.electronAPI.hotkey) {
    console.warn("⚠️ Electron API غير متاح، الهوت كي لن يعمل في المتصفح");
    return false;
  }

  try {
    await window.electronAPI.hotkey.unregisterAll();
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    if (!data.success || !data.hotkeys) return true;

    const activeHotkeys = data.hotkeys.filter((h) => h.active !== false);
    if (activeHotkeys.length === 0) return true;

    for (const hk of activeHotkeys) {
      const combo = hk.key;
      const result = await window.electronAPI.hotkey.register(
        combo,
        hk.commandId,
        hk.commandType,
      );
      if (!result || !result.success) {
        console.warn(
          `⚠️ فشل تسجيل الاختصار ${combo}:`,
          result?.error || "خطأ غير معروف",
        );
      } else {
        console.log(`✅ Hotkey registered: ${combo}`);
      }
    }
    return true;
  } catch (err) {
    console.error("❌ خطأ في تحديث تسجيل hotkey:", err);
    return false;
  }
}

// تطبيق الإعدادات على الواجهة
async function applyHotkeySettings() {
  // النموذج دائمًا جاهز لإدخال اختصار جديد: حقول فارغة والتفعيل معلّم
  clearHotkeyFormFields();

  // حالة التسجيل تُحدد من الاختصارات الفعلية المخزنة على السيرفر
  const registered = await updateHotkeyRegistration();

  let activeCount = 0;
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    if (data.success && Array.isArray(data.hotkeys)) {
      activeCount = data.hotkeys.filter((h) => h.active !== false).length;
    }
  } catch (e) {
    console.warn("⚠️ تعذر جلب عدد الاختصارات النشطة");
  }

  const statusEl = document.getElementById("hotkeyStatus");
  if (statusEl) {
    if (!registered) {
      statusEl.textContent = "⚠️ فشل تسجيل الاختصارات في النظام";
      statusEl.style.color = "var(--warning-color, #ff9800)";
    } else if (activeCount > 0) {
      statusEl.textContent = `✅ الاختصارات النشطة: ${activeCount}`;
      statusEl.style.color = "var(--success-color, #4caf50)";
    } else {
      statusEl.textContent = "⏸️ لا توجد اختصارات نشطة";
      statusEl.style.color = "var(--text-muted, #888)";
    }
  }

  await renderHotkeysList();
  updateClearShortcutButton();
}

// ===== مسح حقول النموذج =====
function clearHotkeyFormFields() {
  document.getElementById("hotkeyKey").value = "";
  document.getElementById("hotkeyDisplay").textContent = "لم يتم التعيين";
  document.getElementById("hotkeyCommandSelect").value = "";
  // التفعيل افتراضي عند إنشاء اختصار جديد
  document.getElementById("hotkeyActive").checked = true;

  // تصفير الإعدادات المحلية حتى لا تعيد loadHotkeyCommands اختيار آخر أمر
  hotkeySettings = {
    ...hotkeySettings,
    key: "",
    commandId: null,
    commandType: null,
    active: true,
  };

  const saveBtn = document.getElementById("saveHotkeyBtn");
  if (saveBtn) {
    saveBtn.textContent = "حفظ الإعدادات";
    saveBtn.style.backgroundColor = "";
  }
  editingHotkeyId = null;
}

// ===== عرض رسالة حالة Hotkey مع اختفاء تلقائي =====
let hotkeyStatusTimer = null;
function showHotkeyStatus(text, color) {
  const el = document.getElementById("hotkeyStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  if (hotkeyStatusTimer) clearTimeout(hotkeyStatusTimer);
  hotkeyStatusTimer = setTimeout(() => {
    el.textContent = "";
    el.style.color = "";
  }, 3500);
}

// ===== حفظ الإعدادات الرئيسية =====
async function saveHotkeySettings() {
  const keyInput = document.getElementById("hotkeyKey");
  const select = document.getElementById("hotkeyCommandSelect");
  const activeCheck = document.getElementById("hotkeyActive");

  if (!keyInput || !select) {
    showHotkeyStatus(
      "❌ عناصر الواجهة غير موجودة",
      "var(--error-color, #f44336)",
    );
    return;
  }

  const newKey = keyInput.value.trim();
  const selectedOption = select.options[select.selectedIndex];
  const commandId = selectedOption ? selectedOption.dataset.id : null;
  const commandType = selectedOption ? selectedOption.dataset.type : null;
  const active = activeCheck ? activeCheck.checked : false;

  if (!newKey) {
    showHotkeyStatus(
      "⚠️ يرجى اختيار مفتاح من لوحة المفاتيح",
      "var(--warning-color, #ff9800)",
    );
    showMessage("⚠️ يرجى اختيار مفتاح من لوحة المفاتيح أولاً");
    return;
  }

  if (!isValidHotkeyKey(newKey)) {
    showHotkeyStatus(
      `⚠️ المفتاح "${newKey}" غير مدعوم`,
      "var(--warning-color, #ff9800)",
    );
    showMessage(`⚠️ المفتاح "${newKey}" غير مدعوم`);
    return;
  }

  if (!commandId || !commandType) {
    showHotkeyStatus(
      "⚠️ يرجى اختيار أمر من القائمة",
      "var(--warning-color, #ff9800)",
    );
    showMessage("⚠️ يرجى اختيار أمر من القائمة");
    return;
  }

  try {
    // ✅ جلب جميع اختصارات البروفايل الحالي من السيرفر
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();

    if (data.success && data.hotkeys) {
      // ✅ حالة التعديل (editingHotkeyId موجود)
      if (editingHotkeyId) {
        // البحث عن الاختصار الذي نعدله
        const oldHotkey = data.hotkeys.find(
          (h) => h.commandId === editingHotkeyId,
        );

        // إذا لم نجد الاختصار القديم، هذا يعني أنه تم حذفه أو أن المعرف غير صحيح
        if (!oldHotkey) {
          showHotkeyStatus(
            "❌ الاختصار المطلوب تعديله غير موجود",
            "var(--error-color, #f44336)",
          );
          showMessage("❌ الاختصار المطلوب تعديله غير موجود");
          editingHotkeyId = null;
          clearHotkeyFormFields();
          return;
        }

        const oldKey = oldHotkey.key;

        // ✅ التحقق من عدم استخدام المفتاح الجديد من قبل أمر آخر (باستثناء نفسه)
        const existingHotkey = data.hotkeys.find(
          (h) => h.key === newKey && h.commandId !== editingHotkeyId,
        );

        if (existingHotkey) {
          showHotkeyStatus(
            `⚠️ المفتاح "${newKey}" مستخدم بالفعل مع أمر آخر`,
            "var(--warning-color, #ff9800)",
          );
          showMessage(`⚠️ المفتاح "${newKey}" مستخدم بالفعل مع أمر آخر`);
          return;
        }

        // منع استخدام نفس الأمر في أكثر من اختصار
        const dupCommand = data.hotkeys.find(
          (h) =>
            h.commandId === commandId &&
            h.commandType === commandType &&
            h.key !== oldHotkey.key,
        );
        if (dupCommand) {
          showHotkeyStatus(
            `⚠️ هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
            "var(--warning-color, #ff9800)",
          );
          showMessage(
            `⚠️ هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
          );
          return;
        }

        // ✅ إرسال طلب PUT لتحديث الاختصار
        const settings = {
          key: newKey,
          commandId,
          commandType,
          active,
          profile: getSelectedProfileId() || undefined,
        };

        console.log(`📝 تحديث Hotkey: "${oldKey}" → "${newKey}"`);
        console.log(`📝 بيانات التحديث:`, settings);

        const updateRes = await fetchWithAuth(
          `${API_BASE}/api/hotkey/${encodeURIComponent(oldKey)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
          },
        );

        if (updateRes.ok) {
          hotkeySettings = settings;
          await updateHotkeyRegistration();
          await loadHotkeyCommands();
          await renderHotkeysList();

          showHotkeyStatus(
            `✅ تم تحديث الاختصار: ${newKey}`,
            "var(--success-color, #4caf50)",
          );
          showMessage(`✅ تم تحديث الاختصار من "${oldKey}" إلى "${newKey}"`);

          // ✅ مسح حالة التعديل وتصفير الحقول بعد التحديث
          clearHotkeyFormFields();
          updateClearShortcutButton();
          return;
        } else {
          const errorData = await updateRes.json().catch(() => ({}));
          showHotkeyStatus(
            `❌ فشل تحديث الاختصار: ${errorData.message || "خطأ غير معروف"}`,
            "var(--error-color, #f44336)",
          );
          showMessage(
            `❌ فشل تحديث الاختصار: ${errorData.message || "خطأ غير معروف"}`,
          );
          return;
        }
      }

      // ✅ حالة الإضافة الجديدة - التحقق من عدم وجود المفتاح
      const existingHotkey = data.hotkeys.find((h) => h.key === newKey);
      if (existingHotkey) {
        showHotkeyStatus(
          `⚠️ المفتاح "${newKey}" مستخدم بالفعل`,
          "var(--warning-color, #ff9800)",
        );
        showMessage(`⚠️ المفتاح "${newKey}" مستخدم بالفعل`);
        return;
      }

      // منع استخدام نفس الأمر في أكثر من اختصار
      const dupCommand = data.hotkeys.find(
        (h) => h.commandId === commandId && h.commandType === commandType,
      );
      if (dupCommand) {
        showHotkeyStatus(
          `⚠️ هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
          "var(--warning-color, #ff9800)",
        );
        showMessage(
          `⚠️ هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
        );
        return;
      }
    }

    // ✅ إنشاء Hotkey جديد
    const settings = {
      key: newKey,
      commandId,
      commandType,
      active,
      profile: getSelectedProfileId() || undefined,
    };
    hotkeySettings = settings;

    const saved = await saveHotkeySettingsToServer(settings);

    if (saved) {
      showHotkeyStatus(
        `✅ تم حفظ الاختصار: ${newKey}`,
        "var(--success-color, #4caf50)",
      );
      // تحديث hotkeySettings بالقيم الجديدة
      hotkeySettings = { key: newKey, commandId, commandType, active };
      await updateHotkeyRegistration();
      await loadHotkeyCommands();
      await renderHotkeysList();
      showMessage(`✅ تم تعيين الاختصار: ${newKey}`);
      // ✅ تصفير الحقول بعد الحفظ حتى لا يبقى آخر أمر محددًا
      clearHotkeyFormFields();
      updateClearShortcutButton();
    } else {
      showHotkeyStatus(
        "❌ فشل حفظ الإعدادات على السيرفر",
        "var(--error-color, #f44336)",
      );
      showMessage("❌ فشل حفظ الاختصار");
    }
  } catch (err) {
    console.error("❌ خطأ في saveHotkeySettings:", err);
    showHotkeyStatus("❌ خطأ في الاتصال", "var(--error-color, #f44336)");
    showMessage("❌ خطأ في الاتصال");
  }
}

// ملء القائمة المنسدلة بأسماء الأوامر
async function loadHotkeyCommands() {
  const select = document.getElementById("hotkeyCommandSelect");
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = '<option value="">-- اختر أمراً --</option>';

  const profileId = getSelectedProfileId();
  if (!profileId) {
    console.warn("⚠️ لا يوجد بروفايل محدد لتحميل الأوامر");
    return;
  }

  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}?profile=${profileId}`).then((r) => r.json()),
      fetchWithAuth(`${INTERACT_API}?profile=${profileId}`).then((r) =>
        r.json(),
      ),
    ]);

    const gifts = giftsRes.gifts || [];
    const interactions = interactRes.list || [];

    gifts.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = `gift_${g._id}`;
      opt.dataset.id = g._id;
      opt.dataset.type = "gift";
      const giftName = g.name || g.giftName || "هدية";
      opt.textContent = `🎁 ${giftName}`;
      if (
        hotkeySettings.commandId === g._id &&
        hotkeySettings.commandType === "gift"
      ) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    interactions.forEach((cmd) => {
      const opt = document.createElement("option");
      opt.value = `interact_${cmd._id}`;
      opt.dataset.id = cmd._id;
      opt.dataset.type = "interaction";
      const typeLabel =
        {
          follow: "👤 متابعة",
          like: "❤️ لايك",
          comment: "💬 تعليق",
          share: "🔁 مشاركة",
          gift: "🎁 هدية",
          all: "🌟 الكل",
        }[cmd.type] || cmd.type;
      opt.textContent = `${typeLabel} - ${cmd.name || "بدون اسم"}`;
      if (
        hotkeySettings.commandId === cmd._id &&
        hotkeySettings.commandType === "interaction"
      ) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    if (!select.value && currentValue) {
      const option = select.querySelector(`option[value="${currentValue}"]`);
      if (option) option.selected = true;
    }
  } catch (err) {
    console.warn("⚠️ فشل تحميل الأوامر لقائمة hotkey", err);
    select.innerHTML = '<option value="">❌ فشل تحميل الأوامر</option>';
  }
}

// عرض قائمة Hotkey المسجلة
async function renderHotkeysList() {
  const tbody = document.getElementById("hotkeysTbody");
  if (!tbody) return;

  const emptyRow = (text) => {
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.style.textAlign = "center";
    td.style.padding = "20px";
    td.style.color = "#888";
    td.textContent = text;
    tr.appendChild(td);
    tbody.appendChild(tr);
  };

  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    if (!data.success || !Array.isArray(data.hotkeys)) {
      emptyRow("❌ فشل تحميل الاختصارات");
      return;
    }
    window.currentHotkeys = data.hotkeys;
    if (data.hotkeys.length === 0) {
      emptyRow("لا توجد اختصارات مسجلة في هذا البروفايل");
      return;
    }

    tbody.innerHTML = "";
    data.hotkeys.forEach((hk, index) => {
      const tr = document.createElement("tr");
      if (hotkeySettings.key === hk.key) tr.className = "current-hotkey";

      const tdNum = document.createElement("td");
      tdNum.style.textAlign = "center";
      tdNum.textContent = index + 1;
      tr.appendChild(tdNum);

      const tdKey = document.createElement("td");
      tdKey.style.textAlign = "center";
      const kbd = document.createElement("kbd");
      kbd.textContent = hk.key;
      tdKey.appendChild(kbd);
      tr.appendChild(tdKey);

      const tdName = document.createElement("td");
      const cmd = (window.currentCommandsList || []).find(
        (c) =>
          c._id &&
          String(c._id) === String(hk.commandId) &&
          (c.__type || "gift") === hk.commandType,
      );
      tdName.textContent = cmd
        ? cmd.name || cmd.giftName || "بدون اسم"
        : "أمر غير موجود في البروفايل";
      tr.appendChild(tdName);

      const tdType = document.createElement("td");
      tdType.style.textAlign = "center";
      tdType.textContent = hk.commandType === "gift" ? "هدية" : "تفاعل";
      tr.appendChild(tdType);

      const tdGift = document.createElement("td");
      tdGift.style.textAlign = "center";
      tdGift.textContent = cmd && cmd.giftId ? `🎁 ${cmd.giftId}` : "";
      tr.appendChild(tdGift);

      const tdActive = document.createElement("td");
      tdActive.style.textAlign = "center";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "hotkey-toggle";
      toggle.dataset.key = hk.key;
      toggle.checked = hk.active !== false;
      tdActive.appendChild(toggle);
      tr.appendChild(tdActive);

      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "center";
      const editBtn = document.createElement("button");
      editBtn.className = "hotkey-edit-btn";
      editBtn.textContent = "✏️";
      editBtn.title = "تعديل";
      editBtn.dataset.key = hk.key;
      editBtn.dataset.id = hk.commandId;
      editBtn.dataset.type = hk.commandType;
      editBtn.dataset.active = String(hk.active !== false);
      tdActions.appendChild(editBtn);
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "hotkey-delete-btn";
      deleteBtn.textContent = "🗑️";
      deleteBtn.title = "حذف";
      deleteBtn.dataset.key = hk.key;
      tdActions.appendChild(deleteBtn);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });

    attachHotkeyToggleEvents(tbody);
    attachHotkeyDeleteEvents(tbody);
    attachHotkeyEditEvents(tbody);
  } catch (err) {
    console.warn("⚠️ فشل عرض قائمة الاختصارات", err);
    emptyRow("❌ فشل تحميل الاختصارات");
  }
}

function attachHotkeyToggleEvents(tbody) {
  tbody.querySelectorAll(".hotkey-toggle").forEach((cb) => {
    cb.removeEventListener("change", handleToggleChange);
    cb.addEventListener("change", handleToggleChange);
  });
}

async function handleToggleChange(e) {
  const cb = e.currentTarget;
  const key = cb.dataset.key;
  const active = cb.checked;

  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    const hk = data.hotkeys.find((h) => h.key === key);
    if (!hk) {
      showMessage("❌ لم يتم العثور على الاختصار");
      cb.checked = !active;
      return;
    }

    const settings = {
      key: hk.key,
      commandId: hk.commandId,
      commandType: hk.commandType,
      active: active,
      profile: getSelectedProfileId() || undefined,
    };
    const saveRes = await fetchWithAuth(`${API_BASE}/api/hotkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (saveRes.ok) {
      if (hotkeySettings.key === key) {
        hotkeySettings.active = active;
        applyHotkeySettings(); // تحديث الواجهة فوراً
        await updateHotkeyRegistration(); // إعادة تسجيل الاختصار أو إلغاءه
      } else {
        if (window.electronAPI && window.electronAPI.hotkey) {
          await window.electronAPI.hotkey.unregister(key);
          if (active) {
            await window.electronAPI.hotkey.register(
              hk.key,
              hk.commandId,
              hk.commandType,
            );
          }
        }
      }
      showMessage(`✅ ${active ? "تفعيل" : "إلغاء تفعيل"} الاختصار ${hk.key}`);
      await renderHotkeysList();
      await loadHotkeySettings(); // لتحديث hotkeySettings إذا تغير الاختصار النشط
    } else {
      showMessage("❌ فشل تحديث الحالة");
      cb.checked = !active;
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال");
    cb.checked = !active;
  }
}

function attachHotkeyDeleteEvents(tbody) {
  tbody.querySelectorAll(".hotkey-delete-btn").forEach((btn) => {
    btn.removeEventListener("click", handleDeleteClick);
    btn.addEventListener("click", handleDeleteClick);
  });
}

function attachHotkeyEditEvents(tbody) {
  tbody.querySelectorAll(".hotkey-edit-btn").forEach((btn) => {
    btn.removeEventListener("click", handleEditClick);
    btn.addEventListener("click", handleEditClick);
  });
}

async function handleEditClick(e) {
  const btn = e.currentTarget;
  const key = btn.dataset.key;
  const id = btn.dataset.id;
  const type = btn.dataset.type;
  const active = btn.dataset.active === "true";

  editingHotkeyId = id;

  const keyInput = document.getElementById("hotkeyKey");
  const displayEl = document.getElementById("hotkeyDisplay");
  const activeCheck = document.getElementById("hotkeyActive");
  const select = document.getElementById("hotkeyCommandSelect");

  if (keyInput) keyInput.value = key;
  if (displayEl) displayEl.textContent = key;
  if (activeCheck) activeCheck.checked = active;

  if (select) {
    const option = select.querySelector(
      `option[data-id="${id}"][data-type="${type}"]`,
    );
    if (option) {
      select.value = option.value;
    } else {
      showMessage("⚠️ الأمر غير موجود في القائمة (ربما محذوف)");
      return;
    }
  }

  hotkeySettings.key = key;
  hotkeySettings.commandId = id;
  hotkeySettings.commandType = type;
  hotkeySettings.active = active;

  const saveBtn = document.getElementById("saveHotkeyBtn");
  if (saveBtn) {
    saveBtn.textContent = "💾 تحديث الاختصار";
    saveBtn.style.backgroundColor = "#ff9800";
  }

  document
    .querySelector(".hotkey-settings")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(
    `✅ تم تحميل بيانات الاختصار "${key}" للتعديل. اضغط "تحديث الاختصار" لتطبيق التغييرات.`,
  );
}

async function handleDeleteClick(e) {
  const btn = e.currentTarget;
  const key = btn.dataset.key;

  const confirmed = await showConfirm(
    `هل تريد حذف الاختصار "${key}" نهائياً؟`,
    "حذف الاختصار",
  );
  if (!confirmed) return;

  try {
    const res = await fetchWithAuth(
      `${API_BASE}/api/hotkey/${encodeURIComponent(key)}${hotkeyProfileQuery()}`,
      { method: "DELETE" },
    );

    if (res.ok) {
      if (window.electronAPI && window.electronAPI.hotkey) {
        await window.electronAPI.hotkey.unregister(key);
      }
      // إزالة الاختصار من hotkeySettings إذا كان هو نفسه
      if (hotkeySettings.key === key) {
        hotkeySettings = {
          key: "",
          commandId: null,
          commandType: null,
          active: false,
        };
        // لا نستدعي clearHotkeyFormFields هنا، بل نترك loadHotkeySettings يعيد تعبئة الحقول
      }
      showMessage(`✅ تم حذف الاختصار ${key}`);
      await renderHotkeysList();
      await loadHotkeyCommands();
      // إعادة تحميل الإعدادات بالكامل لعرض الاختصار الجديد (أو فارغ)
      await loadHotkeySettings();
    } else {
      showMessage("❌ فشل حذف الاختصار");
    }
  } catch (err) {
    console.error(err);
    showMessage("❌ خطأ في الاتصال");
  }
}

// ===== معالج حفظ الاختصار من مودال الكيبورد =====
function handleSaveShortcut() {
  const key = document.getElementById("modalSelectedKey").value;
  const ctrl = document.getElementById("modalModCtrl").checked;
  const alt = document.getElementById("modalModAlt").checked;
  const shift = document.getElementById("modalModShift").checked;

  if (!key) {
    showMessage("⚠️ يرجى اختيار مفتاح");
    return;
  }

  // ✅ بناء الـ combo مع المعدلات ليتطابق مع ما تبنيه العملية الرئيسية في electron-main
  let combo = "";
  if (ctrl) combo += "Ctrl+";
  if (alt) combo += "Alt+";
  if (shift) combo += "Shift+";
  combo += key;

  // ✅ تعيين المفتاح في حقل Hotkey
  const hotkeyKeyInput = document.getElementById("hotkeyKey");
  const hotkeyDisplay = document.getElementById("hotkeyDisplay");

  if (hotkeyKeyInput) {
    hotkeyKeyInput.value = combo;
  }
  if (hotkeyDisplay) {
    hotkeyDisplay.textContent = combo;
  }

  // ✅ إغلاق المودال
  closeKeyboardShortcutModal();
  showMessage(`✅ تم اختيار المفتاح: ${combo}`);
}

// ===== ربط أحداث Hotkey =====
function setupHotkeyEvents() {
  // زر حفظ الإعدادات
  const saveBtn = document.getElementById("saveHotkeyBtn");
  if (saveBtn) {
    saveBtn.removeEventListener("click", saveHotkeySettings);
    saveBtn.addEventListener("click", () =>
      withButtonLock(saveBtn, saveHotkeySettings),
    );
  }

  // تغيير حالة التفعيل: لا يوجد حفظ تلقائي هنا حتى لا يُحفظ النموذج
  // قبل اكتماله — يُحفظ التفعيل مع زر الحفظ

  // ✅ ربط زر اختيار المفتاح
  const selectHotkeyBtn = document.getElementById("selectHotkeyBtn");
  if (selectHotkeyBtn) {
    selectHotkeyBtn.removeEventListener("click", openKeyboardShortcutModal);
    selectHotkeyBtn.addEventListener("click", function (e) {
      e.preventDefault();
      console.log("🔄 تم الضغط على زر اختيار مفتاح");
      openKeyboardShortcutModal("hotkeyKey");
    });
  }

  // ✅ ربط زر حفظ الاختصار في المودال
  const saveShortcutBtn = document.getElementById("saveKeyboardShortcutBtn");
  if (saveShortcutBtn) {
    saveShortcutBtn.removeEventListener("click", handleSaveShortcut);
    saveShortcutBtn.addEventListener("click", handleSaveShortcut);
  }

  // استقبال حدث تنفيذ Hotkey من Electron
  if (window.electronAPI && window.electronAPI.hotkey) {
    if (window._hotkeyExecuteListener) {
      window.electronAPI.hotkey.removeListener(
        "execute",
        window._hotkeyExecuteListener,
      );
    }
    window._hotkeyExecuteListener = (data) => {
      if (data.commandId && data.commandType) {
        console.log(
          `⚡ تنفيذ Hotkey للأمر: ${data.commandId} (${data.commandType})`,
        );
        executeCommand(data.commandId, data.commandType);
      }
    };
    window.electronAPI.hotkey.onExecute(window._hotkeyExecuteListener);
  }

  console.log("✅ تم ربط أحداث Hotkey");
}

// ===== تهيئة Hotkey =====
async function initHotkey() {
  console.log("🔄 تهيئة إعدادات Hotkey...");
  setupHotkeyEvents();
  await loadHotkeySettings();
  await loadHotkeyCommands();
  await renderHotkeysList();
  console.log("✅ تم تهيئة إعدادات Hotkey بنجاح");
}

// ============================================================
// دوال التنظيف والتهيئة
// ============================================================
function cleanupFrontend() {
  if (liveCheckInterval) {
    clearInterval(liveCheckInterval);
    liveCheckInterval = null;
  }
  if (subscriptionInterval) {
    clearInterval(subscriptionInterval);
    subscriptionInterval = null;
  }
  if (storageInterval) {
    clearInterval(storageInterval);
    storageInterval = null;
  }
  if (streamerTimer) {
    clearInterval(streamerTimer);
    streamerTimer = null;
  }
  if (window._captchaInterval) {
    clearInterval(window._captchaInterval);
    window._captchaInterval = null;
  }
  if (captchaObserver) {
    captchaObserver.disconnect();
    captchaObserver = null;
  }

  for (const [id, timer] of autoSaveTimers) {
    clearTimeout(timer);
  }
  autoSaveTimers.clear();

  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }

  if (frontendSocket) {
    frontendSocket.off();
    frontendSocket.disconnect();
    frontendSocket = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  if (currentAudioObj) {
    currentAudioObj.pause();
    currentAudioObj = null;
  }
  if (currentAudioObjGlobal) {
    currentAudioObjGlobal.pause();
    currentAudioObjGlobal = null;
  }
  if (typeof currentAudio !== "undefined" && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  window.onclick = null;
  if (closeOptionsListener) {
    document.removeEventListener("click", closeOptionsListener);
    closeOptionsListener = null;
  }

  importedCommands = [];
  duplicateCommands = [];
  nonDuplicateCommands = [];

  renderModalOptionsGlobal = null;
  audioModalGlobal = null;
  modalSearchGlobal = null;
  selectedFieldGlobal = null;
  hiddenInputGlobal = null;

  if (window._pendingFetchAbortController) {
    window._pendingFetchAbortController.abort();
    window._pendingFetchAbortController = null;
  }

  console.log("🧹 تم تنظيف جميع موارد الواجهة الأمامية");
}

async function init() {
  cleanupFrontend();
  await loadAudios();
  await ensureProfileLoaded();
  await loadGifts();
  updateInputsForType(document.getElementById("actionType").value || "gift");

  const actionTypeEl = document.getElementById("actionType");
  if (actionTypeEl) {
    actionTypeEl.addEventListener("change", (e) => {
      document.getElementById("giftChooserSection").style.display =
        e.target.value === "gift" ? "block" : "none";
    });
  }

  const giftDropdown = document.getElementById("giftDropdown");
  if (giftDropdown) {
    const observer = new MutationObserver(() => {
      if (giftDropdown.style.display === "block" && !giftsLoaded) {
        ensureGiftsLoaded();
        observer.disconnect();
      }
    });
    observer.observe(giftDropdown, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  setupCustomSelects();

  // رفع الصوت والفيديو
  document
    .getElementById("audioUploadInput")
    .addEventListener("change", async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("audio", file);
      showMessage("⏳ جاري رفع الصوت...");
      pendingUploads.audio = (async () => {
        try {
          const res = await fetchWithAuth(`${API_BASE}/api/upload-audio`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.success) {
            if (uploadsCancelled) {
              // الرفع أُلغي أثناء التنفيذ: نحذف الملف المؤقت فوراً
              deleteAudioFile(data.filename, true).catch(() => {});
              return;
            }
            tempUploadedFiles.audio = data.filename;
            await loadAudios();
            document.querySelector("#audioDropdown .selected").textContent =
              data.filename;
            document.getElementById("audioSelect").value = data.filename;
            showMessage("✅ تم رفع الصوت بنجاح");
          } else {
            showMessage("❌ فشل رفع الصوت: " + (data.message || ""));
          }
        } catch (err) {
          showMessage("❌ خطأ في الاتصال");
        } finally {
          pendingUploads.audio = null;
        }
      })();
    });

  document
    .getElementById("videoInput")
    .addEventListener("change", async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("video", file);
      showMessage("⏳ جاري رفع الفيديو...");
      pendingUploads.video = (async () => {
        try {
          const res = await fetchWithAuth(`${API_BASE}/api/upload-video`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.success) {
            if (uploadsCancelled) {
              // الرفع أُلغي أثناء التنفيذ: نحذف الملف المؤقت فوراً
              deleteVideoFile(data.filename, true).catch(() => {});
              return;
            }
            tempUploadedFiles.video = data.filename;
            document.getElementById("video").value = data.filename;
            document.getElementById("videoFileName").textContent =
              data.filename;
            showMessage("✅ تم رفع الفيديو بنجاح");
          } else {
            showMessage("❌ فشل رفع الفيديو: " + (data.message || ""));
          }
        } catch (err) {
          showMessage("❌ خطأ في الاتصال");
        } finally {
          pendingUploads.video = null;
        }
      })();
    });

  await connectFrontendSocket();
  await initHotkey();
  startStreamerUpdates();

  // ✅ طلب أولي للحالة
  checkLiveStatus();
}

init();

// ============================================================
// دوال إضافية
// ============================================================
function setSelectedKeyboardKey(keyText) {
  document
    .querySelectorAll(".kb-key")
    .forEach((el) => el.classList.remove("selected"));
  if (!keyText) return;
  let displayKey = keyText;
  if (keyText === "Space") displayKey = "␣";
  else if (keyText === "Backspace") displayKey = "⌫ Back";
  else if (keyText === "Enter") displayKey = "↵ Enter";
  else if (keyText === "Shift") displayKey = "⇧ Shift";
  else if (keyText === "Win") displayKey = "⊞ Win";
  else if (keyText === "Menu") displayKey = "☰";
  else if (keyText === "ArrowUp") displayKey = "↑";
  else if (keyText === "ArrowDown") displayKey = "↓";
  else if (keyText === "ArrowLeft") displayKey = "←";
  else if (keyText === "ArrowRight") displayKey = "→";
  const keys = document.querySelectorAll(".kb-key");
  for (let el of keys) {
    if (el.textContent.trim() === displayKey) {
      el.classList.add("selected");
      break;
    }
  }
}

function handleKeyClick(e) {
  const key = e.currentTarget;
  document
    .querySelectorAll(".kb-key")
    .forEach((el) => el.classList.remove("selected"));
  key.classList.add("selected");
  let keyText = key.textContent.trim();
  if (keyText === "⌫ Back") keyText = "Backspace";
  else if (keyText === "↵ Enter") keyText = "Enter";
  else if (keyText === "␣") keyText = "Space";
  else if (keyText === "⇧ Shift") keyText = "Shift";
  else if (keyText === "⊞ Win") keyText = "Win";
  else if (keyText === "☰") keyText = "Menu";
  else if (keyText === "↑") keyText = "ArrowUp";
  else if (keyText === "↓") keyText = "ArrowDown";
  else if (keyText === "←") keyText = "ArrowLeft";
  else if (keyText === "→") keyText = "ArrowRight";
  document.getElementById("modalSelectedKey").value = keyText;
  document.getElementById("modalSelectedKeyDisplay").textContent = keyText;
}

function openKeyboardShortcutModal(sourceInputId = "shortcutData") {
  const modal = document.getElementById("keyboardShortcutModal");
  if (!modal) return;
  const sourceInput = document.getElementById(sourceInputId);
  const currentShortcut = (sourceInput && sourceInput.value) || "";
  let key = "",
    ctrl = false,
    alt = false,
    shift = false;
  if (currentShortcut) {
    const parts = currentShortcut.split("+");
    key = parts.pop() || "";
    ctrl = parts.includes("Ctrl");
    alt = parts.includes("Alt");
    shift = parts.includes("Shift");
  }
  document.getElementById("modalSelectedKey").value = key;
  document.getElementById("modalSelectedKeyDisplay").textContent = key || "—";
  document.getElementById("modalModCtrl").checked = ctrl;
  document.getElementById("modalModAlt").checked = alt;
  document.getElementById("modalModShift").checked = shift;
  setSelectedKeyboardKey(key);
  document.querySelectorAll(".kb-key").forEach((el) => {
    el.removeEventListener("click", handleKeyClick);
    el.addEventListener("click", handleKeyClick);
  });
  modal.style.display = "flex";
}

function closeKeyboardShortcutModal() {
  const modal = document.getElementById("keyboardShortcutModal");
  if (modal) modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", function () {
  const clearBtn = document.getElementById("clearShortcutBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      document.getElementById("shortcutData").value = "";
      document.getElementById("shortcutDisplay").textContent = "لم يتم التعيين";
      currentShortcutCombo = "";
      document
        .querySelectorAll(".kb-key")
        .forEach((el) => el.classList.remove("selected"));
      updateClearShortcutButton();
    });
  }
  const openBtn = document.getElementById("openKeyboardShortcutBtn");
  if (openBtn) openBtn.addEventListener("click", openKeyboardShortcutModal);
  const saveShortcutBtn = document.getElementById("saveKeyboardShortcutBtn");
  if (saveShortcutBtn) {
    saveShortcutBtn.addEventListener("click", function () {
      const key = document.getElementById("modalSelectedKey").value;
      const ctrl = document.getElementById("modalModCtrl").checked;
      const alt = document.getElementById("modalModAlt").checked;
      const shift = document.getElementById("modalModShift").checked;
      if (!key) {
        showMessage("⚠️ يرجى اختيار مفتاح");
        return;
      }
      let combo = "";
      if (ctrl) combo += "Ctrl+";
      if (alt) combo += "Alt+";
      if (shift) combo += "Shift+";
      combo += key;
      document.getElementById("shortcutData").value = combo;
      document.getElementById("shortcutDisplay").textContent = combo;
      currentShortcutCombo = combo;
      updateClearShortcutButton();
      closeKeyboardShortcutModal();
      showMessage("✅ تم تعيين الاختصار: " + combo);
    });
  }
  const closeModalBtn = document.querySelector(
    "#keyboardShortcutModal .close-modal",
  );
  if (closeModalBtn)
    closeModalBtn.addEventListener("click", closeKeyboardShortcutModal);
});

// ============================================================
// دوال التنقل في القائمة الجانبية
// ============================================================
let startSection4 = document.getElementById("startSection4");
let allNav = document.querySelector(".all");
let startNav = document.querySelector(".start");
let actionNav = document.querySelector(".action");
let screensNav = document.querySelector(".screens");
let startSection = document.querySelector(".start-section");
let startSection2 = document.querySelector(".start-section-2");
let startSection3 = document.getElementById("startSection3");
const hotkeyNav = document.querySelector(".hotkey");
const startSectionHotkey = document.getElementById("startSectionHotkey");

if (hotkeyNav && startSectionHotkey) {
  hotkeyNav.onclick = function () {
    startSection.style.display = "none";
    startSection2.style.display = "none";
    startSection3.style.display = "none";
    if (startSection5) startSection5.style.display = "none"; // ← أضف
    if (startSection4) startSection4.style.display = "none";
    startSectionHotkey.style.display = "block";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    this.classList.add("active");
    loadHotkeyCommands();
    applyHotkeySettings();
  };
}

if (allNav) {
  allNav.onclick = function () {
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

    startSection.style.display = "block";
    startSection2.style.display = "block";
    startSection3.style.display = "block";
    if (startSectionHotkey) startSectionHotkey.style.display = "none";
    if (startSection5) startSection5.style.display = "none";
    if (currentUserRole === "admin") {
      startSection4.style.display = "block";
      if (typeof loadAdminDashboard === "function") loadAdminDashboard();
    } else {
      startSection4.style.display = "none";
    }
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    allNav.classList.add("active");
  };
}

if (allNav && !allNav.classList.contains("active")) {
  allNav.classList.add("active");
  startSection.style.display = "block";
  startSection2.style.display = "block";
  startSection3.style.display = "block";
  if (startSectionHotkey) startSectionHotkey.style.display = "none";
  if (currentUserRole === "admin") {
    startSection4.style.display = "block";
    if (typeof loadAdminDashboard === "function") loadAdminDashboard();
  } else {
    startSection4.style.display = "none";
  }
}

if (startNav) {
  startNav.onclick = function () {
    startSection.style.display = "block";
    startSection2.style.display = "none";
    startSection3.style.display = "none";
    if (startSectionHotkey) startSectionHotkey.style.display = "none";
    if (startSection5) startSection5.style.display = "none"; // ← أضف
    if (startSection4) startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    startNav.classList.add("active");
  };
}

if (actionNav) {
  actionNav.onclick = function () {
    startSection.style.display = "none";
    startSection2.style.display = "block";
    startSection3.style.display = "none";
    if (startSectionHotkey) startSectionHotkey.style.display = "none";
    if (startSection5) startSection5.style.display = "none"; // ← أضف
    if (startSection4) startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    actionNav.classList.add("active");
  };
}

if (screensNav) {
  screensNav.onclick = function () {
    startSection.style.display = "none";
    startSection2.style.display = "none";
    startSection3.style.display = "block";
    if (startSectionHotkey) startSectionHotkey.style.display = "none";
    if (startSection5) startSection5.style.display = "none"; // ← أضف
    if (startSection4) startSection4.style.display = "none";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    screensNav.classList.add("active");

    // ✅ هنا بدل ما يستدعيها دايماً، يستدعيها بس لو مش محملة
    if (!screensLoaded) {
      loadScreens();
    }
  };
}

const overlaysNav = document.querySelector(".overlays");
const startSection5 = document.getElementById("startSection5");

// إزالة محتوى الـ Overlay المحمّل عند مغادرة السيكشن —
// ستايلات لوحة التحكم المحقونة تؤثر على عرض باقي السيكشنات إن بقيت في الصفحة
function clearOverlayDashboard() {
  const c = document.getElementById("overlayDashboardContainer");
  if (c) c.innerHTML = "";
}
const _origStartNav = startNav.onclick;
startNav.onclick = function () {
  clearOverlayDashboard();
  _origStartNav.call(this);
};
const _origActionNav = actionNav.onclick;
actionNav.onclick = function () {
  clearOverlayDashboard();
  _origActionNav.call(this);
};
const _origScreensNav = screensNav.onclick;
screensNav.onclick = function () {
  clearOverlayDashboard();
  _origScreensNav.call(this);
};
const _origAllNav = allNav.onclick;
allNav.onclick = function () {
  clearOverlayDashboard();
  _origAllNav.call(this);
};
const _origHotkeyNav = hotkeyNav.onclick;
hotkeyNav.onclick = function () {
  clearOverlayDashboard();
  _origHotkeyNav.call(this);
};

if (overlaysNav) {
  overlaysNav.onclick = async function () {
    if (startSection) startSection.style.display = "none";
    if (startSection2) startSection2.style.display = "none";
    if (startSection3) startSection3.style.display = "none";
    if (startSection4) startSection4.style.display = "none";
    if (startSectionHotkey) startSectionHotkey.style.display = "none";
    startSection5.style.display = "block";
    document
      .querySelectorAll(".button-select-slide")
      .forEach((el) => el.classList.remove("active"));
    overlaysNav.classList.add("active");
    if (document.getElementById("listsPanelNative")) {
      loadOverlayTab("main");
    }
  };
}

// استماع للأحداث القادمة من المحتوى المحمّل (تبويبات الـ Overlay)
document.addEventListener("click", function (e) {
  const tabBtn = e.target.closest(".overlay-tab-btn");
  if (tabBtn) {
    const tab = tabBtn.dataset.tab;
    if (tab) {
      loadOverlayTab(tab);
    }
  }
});

// ============================================================
// دوال الاتصال بـ Socket.IO
// ============================================================
async function connectFrontendSocket() {
  try {
    if (frontendSocket) {
      frontendSocket.off();
      frontendSocket.disconnect();
      frontendSocket = null;
    }

    const token = getAuthToken();
    frontendSocket = io(API_BASE, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: { token },
    });

    let reconnectAttempts = 0;

    frontendSocket.on("connect", () => {
      console.log("✅ فرونت متصل بـ Socket.IO");
      reconnectAttempts = 0;
      checkLiveStatus(); // ✅ طلب أولي فقط
      fetchWithAuth(`${API_BASE}/api/auth/me`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.user) {
            frontendSocket.emit("join-room", { room: `user-${data.user.id}` });
          }
        })
        .catch((err) => console.warn("فشل جلب userId", err));
    });

    // ===== ✅ مستمع التحديث الفوري لحالة البث =====
    frontendSocket.on("live-status-updated", (data) => {
      console.log("📡 [LIVE] استلام تحديث فوري:", data);

      const connectBtn = document.getElementById("send-usertik");
      const connectText = document.getElementById("connect-text");
      const tiktokDisplay = document.getElementById("tiktok-display");
      const userInput = document.getElementById("user-tiktok");
      const connectProfile = document.getElementById("connect-profile-aside");
      const tiktokDisplayAside = document.getElementById(
        "tiktok-display-aside",
      );

      if (data.isLive) {
        // ===== حالة الاتصال =====
        isLiveConnected = true;
        connectBtn.textContent = "Disconnect";
        connectBtn.style.backgroundColor = "#f44336";
        connectText.textContent = "Connected";
        connectText.style.color = "#1dd9e6e1";
        if (data.username) {
          tiktokDisplay.textContent = data.username;
          if (userInput) userInput.value = data.username;
          if (tiktokDisplayAside)
            tiktokDisplayAside.textContent = data.username;
        }
        if (connectProfile) {
          connectProfile.style.pointerEvents = "none";
          connectProfile.style.opacity = 0.6;
        }
      } else {
        // ===== حالة قطع الاتصال =====
        isLiveConnected = false;
        connectBtn.textContent = "Connect to TikTok LIVE";
        connectBtn.style.backgroundColor = "";
        connectText.textContent = "Disconnected";
        connectText.style.color = "red";
        if (tiktokDisplay) tiktokDisplay.textContent = "";
        if (tiktokDisplayAside) tiktokDisplayAside.textContent = "";
        if (connectProfile) {
          connectProfile.style.pointerEvents = "auto";
          connectProfile.style.opacity = 1;
        }
        updateStreamerImages(true);
      }
    });

    // ===== ✅ مستمع الإشعارات الفورية من الأدمن =====
    frontendSocket.on("new-notification", (notification) => {
      const dismissed = getDismissedNotifications();
      if (!dismissed.includes(notification._id)) {
        showNotification(notification);
      }
    });

    frontendSocket.on("notification-updated", (notification) => {
      // إذا كان الإشعار المعروض حالياً هو نفسه، نحدثه
      if (currentNotification && currentNotification._id === notification._id) {
        if (
          notification.isActive &&
          new Date() < new Date(notification.expiresAt)
        ) {
          showNotification(notification);
        } else {
          hideNotification();
        }
      } else {
        // إذا لم يكن معروضاً، نتحقق من أنه جديد ونعرضه إن لم يكن مغلقاً
        fetchAndShowNotification();
      }
    });

    frontendSocket.on("notification-deleted", (data) => {
      if (currentNotification && currentNotification._id === data.id) {
        hideNotification();
      }
    });

    frontendSocket.on("play-sound", async (payload) => {
      if (payload.id && payload.id === lastPlayedSoundId) return;
      lastPlayedSoundId = payload.id;
      try {
        if (!payload || !payload.filename) return;
        const finalUrl = safeMediaUrl(payload.filename, "audio");
        if (!finalUrl) {
          console.warn("⚠️ تم تجاهل رابط صوت غير آمن:", payload.filename);
          return;
        }
        await tryUnlockAudio();
        const audio = new Audio(finalUrl);
        audio.volume = Math.min(1, Math.max(0, (payload.volume || 100) / 100));
        audio.crossOrigin = "anonymous";
        await audio.play();
        console.log(`🔊 تم تشغيل الصوت في الفرونت: ${finalUrl}`);
      } catch (err) {
        console.warn("❌ فشل تشغيل الصوت في الفرونت:", err.message);
      }
    });

    frontendSocket.on("connect_error", (err) => {
      console.warn("⚠️ خطأ في اتصال Socket.IO (فرونت):", err.message);
    });

    frontendSocket.on("disconnect", (reason) => {
      console.log(`❌ فرونت قطع اتصال Socket.IO: ${reason}`);
      if (isEditingUsername) return;
      if (reason === "io server disconnect") {
        frontendSocket.connect();
        return;
      }
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      setTimeout(() => {
        reconnectAttempts++;
        frontendSocket.connect();
      }, delay);
    });

    frontendSocket.on("error", (err) => {
      console.error("❌ خطأ في Socket.IO:", err.message);
    });
  } catch (err) {
    console.error("❌ فشل إنشاء اتصال Socket.IO (فرونت):", err.message);
  }
}

async function tryUnlockAudio() {
  if (audioUnlocked) return true;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    audioUnlocked = true;
    return true;
  } catch (e) {
    console.warn("فشل فتح الصوت:", e);
    return false;
  }
}

// ============================================================
// دوال تحديث صور البث
// ============================================================
async function updateStreamerImages(force = false) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/streamer`);
    if (!res.ok) return;
    const data = await res.json();
    const img1 = document.getElementById("liveOwnerImg1");
    const img2 = document.getElementById("liveOwnerImg2");
    const nicknameEl = document.getElementById("liveOwnerText");
    if (!img1 || !img2 || !nicknameEl) return;
    let currentPicture = "images/img1.jpg";
    let currentNickname = "Stream Moon";
    if (data.isLive) {
      if (data.profilePicture) currentPicture = data.profilePicture;
      if (data.nickname) currentNickname = data.nickname;
    }
    img1.src = currentPicture;
    img2.src = currentPicture;
    nicknameEl.textContent = currentNickname;
  } catch (err) {
    console.error("❌ خطأ في updateStreamerImages:", err);
  }
}

// استبدال الاستدعاء الأولي في init (أو في أي مكان) بما يلي:
function startStreamerUpdates() {
  if (streamerTimer) clearInterval(streamerTimer);
  streamerTimer = setInterval(() => updateStreamerImages(), 10000); // كل 10 ثوانٍ بدلاً من 1 ثانية
  updateStreamerImages(); // تشغيل فوري
}

// ============================================================
// دوال مساعدة إضافية
// ============================================================
function clearAudio() {
  if (tempUploadedFiles.audio) {
    deleteAudioFile(tempUploadedFiles.audio, true)
      .then(() => {
        tempUploadedFiles.audio = null;
      })
      .catch(() => {});
    document.getElementById("audioSelect").value = "";
    document.querySelector("#audioDropdown .selected").textContent =
      "اختر صوت...";
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    return;
  }

  if (editingId && editingType) {
    const body = { audio: "" };
    const url =
      editingType === "gift"
        ? `${GIFT_API}/${editingId}`
        : `${INTERACT_API}/${editingId}`;
    fetchWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(() => {
        showMessage("✅ تم إزالة الصوت من الأمر");
        document.getElementById("audioSelect").value = "";
        document.querySelector("#audioDropdown .selected").textContent =
          "اختر صوت...";
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }
      })
      .catch(() => showMessage("❌ فشل تحديث الأمر"));
    return;
  }

  document.getElementById("audioSelect").value = "";
  document.querySelector("#audioDropdown .selected").textContent =
    "اختر صوت...";
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
}

function clearVideo() {
  if (tempUploadedFiles.video) {
    deleteVideoFile(tempUploadedFiles.video, true)
      .then(() => {
        tempUploadedFiles.video = null;
        document.getElementById("video").value = "";
        document.getElementById("videoInput").value = "";
        document.getElementById("videoPreview").innerHTML = "";
        document.getElementById("videoFileName").textContent = "";
      })
      .catch(() => {});
    return;
  }

  if (editingId && editingType) {
    const videoFileName = document.getElementById("video").value;
    if (!videoFileName) return;
    const url =
      editingType === "gift"
        ? `${GIFT_API}/${editingId}`
        : `${INTERACT_API}/${editingId}`;
    fetchWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: "" }),
    })
      .then(() => {
        showMessage("✅ تم إزالة الفيديو من الأمر");
        document.getElementById("video").value = "";
        document.getElementById("videoInput").value = "";
        document.getElementById("videoPreview").innerHTML = "";
        document.getElementById("videoFileName").textContent = "";
        checkStorageNotifications();
      })
      .catch(() => showMessage("❌ فشل تحديث الأمر"));
    return;
  }

  document.getElementById("video").value = "";
  document.getElementById("videoInput").value = "";
  document.getElementById("videoPreview").innerHTML = "";
  document.getElementById("videoFileName").textContent = "";
}

function confirmDeleteAll() {
  const profileId = getSelectedProfileId();
  if (!profileId) {
    showMessage("⚠️ لم يتم تحديد بروفايل");
    return;
  }
  const profileName = profileNames[profileId] || `Profile ${profileId}`;
  showConfirm(
    `هل تريد حذف جميع أوامر البروفايل "${profileName}" نهائياً؟`,
    "حذف البروفايل",
  ).then((confirmed) => {
    if (confirmed) deleteAll();
  });
}

function closeModal() {
  const modal = document.getElementById("deleteModal");
  if (!modal) return;
  const content = modal.querySelector(".modal-content");
  if (content) content.innerHTML = "";
  modal.style.display = "none";
}

async function deleteAll() {
  try {
    const profileId = getSelectedProfileId();
    if (!profileId) {
      showMessage("⚠️ لازم تختار Profile قبل الحذف");
      closeModal();
      return;
    }
    const profileQuery = `?profile=${encodeURIComponent(profileId)}`;
    const [gRes, iRes] = await Promise.all([
      fetchWithAuth(`${GIFT_API}${profileQuery}`, { method: "DELETE" }),
      fetchWithAuth(`${INTERACT_API}${profileQuery}`, { method: "DELETE" }),
    ]);
    const gJson = await safeJsonOrText(gRes);
    const iJson = await safeJsonOrText(iRes);
    let ok = true;
    let messages = [];
    if (!gRes.ok) {
      ok = false;
      messages.push(`حذف الهدايا فشل: ${gRes.status} ${String(gJson)}`);
    } else {
      const deleted =
        gJson && (gJson.deletedCount || gJson.deletedCount === 0)
          ? gJson.deletedCount
          : null;
      messages.push(
        `الهدايا: ${deleted !== null ? deleted + " محذوف(ة)" : "تم (راجع السجل)"}`,
      );
    }
    if (!iRes.ok) {
      ok = false;
      messages.push(`حذف التفاعلات فشل: ${iRes.status} ${String(iJson)}`);
    } else {
      const deleted =
        iJson && (iJson.deletedCount || iJson.deletedCount === 0)
          ? iJson.deletedCount
          : null;
      messages.push(
        `التفاعلات: ${deleted !== null ? deleted + " محذوف(ة)" : "تم (راجع السجل)"}`,
      );
    }
    if (ok)
      showMessage(
        `🗑 تم حذف أوامر Profile ${profileId} — ${messages.join(" | ")}`,
      );
    else showMessage(`⚠️ حصلت مشاكل أثناء الحذف — راجع الكونسول`);
    await loadCommands();
    await checkStorageNotifications();
    closeModal();
  } catch (err) {
    console.error("خطأ أثناء deleteAll:", err);
    showMessage("❌ خطأ أثناء الحذف");
    closeModal();
  }
}

async function safeJsonOrText(res) {
  try {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch (e) {
      return txt;
    }
  } catch (e) {
    return String(e);
  }
}

async function ensureProfileLoaded(retries = 5, delayMs = 400) {
  if (currentUserSelectedProfile) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/profiles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("فشل جلب البروفايلات");
      const j = await res.json();
      const profiles = j && j.profiles ? j.profiles : [];
      if (profiles.length > 0) {
        const exists = profiles.some(
          (p) => p.id === currentUserSelectedProfile,
        );
        if (exists) {
          const labelEl = document.getElementById("current-profile-label");
          const nameDisplayEl = document.getElementById(
            "current-profile-name-display",
          );
          if (labelEl)
            labelEl.textContent = `Profile ${currentUserSelectedProfile}`;
          if (nameDisplayEl) {
            nameDisplayEl.textContent =
              profileNames[currentUserSelectedProfile] ||
              `Profile ${currentUserSelectedProfile}`;
          }
          renderProfileSelect(profiles, currentUserSelectedProfile);
          return;
        }
      }
    } catch (err) {
      console.warn("⚠️ فشل تحميل البروفايلات:", err.message);
    }
  }

  const lbl = document.getElementById("current-profile-label");
  if (lbl && lbl.textContent && /\d+/.test(lbl.textContent)) return;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/profiles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`فشل جلب البروفايلات (${res.status})`);
      const j = await res.json();
      const profiles = j && j.profiles ? j.profiles : [];
      if (profiles.length > 0) {
        const labelEl = document.getElementById("current-profile-label");
        const firstProfile = profiles[0].id;
        if (labelEl) labelEl.textContent = `Profile ${firstProfile}`;
        profileNames = {};
        profiles.forEach((p) => {
          profileNames[p.id] = p.name;
        });
        renderProfileSelect(profiles, firstProfile);
        return;
      }
    } catch (err) {
      console.warn(`⚠️ محاولة ${i + 1} فشلت:`, err.message);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const fallbackLabel = document.getElementById("current-profile-label");
  if (
    fallbackLabel &&
    (!fallbackLabel.textContent || !/\d+/.test(fallbackLabel.textContent))
  ) {
    fallbackLabel.textContent = "Profile 1";
    setTimeout(() => ensureProfileLoaded(3, 500), 2000);
  }
}

// ============================================================
// بدء التطبيق
// ============================================================
updateAuthUI();
checkLiveStatus();

// ============================================================
// مودالات المصادقة والدفع
// ============================================================
const loginModal = document.getElementById("login-modal");
const registerModal = document.getElementById("register-modal");
const paymentModal = document.getElementById("paymentModal");

document.getElementById("login-btn").onclick = () =>
  (loginModal.style.display = "flex");
document.getElementById("register-btn").onclick = () =>
  (registerModal.style.display = "flex");
document.getElementById("close-login").onclick = () =>
  (loginModal.style.display = "none");
document.getElementById("close-register").onclick = () =>
  (registerModal.style.display = "none");
document.getElementById("close-payment").onclick = () =>
  (paymentModal.style.display = "none");

window.onclick = (e) => {
  if (e.target === loginModal) loginModal.style.display = "none";
  if (e.target === registerModal) registerModal.style.display = "none";
  if (e.target === paymentModal) paymentModal.style.display = "none";
};

function renderPayPalButton() {
  const container = document.getElementById("paypal-button-container");
  if (!container) return;
  container.innerHTML = "";
  if (!selectedPlanId) {
    container.innerHTML = '<p style="color:#aaa;">اختر خطة أولاً</p>';
    return;
  }
  if (typeof paypal === "undefined") {
    document.getElementById("payment-message").textContent =
      "PayPal SDK not loaded. Please refresh.";
    return;
  }
  currentPayPalButton = paypal.Buttons({
    style: {
      shape: "rect",
      color: "blue",
      layout: "vertical",
      label: "paypal",
    },
    createSubscription: (data, actions) =>
      actions.subscription.create({ plan_id: selectedPlanId }),
    onApprove: async (data, actions) => {
      const subscriptionId = data.subscriptionID;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/paypal/subscription-created`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscriptionId, planType: selectedPlan }),
          },
        );
        const result = await res.json();
        if (result.success) {
          alert("✅ تم تفعيل الاشتراك بنجاح! سيتم تحديث الصفحة.");
          location.reload();
        } else {
          alert(
            "❌ فشل تفعيل الاشتراك: " + (result.message || "خطأ غير معروف"),
          );
        }
      } catch (err) {
        alert("❌ خطأ في الاتصال بالخادم");
      }
    },
    onError: (err) => {
      console.error("PayPal error:", err);
      document.getElementById("payment-message").textContent =
        "حدث خطأ أثناء الدفع. حاول مرة أخرى.";
    },
  });
  currentPayPalButton.render("#paypal-button-container");
}

document.querySelectorAll(".plan-card").forEach((card) => {
  card.addEventListener("click", () => {
    document
      .querySelectorAll(".plan-card")
      .forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedPlan = card.dataset.plan;
    selectedPlanId = card.dataset.planId;
    renderPayPalButton();
  });
});

document.getElementById("upgrade-btn").onclick = () => {
  // داخل Electron: الدفع في نافذة معزولة بدون صلاحيات Node (أمان PayPal)
  if (window.electronAPI && window.electronAPI.openPaymentWindow) {
    window.electronAPI.openPaymentWindow(getAuthToken());
    return;
  }
  // fallback للمتصفح فقط: النافذة القديمة داخل التطبيق
  paymentModal.style.display = "flex";
  selectedPlan = null;
  selectedPlanId = null;
  document
    .querySelectorAll(".plan-card")
    .forEach((c) => c.classList.remove("selected"));
  document.getElementById("paypal-button-container").innerHTML = "";
  document.getElementById("payment-message").textContent = "";
};

// بعد إغلاق نافذة الدفع المعزولة: تحديث حالة الاشتراك تلقائياً
if (window.electronAPI) {
  try {
    require("electron").ipcRenderer.on("payment-closed", async () => {
      await updateAuthUI();
      showMessage("🔄 تم تحديث حالة الاشتراك");
    });
  } catch {}
}

// --- التحقق من قوة كلمة المرور (نفس قواعد الباك اند) ---
function validatePasswordStrength(password) {
  if (typeof password !== "string" || password.length === 0)
    return { valid: false, message: "أدخل كلمة المرور" };
  if (password.length < 8)
    return { valid: false, message: "❌ يجب أن تكون 8 أحرف على الأقل" };
  if (!/[a-z]/.test(password))
    return { valid: false, message: "❌ أضف حرفاً صغيراً (a-z)" };
  // ❌ تم إزالة شرط الحرف الكبير
  // if (!/[A-Z]/.test(password))
  //   return { valid: false, message: "❌ أضف حرفاً كبيراً (A-Z)" };
  if (!/\d/.test(password))
    return { valid: false, message: "❌ أضف رقماً (0-9)" };
  if (!/[^A-Za-z0-9]/.test(password))
    return { valid: false, message: "❌ أضف رمزاً خاصاً (!@#$%...)" };
  return { valid: true, message: "✅ كلمة المرور قوية" };
}

const registerPasswordInput = document.getElementById("register-password");
const registerSubmitBtn = document.getElementById("register-submit");
const registerMsg = document.getElementById("register-message");

if (registerPasswordInput) {
  registerPasswordInput.addEventListener("input", () => {
    const result = validatePasswordStrength(registerPasswordInput.value);
    registerMsg.textContent = result.message;
    registerMsg.style.color = result.valid ? "#4caf50" : "#ff6b6b";
  });
}

// ===== إظهار / إخفاء كلمة المرور =====
function setupPasswordToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "🙈" : "👁";
  });
}
setupPasswordToggle("login-password", "login-password-toggle");
setupPasswordToggle("register-password", "register-password-toggle");

function setBtnBusy(btn, busy, busyText) {
  if (!btn) return;
  btn.disabled = busy;
  btn.style.opacity = busy ? "0.6" : "1";
  btn.style.pointerEvents = busy ? "none" : "auto";
  if (busy) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = busyText || "⏳ جارٍ المعالجة...";
  } else if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
  }
}

document.getElementById("login-submit").onclick = async function () {
  const btn = this;
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-message");
  setBtnBusy(btn, true, "⏳ جارٍ تسجيل الدخول...");
  // مسح أي توكن/كوكيز قديم من جلسة سابقة قبل تسجيل الدخول
  // حتى لا يُستخدم توكن مرفوض في أول طلب بعد الـ reload
  saveAuthToken(null);
  try {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  } catch {}
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    const data = await res.json();
    if (data.success) {
      // إزالة توكن الحساب السابق أولاً حتى لا تختلط الحسابات عند تعددها
      saveAuthToken(null);
      saveAuthToken(data.token || getCookie("token"));
      const token = getAuthToken();
      if (token) {
        await bindAgent(token);
        console.log("✅ تم ربط الـ Agent بالتوكن");
      }
      // الصفحة هتعيد التحميل فوراً — لا داعي لانتظار تحديث الواجهة هنا
      // (كان يسبب تعليقاً ورسائل خطأ مؤقتة قبل الـ reload)
      loginModal.style.display = "none";
      msg.textContent = "";
      window.location.reload();
    } else {
      msg.textContent = data.message || "فشل تسجيل الدخول";
    }
  } catch (err) {
    msg.textContent = "خطأ في الاتصال بالخادم";
  } finally {
    setBtnBusy(btn, false);
  }
};

document.getElementById("register-submit").onclick = async function () {
  const btn = this;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  const msg = document.getElementById("register-message");
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    msg.style.color = "#ff6b6b";
    msg.textContent = strength.message;
    return;
  }
  // التحقق من تأكيد كلمة المرور
  const confirmPassword = document.getElementById(
    "register-confirm-password",
  ).value;
  if (password !== confirmPassword) {
    msg.style.color = "#ff6b6b";
    msg.textContent = "❌ كلمتا المرور غير متطابقتين";
    return;
  }
  setBtnBusy(btn, true, "⏳ جارٍ إنشاء الحساب...");
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    const data = await res.json();
    if (data.success) {
      // إزالة توكن الحساب السابق أولاً حتى لا تختلط الحسابات عند تعددها
      saveAuthToken(null);
      saveAuthToken(data.token || getCookie("token"));
      const token = getAuthToken();
      if (token) {
        bindAgent(token);
        console.log("✅ تم ربط الـ Agent بالتوكن");
      }
      await updateAuthUI();
      registerModal.style.display = "none";
      msg.textContent = "";
      window.location.reload();
    } else {
      msg.style.color = "#ff6b6b";
      msg.textContent = data.message || "فشل إنشاء الحساب";
    }
  } catch (err) {
    msg.style.color = "#ff6b6b";
    msg.textContent = "خطأ في الاتصال بالخادم";
  } finally {
    setBtnBusy(btn, false);
  }
};

document.getElementById("logout-btn").onclick = async function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = "⏳ جاري الخروج...";
  // نداء الخروج من الخادم - ولو فشل نكمل التنظيف محلياً في كل الأحوال
  // حتى لا يعود التطبيق لفتح الحساب السابق عند تعدد الحسابات
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.warn(
      "⚠️ تعذر الوصول للخادم أثناء الخروج - تنظيف محلي:",
      err.message,
    );
  }
  try {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  } catch {}
  saveAuthToken(null); // إزالة التوكن المخزن دائماً - أساسي لفصل الحسابات
  bindAgent(null);
  window.location.reload();
};

document.getElementById("delete-account-btn").onclick = async () => {
  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف حسابك؟ هذا الإجراء لا يمكن التراجع عنه.",
    "حذف الحساب",
  );
  if (!confirmed) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/delete`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (data.success) {
      bindAgent(null);
      updateAuthUI();
      window.location.reload();
    } else alert(data.message || "فشل حذف الحساب");
  } catch (err) {
    alert("خطأ في الاتصال");
  }
};

// ============================================================
// ربط المستمعين الإضافيين
// ============================================================
window.addEventListener("beforeunload", () => {
  if (isLiveConnected) {
    fetchWithAuth(`${API_BASE}/api/tiktok-disconnect`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }
  cleanupFrontend();
});

document
  .getElementById("cardOverlay")
  ?.addEventListener("click", checkForChangesAndClose);

const overlayCheckbox = document.getElementById("showOverlayCheckbox");
const overlayTextGroup = document.getElementById("overlayTextGroup");
if (overlayCheckbox && overlayTextGroup) {
  overlayCheckbox.addEventListener("change", (e) => {
    overlayTextGroup.style.display = e.target.checked ? "block" : "none";
  });
}

// ============================================================
// مراقبة CAPTCHA
// ============================================================
function setupCaptchaWatcher() {
  let captchaActive = false;
  const checkCaptcha = () => {
    const detected = isCaptchaVisible();
    if (detected && !captchaActive) {
      captchaActive = true;
      console.log("🔴 CAPTCHA detected!");
      if (frontendSocket && frontendSocket.connected) {
        frontendSocket.emit("captcha-detected", {
          url: window.location.href,
          timestamp: Date.now(),
        });
      }
      showMessage("⚠️ تم اكتشاف CAPTCHA، يرجى حلها في النافذة المنبثقة");
    } else if (!detected && captchaActive) {
      captchaActive = false;
      console.log("✅ CAPTCHA cleared!");
      if (frontendSocket && frontendSocket.connected) {
        frontendSocket.emit("captcha-cleared", {
          url: window.location.href,
          timestamp: Date.now(),
        });
      }
      showMessage("✅ تم حل CAPTCHA، استئناف العمل");
    }
  };

  // إلغاء أي مراقب سابق
  if (captchaObserver) {
    captchaObserver.disconnect();
    captchaObserver = null;
  }

  captchaObserver = new MutationObserver(() => {
    checkCaptcha();
  });
  captchaObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "aria-hidden"],
  });

  // استخدم setInterval بدلاً من setInterval مكرر، لكننا سنستخدم مؤقتاً واحداً
  // يمكن استخدام setInterval بفاصل 2 ثانية بدلاً من 2 ثانية (نفس الفاصل السابق)
  if (window._captchaInterval) clearInterval(window._captchaInterval);
  window._captchaInterval = setInterval(checkCaptcha, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  setupCaptchaWatcher();
});

// ربط القوائم المنسدلة المخصصة (Custom Select) لأنواع الأوامر
function setupCustomSelects() {
  document.querySelectorAll(".custom-select .selected").forEach((selected) => {
    selected.removeEventListener("click", handleSelectClick);
    selected.addEventListener("click", handleSelectClick);
  });

  document.querySelectorAll(".custom-select .options li").forEach((li) => {
    li.removeEventListener("click", handleOptionClick);
    li.addEventListener("click", handleOptionClick);
  });

  // إغلاق القائمة عند النقر خارجها
  document.removeEventListener("click", closeCustomSelects);
  document.addEventListener("click", closeCustomSelects);
}

function handleSelectClick(e) {
  e.stopPropagation();
  const parent = this.closest(".custom-select");
  if (parent) {
    parent.classList.toggle("open");
  }
}

function handleOptionClick(e) {
  const parent = this.closest(".custom-select");
  if (parent) {
    const selectedSpan = parent.querySelector(".selected span");
    if (selectedSpan) {
      selectedSpan.textContent = this.textContent;
    }
    const hiddenInput = document.getElementById("actionType");
    if (hiddenInput) {
      hiddenInput.value = this.dataset.value;
    }
    // تحديث حقول الإدخال حسب النوع
    updateInputsForType(this.dataset.value);
    parent.classList.remove("open");
  }
}

function closeCustomSelects(e) {
  document.querySelectorAll(".custom-select.open").forEach((el) => {
    if (!el.contains(e.target)) {
      el.classList.remove("open");
    }
  });
}

// ============================================================
// دالة تنقية روابط الصور - منع XSS عبر javascript: و data:text/html
// ============================================================
function safeImageUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  // السماح فقط بروابط http/https أو data:image (صور base64)
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  // رفض أي رابط آخر (javascript:, vbscript:, data:text/html, etc.)
  console.warn("⚠️ تم رفض رابط صورة غير آمن:", trimmed.substring(0, 50));
  return "images/default.jpg"; // رابط افتراضي آمن
}

// ============================================================
// دالة تنقية روابط الصوت والفيديو - منع XSS عبر Audio/Video
// ============================================================
function safeMediaUrl(url, type = "audio") {
  if (!url) return "";
  const trimmed = String(url).trim();

  // السماح بمسارات /audios/ و /videos/ الخاصة بالتطبيق
  if (type === "audio" && trimmed.startsWith("/audios/")) {
    return API_BASE + trimmed;
  }
  if (type === "video" && trimmed.startsWith("/videos/")) {
    return API_BASE + trimmed;
  }

  // السماح بروابط http/https فقط
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  console.warn(`⚠️ تم رفض رابط ${type} غير آمن:`, trimmed.substring(0, 50));
  return "";
}

// ============================================================
// تصدير الدوال المستخدمة في onclick داخل HTML إلى النطاق العام
// (بعد التحويل للـ bytecode أصبح الكود يعمل كـ module وليس script)
// ============================================================
[
  showAddCard,
  hideAddCard,
  confirmAdd,
  checkForChangesAndClose,
  clearAudio,
  clearVideo,
  closeModal,
  deleteAll,
  confirmDeleteAll,
  confirmDisconnect,
  closeDisconnectModal,
  closeKeyboardShortcutModal,
  moveRowUp,
  moveRowDown,
  showMessage,
  typeof loadOverlayTab !== "undefined" ? loadOverlayTab : null,
].forEach((fn) => {
  if (typeof fn === "function") window[fn.name] = fn;
});

// ============================================================
// إشعارات الأدمن
// ============================================================
let currentNotification = null;
let notificationTimer = null;

function getDismissedNotifications() {
  try {
    return JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
  } catch {
    return [];
  }
}

function addDismissedNotification(id) {
  const list = getDismissedNotifications();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem("dismissedNotifications", JSON.stringify(list));
  }
}

async function fetchAndShowNotification() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/notifications/active`);
    const data = await res.json();
    if (data.success && data.notifications.length > 0) {
      const dismissed = getDismissedNotifications();
      // نعرض أول إشعار لم يتم إغلاقه
      const active = data.notifications.find((n) => !dismissed.includes(n._id));
      if (active) {
        showNotification(active);
      } else {
        hideNotification();
      }
    } else {
      hideNotification();
    }
  } catch (err) {
    console.warn("Failed to fetch notifications:", err);
  }
}

function showNotification(notification) {
  // إزالة أي إشعار سابق
  hideNotification();

  currentNotification = notification;

  const bar = document.createElement("div");
  bar.id = "adminNotificationBar";
  bar.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #dc3545;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 99999;
    max-width: 90%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 16px;
    font-weight: bold;
    direction: rtl;
  `;

  const textSpan = document.createElement("span");
  textSpan.textContent = notification.text;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "✕";
  closeBtn.style.cssText = `
    background: transparent;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    padding: 0 8px;
    line-height: 1;
  `;
  closeBtn.onclick = function () {
    addDismissedNotification(notification._id);
    hideNotification();
  };

  bar.appendChild(textSpan);
  bar.appendChild(closeBtn);
  document.body.appendChild(bar);

  // نضبط مؤقتاً لتحديث الإشعارات عند انتهاء المدة
  clearInterval(notificationTimer);
  notificationTimer = setInterval(() => {
    if (
      currentNotification &&
      new Date() > new Date(currentNotification.expiresAt)
    ) {
      hideNotification();
      clearInterval(notificationTimer);
      // نبحث عن إشعار آخر
      fetchAndShowNotification();
    }
  }, 5000);
}

function hideNotification() {
  const bar = document.getElementById("adminNotificationBar");
  if (bar) bar.remove();
  clearInterval(notificationTimer);
  currentNotification = null;
}