// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { fetchWithAuth, showMessage, showConfirm } from "./utils-core.js";
import { updateStreamerImages } from "./streamer.js";
import { checkLiveStatus } from "./live-status.js";
import { updateUIForDisconnected } from "./live-status.js";

// ============================================================
// دوال الاتصال بـ TikTok
// ============================================================

// ✅ ترجمة حالات الزر/النص الديناميكية — الكود كان يكتب نصوصاً إنجليزية
// ثابتة فتنقلب الواجهة للإنجليزية بعد أول ضغطة حتى لو اللغة عربية.
// السلاسل الأساسية هنا إنجليزية (مثل HTML الأصلي) وt() تترجمها للعربية
// عند lang=ar عبر قاموس EN2AR — فتبقى الواجهة بلغة المستخدم دائماً.
const t = (s) => (window.AppI18n ? AppI18n.t(s) : s);

// إعادة تفعيل زر الاتصال والمنطقة الجانبية بعد انتهاء أي انتظار —
// مسار واحد بدل تكرار نفس الأسطر في كل فرع (كانت فروع تنساها فعلًا)
function unlockConnectUI() {
  const connectBtn = document.getElementById("send-usertik");
  const connectProfile = document.getElementById("connect-profile-aside");
  const connectText = document.getElementById("connect-text");
  __S.connectInProgress = false;
  clearTimeout(__S.connectResultTimeout);
  if (connectBtn) {
    connectBtn.disabled = false;
    connectBtn.style.opacity = 1;
  }
  if (connectProfile) {
    connectProfile.style.pointerEvents = "auto";
    connectProfile.style.opacity = 1;
  }
  return connectText;
}

// نص الزر حسب الحالة واللغة الحالية — لا لقطات (snapshot) مخزنة:
// كانت اللقطة تُلتقط بعد تحول الزر إلى Disconnect فتعلق عليها للأبد
function setConnectBtnState(state) {
  const btn = document.getElementById("send-usertik");
  if (!btn) return;
  if (state === "disconnect") {
    btn.textContent = t("Disconnect");
    btn.style.backgroundColor = "#f44336";
  } else {
    btn.textContent = t("Connect to TikTok LIVE");
    btn.style.backgroundColor = "";
  }
}

function setConnectText(text, color) {
  const el = document.getElementById("connect-text");
  if (!el) return;
  el.textContent = t(text);
  el.style.color = color;
}

