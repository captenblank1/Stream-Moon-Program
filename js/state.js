// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
// الحالة المركزية: كل متغير عليوي أصبح خاصية في __S
// ✅ إدارة حالة ذكية: __S أصبح Proxy تفاعلي — أي كتابة تشعل الاشتراكات.
// كل الكود القائم (`__S.x = ...`) يعمل كما هو بدون أي تغيير، ويصبح قابلاً
// للمراقبة عبر Store (subscribe/computed/inflight/persist).
import { createStore } from "./store.js";

const __SRaw = {};
const { proxy: __S, store: Store } = createStore(__SRaw);
// المتغيرات العامة تكتب على الوكيل مباشرة (اشتراكات فارغة أثناء الإقلاع = بلا كلفة)
__S.WIDGET_BASE = "https://www.streammoon.net";
__S._BK = [44, 145, 71, 109, 179, 94];
__S._BE = [
  68, 229, 51, 29, 192, 100, 3, 190, 37, 12, 208, 53, 73, 255, 35, 64, 132, 54,
  70, 169, 105, 2, 221, 44, 73, 255, 35, 8, 193, 112, 79, 254, 42,
];
__S.io = undefined;
__S.isLiveConnected = false;
__S.sessionConflictHit = false;
__S.liveCheckInterval = null;
__S.liveStatusCheckInProgress = false;
__S.lastEnteredUsername = "";
__S.pendingUsername = null;
__S.profileNames = {};
__S.currentCommandModalMode = null;
__S.importedCommands = [];
__S.importedHotkeys = [];
__S.currentProfileHotkeys = [];
__S.duplicateCommands = [];
__S.nonDuplicateCommands = [];
__S.audioUploadInProgress = false;
__S.videoUploadInProgress = false;
__S.saveInProgress = false;
__S.currentUserPlan = "free";
__S.currentUserPlanType = null;
__S.currentUserRole = "user";
__S.currentUserId = null;
__S.selectedPlan = null;
__S.selectedPlanId = null;
__S.currentPayPalButton = null;
__S.subscriptionInterval = null;
__S.storageInterval = null;
__S.currentUserSelectedProfile = 1;
__S.currentShortcutCombo = "";
__S.globalAudios = [];
__S.originalFormValues = {};
__S.giftsLoaded = false;
__S.gifts = [];
__S.existingCommandsMap = new Map();
__S.saveTimeout = null;
__S.searchTimeout = null;
__S.tempUploadedFiles = { audio: null, video: null };
__S.pendingUploads = { audio: null, video: null };
__S.uploadsCancelled = false;
__S.frontendSocket = null;
__S.audioCtx = null;
__S.audioUnlocked = false;
__S.lastPlayedSoundId = null;
__S.closeOptionsListener = null;
__S.currentAudioObj = null;
__S.isEditingUsername = false;
__S.editingId = null;
__S.editingType = null;
__S.pendingActiveState = true;
__S.pendingPlaySound = true;
__S.pendingPlayVideo = true;
__S.videoWasCleared = false;
__S.currentAudio = null;
__S.renderModalOptionsGlobal = null;
__S.audioModalGlobal = null;
__S.modalSearchGlobal = null;
__S.selectedFieldGlobal = null;
__S.hiddenInputGlobal = null;
__S.currentAudioObjGlobal = null;
__S.giftsLoadingPromise = null;
__S.autoSaveTimers = new Map();
__S.editingHotkeyId = null;
__S.streamerTimer = null;
__S.captchaObserver = null;
__S.screensLoaded = false;
__S.hotkeySectionLoaded = false;
__S.hotkeySettings = {
  key: "",
  commandId: null,
  commandType: null,
  active: false,
};
__S.hotkeyListenerAttached = false;
__S._pluginStatusListenersBound = false;
__S.CAPTCHA_SELECTORS = [
  "#captcha-verify-image",
  "#captcha_container",
  "div[id^='captcha']",
  ".captcha_verify_action",
  "iframe[src*='captcha']",
];
__S.commandsTablePending = null;
__S.hotkeysListRendered = false;
__S.hotkeysListPending = null;
__S.overlayFloatHome = null;
__S.overlayFloatKind = null;
__S.winsPanelInitDone = false;
__S.listsPanelInitDone = false;
__S.listsRetryTimer = null;
__S.HOTKEY_VALID_KEYS = [
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
  // مفاتيح النام باد — نفس التسمية التي يوحّد بها electron-main الأكواد
  "Num0",
  "Num1",
  "Num2",
  "Num3",
  "Num4",
  "Num5",
  "Num6",
  "Num7",
  "Num8",
  "Num9",
  "Num.",
  "Num-",
  "Num/",
  "NumEnter",
  "+",
  "*",
];
__S.hotkeyStatusTimer = null;
__S.hotkeyCmdLoadChain = null;
__S.hotkeyRenderChain = null;
__S.startSection4 = document.getElementById("startSection4");
__S.allNav = document.querySelector(".all");
__S.startNav = document.querySelector(".start");
__S.actionNav = document.querySelector(".action");
__S.screensNav = document.querySelector(".screens");
__S.startSection = document.querySelector(".start-section");
__S.startSection2 = document.querySelector(".start-section-2");
__S.startSection3 = document.getElementById("startSection3");
__S.hotkeyNav = document.querySelector(".hotkey");
__S.startSectionHotkey = document.getElementById("startSectionHotkey");
__S.overlaysNav = document.querySelector(".overlays");
__S.startSection5 = document.getElementById("startSection5");
__S.loginModal = document.getElementById("login-modal");
__S.registerModal = document.getElementById("register-modal");
__S.paymentModal = document.getElementById("paymentModal");
__S.registerPasswordInput = document.getElementById("register-password");
__S.registerSubmitBtn = document.getElementById("register-submit");
__S.registerMsg = document.getElementById("register-message");
__S.overlayCheckbox = document.getElementById("showOverlayCheckbox");
__S.overlayTextGroup = document.getElementById("overlayTextGroup");
__S.currentNotification = null;
__S.notificationTimer = null;
__S.activeNotificationBars = new Map();
__S.blockScreenShown = false;
__S.CONTACT_URLS = {
  discord: "https://discord.com/users/1162740483609608224",
  tiktok: "https://www.tiktok.com/@ashura_1q",
};

