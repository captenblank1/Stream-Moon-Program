// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { updateAuthUI } from "./auth-flow.js";
import { checkLiveStatus } from "./live-status.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { waitForProActivation } from "./utils-core.js";
import { getAuthToken } from "./pairing.js";
import { saveAuthToken } from "./pairing.js";
import { getDeviceId } from "./utils-core.js";
import { getCookie } from "./utils-core.js";
import { bindAgent } from "./auth-flow.js";
import { showConfirm } from "./utils-core.js";

// ============================================================
// بدء التطبيق
// ============================================================
updateAuthUI();
checkLiveStatus();

// ============================================================
// مودالات المصادقة والدفع
// ============================================================




document.getElementById("login-btn").onclick = () =>
  (__S.loginModal.style.display = "flex");
document.getElementById("register-btn").onclick = () =>
  (__S.registerModal.style.display = "flex");
document.getElementById("close-login").onclick = () =>
  (__S.loginModal.style.display = "none");
document.getElementById("close-register").onclick = () =>
  (__S.registerModal.style.display = "none");
document.getElementById("close-payment").onclick = () =>
  (__S.paymentModal.style.display = "none");

window.onclick = (e) => {
  if (e.target === __S.loginModal) __S.loginModal.style.display = "none";
  if (e.target === __S.registerModal) __S.registerModal.style.display = "none";
  if (e.target === __S.paymentModal) __S.paymentModal.style.display = "none";
};