async function performDisconnect(silent = false) {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tiktok-disconnect`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`فشل الاتصال: ${res.status}`);
    const data = await res.json();
    if (data.success) {
      if (!silent)
        showMessage("<i class='fas fa-circle-check'></i> تم قطع الاتصال");
      __S.isLiveConnected = false;
      setConnectBtnState("connect");
      setConnectText("Disconnected", "red");
      const aside = document.getElementById("connect-profile-aside");
      if (aside) {
        aside.style.pointerEvents = "auto";
        aside.style.opacity = 1;
      }
      updateStreamerImages(true);
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل قطع الاتصال: " +
          (escapeHtml(data.message || "خطأ غير معروف")),
      );
    }
  } catch (err) {
    console.error(err);
    showMessage(
      "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال بالسيرفر (تعذر قطع الاتصال)",
    );
  }
}

async function performConnect(username) {
  if (!username) return;
  // ✅ الحفظ التلقائي (كتابة/Enter/blur) قد يطلق الاتصال أثناء محاولة
  // جارية — كان يرسل طلباً ثانياً يفشل فوراً على السيرفر ويعرض رسالة
  // "غير متصل" بينما المحاولة الأولى لم تنته بعد
  if (__S.connectInProgress) return;

  const connectBtn = document.getElementById("send-usertik");
  const connectProfile = document.getElementById("connect-profile-aside");

  connectBtn.disabled = true;
  connectProfile.style.pointerEvents = "none";
  connectBtn.style.opacity = 0.6;
  connectProfile.style.opacity = 0.6;
  setConnectText("Connecting...", "orange");

  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tiktok-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    const connectFailMessage = data.message || null;

    // ✅ 409: يوجد اتصال نشط بالفعل (جهاز آخر أو محاولة جارية) — ليست
    // فشلاً؛ نزامن الواجهة مع حالة السيرفر بدل رسالة خطأ مخيفة
    if (data && data.conflict) {
      unlockConnectUI();
      await checkLiveStatus();
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          escapeHtml(connectFailMessage || "يوجد اتصال نشط لهذا الحساب بالفعل"),
      );
      return;
    }

    // السيرفر رد صراحةً أن الحساب غير لايف — عرض الرسالة فوراً بدل انتظار دورة الفحص
    if (data.success && data.connected === false) {
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          (escapeHtml(connectFailMessage || "الحساب غير متصل أو ليس لايف")),
      );
      unlockConnectUI();
      setConnectBtnState("connect");
      setConnectText("Disconnected", "red");
      __S.isLiveConnected = false;
      updateStreamerImages(true);
      return;
    }

    if (data.success) {
      // ✅ النتيجة الفعلية تصل عبر سوكت tiktok-connect-result فور اكتمال
      // الاتصال — كان هنا استطلاع كل ثانية (بطيء محلياً) مع تجاهل السوكت
      // والزر كان يُفتح للنقر أثناء الاتصال
      __S.connectInProgress = true;
      // ✅ لا تخزن رسالة "جاري الاتصال..." كرسالة فشل — كانت تُعرض
      // لاحقاً كسبب فشل إن وصلت نتيجة سلبية بلا رسالة من السيرفر
      window.__connectFailMessage = null;
      // شبكة أمان: لو السوكت لم يصل خلال 90 ثانية نعيد تفعيل الزر
      // (سلسلة القنوات مع MongoDB بطيء قد تتجاوز الدقيقة)
      clearTimeout(__S.connectResultTimeout);
      __S.connectResultTimeout = setTimeout(() => {
        if (__S.connectInProgress) {
          unlockConnectUI();
          setConnectBtnState("connect");
          setConnectText("Disconnected", "red");
          showMessage(
            "<i class='fas fa-hourglass-half'></i> انتهت مهلة انتظار نتيجة الاتصال — حاول مرة أخرى",
          );
        }
      }, 90000);
      // ❌ بلا checkLiveStatus هنا: السيرفر لم يكمل الاتصال بعد فيرد
      // isLive:false فتومض الواجهة "غير متصل" — نتيجة السوكت كافية
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل تعيين اسم المستخدم: " +
          (escapeHtml(data.message || "خطأ غير معروف")),
      );
      unlockConnectUI();
      setConnectBtnState("connect");
      setConnectText("Disconnected", "red");
      __S.isLiveConnected = false;
    }
    updateStreamerImages(true);
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال بالسيرفر");
    unlockConnectUI();
    setConnectBtnState("connect");
    setConnectText("Disconnected", "red");
    __S.isLiveConnected = false;
  }
}

// كونفيرم قطع الاتصال عبر الموديل العام (showConfirm) — لا يوجد موديل منفصل
async function showDisconnectConfirm(usernameForConnect = null) {
  const confirmed = await showConfirm(
    "هل تريد قطع الاتصال بالبث المباشر؟",
    "قطع الاتصال",
  );
  if (confirmed) await confirmDisconnect();
  else __S.pendingUsername = null;
}

function closeDisconnectModal() {
  // بقي للتوافق مع الاستدعاءات القديمة — الموديل المنفصل أُزيل
  __S.pendingUsername = null;
}

async function confirmDisconnect() {
  closeDisconnectModal();
  // واجهة فورية: الحالة تتغير في نفس اللحظة قبل انتظار الخادم
  __S.isLiveConnected = false;
  updateUIForDisconnected();
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tiktok-disconnect`, {
      method: "POST",
    });
    if (res.ok) {
      showMessage("<i class='fas fa-circle-check'></i> تم قطع الاتصال");
      updateStreamerImages(true);
    } else {
      // ✅ إظهار سبب الفشل الحقيقي من السيرفر بدل رسالة عامة
      const errData = await res.json().catch(() => ({}));
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل قطع الاتصال: " +
          escapeHtml(errData.message || `خطأ ${res.status}`),
      );
    }
  } catch (err) {
    console.error(err);
    showMessage(
      "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال بالسيرفر (تعذر قطع الاتصال)",
    );
  }
  if (__S.pendingUsername) {
    await performConnect(__S.pendingUsername);
    __S.pendingUsername = null;
  }
}