// --- النص الأصلي لقسم المتغيرات (دوال مثل withButtonLock تُصدَّر أدناه) ---
// ============================================================
// المتغيرات العامة
// ============================================================

// 🔒 حراسة الجلسة الواحدة: صار الحساب/اليوزر مطروداً لأنه فُتح من جهاز آخر








 // اختصارات ملف .tfc عند "اضافة البروفايل"
 // اختصارات البروفايل الحالي (للكشف عن المكرر)




// قفل الحفظ لمنع تكرار إنشاء الأوامر عند الضغط المتكرر على زر الحفظ


// قفل أي زر أثناء تنفيذ مهمة غير متزامنة لمنع التنفيذ المكرر
async function withButtonLock(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.style.opacity = 0.6;
  btn.style.pointerEvents = "none";
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
    // ملاحظة: لا نسترجع نص الزر القديم — العملية قد تكون غيرته لحالة نهائية
    // (مثل Connect → Disconnect) واسترجاعه كان يخفي الحالة الجديدة
  }
}



















// عمليات الرفع الجارية — الحفظ ينتظرها قبل قراءة أسماء الملفات

// يُفعّل عند إلغاء الرفع وإغلاق البطاقة حتى لا تُستخدم نتيجة الرفع










// حالة تفعيل الأمر أثناء التعديل — الحفظ يحافظ عليها بدل تفعيلها قسراً
// (التحكم الطبيعي فيها من صندوق الصف في قايمة الأوامر)

// ✅ حالة الصوت والفيديو أثناء التعديل — إذا كان الصوت/الفيديو أو التفعيل
// مقفلاً (متوقفاً) قبل التعديل يجب ألا يعود يعمل تلقائياً بعد الحفظ


















// ============================================================
// إعدادات Hotkey
// ============================================================
// تم تحميل بيانات الهوت كي عند فتح البرنامج — التنقل للقسم يصبح فورياً










// ✅ إصلاح ترتيب التهيئة: config.js قد يُقيَّم بعد state.js (دوائر استيراد)
// لذا API_BASE والمشتقات getters كسولة تُحسم عند أول استخدام فعلي
(function () {
  let apiBase, giftApi, interactApi, resolved = false;
  function resolveApi() {
    if (resolved) return;
    resolved = true;
    apiBase = (typeof window !== "undefined" && window.API_BASE) || "";
    giftApi = apiBase + "/api/gift-commands";
    interactApi = apiBase + "/api/interaction-commands";
  }
  Object.defineProperty(__S, "API_BASE", { get() { resolveApi(); return apiBase; }, configurable: true });
  Object.defineProperty(__S, "GIFT_API", { get() { resolveApi(); return giftApi; }, configurable: true });
  Object.defineProperty(__S, "INTERACT_API", { get() { resolveApi(); return interactApi; }, configurable: true });
})();
// مكشوفة على __S أيضاً — tiktok.js/rcon.js/hotkeys.js تستدعيها عبر __S.withButtonLock
__S.withButtonLock = withButtonLock;
export { withButtonLock, Store };
export default __S;