function renderPayPalButton() {
  const container = document.getElementById("paypal-button-container");
  if (!container) return;
  container.innerHTML = "";
  if (!__S.selectedPlanId) {
    container.innerHTML = '<p style="color:#aaa;">اختر خطة أولاً</p>';
    return;
  }
  if (typeof paypal === "undefined") {
    document.getElementById("payment-message").textContent =
      "PayPal SDK not loaded. Please refresh.";
    return;
  }
  __S.currentPayPalButton = paypal.Buttons({
    style: {
      shape: "rect",
      color: "blue",
      layout: "vertical",
      label: "paypal",
    },
    createSubscription: (data, actions) =>
      actions.subscription.create({ plan_id: __S.selectedPlanId }),
    onApprove: async (data, actions) => {
      const subscriptionId = data.subscriptionID;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/paypal/subscription-created`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscriptionId, planType: __S.selectedPlan }),
          },
        );
        const result = await res.json();
        if (result.success) {
          // الدفع يُسجَّل PENDING والتأكيد النهائي يصل من PayPal بعد لحظات —
          // ننتظر التفعيل الفعلي ثم تظهر نافذة البرو تلقائيًا (بدون reload فوري)
          showMessage(
            "<i class='fas fa-spinner fa-spin'></i> تم استلام الدفع — جاري تأكيد التفعيل...",
          );
          waitForProActivation();
        } else {
          alert(
            "<i class='fas fa-circle-xmark'></i> فشل تفعيل الاشتراك: " +
              (result.message || "خطأ غير معروف"),
          );
        }
      } catch (err) {
        alert("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال بالخادم");
      }
    },
    onError: (err) => {
      console.error("PayPal error:", err);
      document.getElementById("payment-message").textContent =
        "حدث خطأ أثناء الدفع. حاول مرة أخرى.";
    },
  });
  __S.currentPayPalButton.render("#paypal-button-container");
}

document.querySelectorAll(".plan-card").forEach((card) => {
  card.addEventListener("click", () => {
    document
      .querySelectorAll(".plan-card")
      .forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    __S.selectedPlan = card.dataset.plan;
    __S.selectedPlanId = card.dataset.planId;
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
  __S.paymentModal.style.display = "flex";
  __S.selectedPlan = null;
  __S.selectedPlanId = null;
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
      showMessage("<i class='fas fa-rotate'></i> تم تحديث حالة الاشتراك");
    });
  } catch {}
}

// --- التحقق من قوة كلمة المرور (نفس قواعد الباك اند) ---
function validatePasswordStrength(password) {
  if (typeof password !== "string" || password.length === 0)
    return { valid: false, message: "أدخل كلمة المرور" };
  if (password.length < 8)
    return {
      valid: false,
      message:
        "<i class='fas fa-circle-xmark'></i> يجب أن تكون 8 أحرف على الأقل",
    };
  if (!/[a-z]/.test(password))
    return {
      valid: false,
      message: "<i class='fas fa-circle-xmark'></i> أضف حرفاً صغيراً (a-z)",
    };
  // ❌ تم إزالة شرط الحرف الكبير
  // if (!/[A-Z]/.test(password))
  //   return { valid: false, message: "❌ أضف حرفاً كبيراً (A-Z)" };
  if (!/\d/.test(password))
    return {
      valid: false,
      message: "<i class='fas fa-circle-xmark'></i> أضف رقماً (0-9)",
    };
  if (!/[^A-Za-z0-9]/.test(password))
    return {
      valid: false,
      message: "<i class='fas fa-circle-xmark'></i> أضف رمزاً خاصاً (!@#$%...)",
    };
  return {
    valid: true,
    message: "<i class='fas fa-circle-check'></i> كلمة المرور قوية",
  };
}





if (__S.registerPasswordInput) {
  __S.registerPasswordInput.addEventListener("input", () => {
    const result = validatePasswordStrength(__S.registerPasswordInput.value);
    __S.registerMsg.textContent = result.message;
    __S.registerMsg.style.color = result.valid ? "#4caf50" : "#ff6b6b";
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
    toggle.innerHTML = show
      ? '<i class="fas fa-eye-slash"></i>'
      : '<i class="fas fa-eye"></i>';
  });
}
setupPasswordToggle("login-password", "login-password-toggle");
setupPasswordToggle("register-password", "register-password-toggle");
setupPasswordToggle("register-confirm-password", "register-confirm-toggle");

function setBtnBusy(btn, busy, busyText) {
  if (!btn) return;
  btn.disabled = busy;
  btn.style.opacity = busy ? "0.6" : "1";
  btn.style.pointerEvents = busy ? "none" : "auto";
  if (busy) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML =
      busyText || "<i class='fas fa-spinner fa-spin'></i> جارٍ المعالجة...";
  } else if (btn.dataset.originalText) {
    btn.innerHTML = btn.dataset.originalText;
  }
}

document.getElementById("login-submit").onclick = async function () {
  const btn = this;
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-message");
  setBtnBusy(
    btn,
    true,
    "<i class='fas fa-spinner fa-spin'></i> جارٍ تسجيل الدخول...",
  );
  // مسح أي توكن/كوكيز قديم من جلسة سابقة قبل تسجيل الدخول
  // حتى لا يُستخدم توكن مرفوض في أول طلب بعد الـ reload
  saveAuthToken(null);
  try {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  } catch {}
  try {
    const res = await fetch(`${__S.API_BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-id": getDeviceId(),
      },
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
      __S.loginModal.style.display = "none";
      msg.textContent = "";
      window.location.reload();
    } else {
      msg.textContent = data.message || "فشل تسجيل الدخول";
    }
  } catch (err) {
    msg.textContent = "خطأ في الاتصال بالخادم";
    console.error("خطأ الاتصال:", err);
  } finally {
    setBtnBusy(btn, false);
  }
};

document.getElementById("login-modal")?.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    (e.target.id === "login-email" || e.target.id === "login-password")
  ) {
    e.preventDefault();
    document.getElementById("login-submit")?.click();
  }
});

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
    msg.innerHTML =
      "<i class='fas fa-circle-xmark'></i> كلمتا المرور غير متطابقتين";
    return;
  }
  setBtnBusy(
    btn,
    true,
    "<i class='fas fa-spinner fa-spin'></i> جارٍ إنشاء الحساب...",
  );
  try {
    const res = await fetch(`${__S.API_BASE}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-id": getDeviceId(),
      },
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
      __S.registerModal.style.display = "none";
      msg.textContent = "";
      window.location.reload();
    } else {
      msg.style.color = "#ff6b6b";
      msg.textContent = data.message || "فشل إنشاء الحساب";
    }
  } catch (err) {
    msg.style.color = "#ff6b6b";
    msg.textContent = "خطأ في الاتصال بالخادم";
    console.error("خطأ الاتصال:", err);
  } finally {
    setBtnBusy(btn, false);
  }
};

document.getElementById("register-modal")?.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    [
      "register-email",
      "register-password",
      "register-confirm-password",
    ].includes(e.target.id)
  ) {
    e.preventDefault();
    document.getElementById("register-submit")?.click();
  }
});

document.getElementById("logout-btn").onclick = async function () {
  const btn = this;
  btn.disabled = true;
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> جاري الخروج...";
  // نداء الخروج من الخادم - ولو فشل نكمل التنظيف محلياً في كل الأحوال
  // حتى لا يعود التطبيق لفتح الحساب السابق عند تعدد الحسابات
  try {
    await fetch(`${__S.API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.warn(
      "<i class='fas fa-triangle-exclamation'></i> تعذر الوصول للخادم أثناء الخروج - تنظيف محلي:",
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

// زر حذف الحساب أُزيل من الواجهة — الكود محفوظ للرجوع إليه لو احتاج لاحقاً
const _deleteAccountBtn = document.getElementById("delete-account-btn");
if (_deleteAccountBtn)
  _deleteAccountBtn.onclick = async () => {
    const confirmed = await showConfirm(
      "هل أنت متأكد من حذف حسابك؟ هذا الإجراء لا يمكن التراجع عنه.",
      "حذف الحساب",
    );
    if (!confirmed) return;
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/auth/delete`, {
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


export { renderPayPalButton, validatePasswordStrength, setupPasswordToggle, setBtnBusy };