document.getElementById("send-usertik").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  // ✅ قفل فعلي طوال الاتصال: من الضغطة الأولى حتى وصول النتيجة من
  // السيرفر — كان withButtonLock يفتح الزر بمجرد رد الطلب الأول فيبدو
  // غير مقفول بينما الاتصال ما زال جارياً في الخلفية
  if (__S.connectBtnBusy) return;
  if (__S.connectInProgress) {
    showMessage(
      "<i class='fas fa-spinner fa-spin'></i> الاتصال جارٍ بالفعل — انتظر النتيجة",
    );
    return;
  }
  __S.connectBtnBusy = true;
  try {
    const username = document.getElementById("user-tiktok").value.trim();
    __S.lastEnteredUsername = username;
    // ✅ القرار من متغير الحالة فقط — المقارنة بنص الزر "Disconnect"
    // كانت تنكسر في الواجهة العربية (النص "قطع الاتصال") فيضغط المتصل
    // المتصل فيحصل على خطأ تعارض بدل نافذة القطع
    if (__S.isLiveConnected) {
      await showDisconnectConfirm(username);
    } else {
      if (!username) {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> الرجاء إدخال اسم المستخدم",
        );
        return;
      }
      await performConnect(username);
      // الاتصال لسه جارياً (النتيجة تصل عبر سوكت)؟ الزر يبقى مقفولاً
      // حتى تصل النتيجة أو تنتهي مهلة الشبكة الأمان
      if (__S.connectInProgress) {
        const connectProfile =
          document.getElementById("connect-profile-aside");
        btn.disabled = true;
        btn.style.opacity = 0.6;
        if (connectProfile) {
          connectProfile.style.pointerEvents = "none";
          connectProfile.style.opacity = 0.6;
        }
      }
    }
  } finally {
    __S.connectBtnBusy = false;
    // لا تفتح الزر إذا كان الاتصال لا يزال جارياً — النتيجة تفتحه
    if (!__S.connectInProgress) {
      btn.disabled = false;
      btn.style.opacity = "";
    }
  }
});

// ✅ استرجاع نص الزر الأصلي كما ترسمه الترجمة — النصوص الثابتة
// كانت تقلب لغة الزر للإنجليزية بعد أي فشل/قطع اتصال
function resetConnectBtnText() {
  setConnectBtnState("connect");
}

// ✅ معالجة نتيجة الكونكت الواردة من السوكت — تحديث فوري للواجهة
function handleConnectResult(data) {
  unlockConnectUI();

  if (data && data.connected) {
    setConnectText("Connected", "#1dd9e6e1");
    setConnectBtnState("disconnect");
    __S.isLiveConnected = true;
    checkLiveStatus();
    updateStreamerImages(true);
  } else if (data && data.cancelled) {
    // ✅ أُلغيت المحاولة بقطع اتصال من المستخدم — ليست فشلاً ولا رسالة
    // خطأ؛ الواجهة أصلًا في حالة "غير متصل" من مسار القطع نفسه
    setConnectBtnState("connect");
    setConnectText("Disconnected", "red");
    __S.isLiveConnected = false;
  } else {
    const msg =
      (data && data.message) ||
      window.__connectFailMessage ||
      "الحساب غير متصل أو ليس لايف";
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> " + escapeHtml(msg),
    );
    setConnectText("Disconnected", "red");
    setConnectBtnState("connect");
    __S.isLiveConnected = false;
  }
}

// ✅ حفظ تلقائي لليوزر (يُخزن في السيرفر عبر /api/tiktok-user):
// التوقف عن الكتابة أو الخروج من الحقل = حفظ الاسم فقط — والاتصال من
// الزر أو Enter فقط. كان الحفظ يطلق اتصالاً كاملاً فيمنع أول ضغطة زر:
// النقر يخرج من الحقل (blur) فيبدأ الاتصال ويعطل الزر قبل هبوط
// الكليك نفسه — فالضغطة الأولى تضيع ولازم يضغط مرتين
(() => {
  const input = document.getElementById("user-tiktok");
  if (!input) return;
  let saveTimer = null;
  const saveUsername = async () => {
    const username = input.value.trim();
    if (!username || username === __S.lastEnteredUsername) return;
    if (__S.connectInProgress) return;
    __S.lastEnteredUsername = username;
    try {
      await fetchWithAuth(`${__S.API_BASE}/api/tiktok-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, connect: false }),
      });
    } catch (e) {}
  };
  const connectNow = () => {
    const username = input.value.trim();
    if (!username) return;
    if (__S.connectInProgress || __S.connectBtnBusy) return;
    __S.lastEnteredUsername = username;
    performConnect(username);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(saveTimer);
      connectNow();
    }
  });
  input.addEventListener("blur", () => {
    clearTimeout(saveTimer);
    saveUsername();
  });
  input.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveUsername, 1000);
  });
})();

export { performDisconnect, performConnect, handleConnectResult, showDisconnectConfirm, closeDisconnectModal, confirmDisconnect, unlockConnectUI, setConnectBtnState };
