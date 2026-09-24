// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { fetchWithAuth } from "./utils-core.js";
import { showConfirm } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { getCookie } from "./utils-core.js";
import { getDeviceId } from "./utils-core.js";

// ============================================================
// دوال إدارة الاقتران (Pairing)
// ============================================================

// التحقق من حالة الاقتران وعرض/إخفاء العناصر
async function checkPluginStatus() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/plugin-status`);
    const data = await res.json();
    const isPaired = data.success && data.connected === true;

    const inputGroup = document.getElementById("unpairedHint");
    const pairedActions = document.getElementById("pairedActions");
    const statusSpan = document.getElementById("pluginConnectionStatus");

    if (isPaired) {
      inputGroup.style.display = "none";
      pairedActions.style.display = "flex";
      if (statusSpan) {
        statusSpan.innerHTML = '<i class="fas fa-circle-check"></i> مقترن';
        statusSpan.style.color = "#4caf50";
      }
    } else {
      inputGroup.style.display = "block";
      pairedActions.style.display = "none";
      if (statusSpan) {
        statusSpan.innerHTML = '<i class="fas fa-circle-xmark"></i> غير مقترن';
        statusSpan.style.color = "#f44336";
      }
    }
  } catch (err) {
    console.warn("فشل التحقق من حالة الاقتران:", err);
    // في حالة الخطأ نعرض التلميح للاحتياط
    document.getElementById("unpairedHint").style.display = "block";
    document.getElementById("pairedActions").style.display = "none";
  }
}

// فك الربط — البلوجن يُربط تلقائياً مجدداً بمجرد مطابقة بيانات ماين كرافت
document
  .getElementById("unpairPluginBtn")
  .addEventListener("click", async function () {
    const confirmed = await showConfirm(
      "سيتم فك ارتباط البلوجن بحسابك الحالي، وسيرتبط تلقائياً مجدداً عند الضغط على Send ببيانات مطابقة. هل تريد المتابعة؟",
      "فك الربط",
    );
    if (!confirmed) return;

    const resultDiv = document.getElementById("pairingResult");
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/plugin-unpair`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-check"></i> تم فك الربط — اضغط Send ببيانات مطابقة لإعادة الربط تلقائياً';
        resultDiv.style.color = "#4caf50";
        await checkPluginStatus();
        showMessage('<i class="fas fa-lock-open"></i> تم فك الربط');
      } else {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-xmark"></i> ' +
          (escapeHtml(data.message || "فشل فك الربط"));
        resultDiv.style.color = "#f44336";
      }
    } catch (err) {
      resultDiv.innerHTML =
        '<i class="fas fa-circle-xmark"></i> خطأ في الاتصال بالخادم';
      resultDiv.style.color = "#f44336";
    }
  });

// ============================================================
// تحميل البلوجن المخصص — نسخة فيها توكن الحساب مدمج داخل الـ jar
// ============================================================
document
  .getElementById("downloadPluginBtn")
  ?.addEventListener("click", async function () {
    const btn = this;
    const resultDiv = document.getElementById("pairingResult");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحميل...';
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/plugin-download`);
      if (!res.ok) {
        let msg = "فشل التحميل من الخادم";
        try {
          const d = await res.json();
          if (d.message) msg = d.message;
        } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      // اسم الملف من header Content-Disposition إن وُجد
      let filename = "StreamMoon.jar";
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (m && m[1]) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (resultDiv) {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-check"></i> تم تحميل البلوجن — ضعه في مجلد plugins بالسيرفر';
        resultDiv.style.color = "#4caf50";
      }
      showMessage('<i class="fas fa-circle-check"></i> تم تحميل البلوجن بنجاح');
    } catch (err) {
      console.error("خطأ في تحميل البلوجن:", err);
      if (resultDiv) {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-xmark"></i> ' +
          (escapeHtml(err.message || "خطأ في الاتصال بالخادم"));
        resultDiv.style.color = "#f44336";
      }
      showMessage(
        '<i class="fas fa-circle-xmark"></i> ' +
          (escapeHtml(err.message || "فشل تحميل البلوجن")),
      );
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

// استدعاء التحقق من حالة الاقتران عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
  checkPluginStatus();
  // يمكن استدعاؤها أيضاً بعد تسجيل الدخول
});

// ============================================================
// الربط اليدوي بالكود — الحالة الثانية عندما يفشل الربط التلقائي
// الكود يظهر في كونسول سيرفر ماينكرافت (/streammoon code)
// ============================================================
document
  .getElementById("pairWithCodeBtn")
  ?.addEventListener("click", async function () {
    const input = document.getElementById("pairCodeInput");
    const code = (input?.value || "").trim();
    const resultDiv = document.getElementById("pairingResult");
    if (!code) {
      if (resultDiv) {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-exclamation"></i> اكتب streammoon code الظاهر في كونسول السيرفر ثم انسخ الكود هنا';
        resultDiv.style.color = "#f44336";
      }
      return;
    }
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/plugin-pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        if (input) input.value = "";
        if (resultDiv) {
          resultDiv.innerHTML =
            '<i class="fas fa-circle-check"></i> تم ربط البلوجن بحسابك بنجاح';
          resultDiv.style.color = "#4caf50";
        }
        showMessage('<i class="fas fa-link"></i> تم ربط البلوجن بنجاح');
        await checkPluginStatus();
      } else {
        if (resultDiv) {
          resultDiv.innerHTML =
            '<i class="fas fa-circle-xmark"></i> ' +
            (escapeHtml(data.message || "كود غير صالح"));
          resultDiv.style.color = "#f44336";
        }
      }
    } catch (err) {
      if (resultDiv) {
        resultDiv.innerHTML =
          '<i class="fas fa-circle-xmark"></i> خطأ في الاتصال بالخادم';
        resultDiv.style.color = "#f44336";
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

// Enter في حقل الكود = ضغط زر الربط
document
  .getElementById("pairCodeInput")
  ?.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("pairWithCodeBtn")?.click();
    }
  });

// ============================================================
// مراقبة لحظية لحالة الربط — لو سيرفر ماينكرافت اشتغل فيه البلوجن
// واقترن بالباكند، الواجهة تعرف فوراً وتحدّث الحالة بدون تحديث الصفحة
// ============================================================
function setPluginStatusUI(isPaired, source) {
  const inputGroup = document.getElementById("unpairedHint");
  const pairedActions = document.getElementById("pairedActions");
  const statusSpan = document.getElementById("pluginConnectionStatus");
  if (isPaired) {
    if (inputGroup) inputGroup.style.display = "none";
    if (pairedActions) pairedActions.style.display = "flex";
    if (statusSpan) {
      statusSpan.innerHTML =
        '<i class="fas fa-circle-check"></i> مقترن' +
        (source ? ` (${source})` : "");
      statusSpan.style.color = "#4caf50";
    }
  } else {
    if (inputGroup) inputGroup.style.display = "block";
    if (pairedActions) pairedActions.style.display = "none";
    if (statusSpan) {
      statusSpan.innerHTML = '<i class="fas fa-circle-xmark"></i> غير مقترن';
      statusSpan.style.color = "#f44336";
    }
  }
}

// استماع لأحداث السوكيت من الباكند: اقتران/فك اقتران لحظي
// تُستدعى عند كل اتصال ناجح للفرونت (مرة واحدة لكل سوكيت)

function bindPluginStatusSocketListeners() {
  if (!__S.frontendSocket || __S._pluginStatusListenersBound) return;
  __S._pluginStatusListenersBound = true;
  __S.frontendSocket.on("plugin-paired", (data) => {
    console.log("🔗 حدث اقتران بلوجن لحظياً:", data);
    setPluginStatusUI(true, data?.source);
  });
  __S.frontendSocket.on("plugin-unpaired", () => {
    console.log("🔓 تم فك اقتران بلوجن لحظياً");
    setPluginStatusUI(false);
  });
}

function getAuthToken() {
  try {
    // مصدر أخير: التوكن المختوم من العملية الرئيسية — الكوكي httpOnly
    // غير مقروء من JS وsm_token قد لا يكون محفوظًا، وبدونه تفشل مصافحة
    // Socket.IO (No token) فتعطل الأصوات والإشعارات الفورية
    return (
      localStorage.getItem("sm_token") ||
      getCookie("token") ||
      window.electronAPI?.getAuthTokenSync?.() ||
      ""
    );
  } catch {
    return getCookie("token") || window.electronAPI?.getAuthTokenSync?.() || "";
  }
}

// ترويسات المصادقة للاستخدام مع XHR الرفع (شريط التقدم)
window.__getAuthHeaders = function () {
  const h = {};
  try {
    const token = getAuthToken();
    if (token) h["Authorization"] = "Bearer " + token;
    h["x-device-id"] = getDeviceId();
  } catch (e) {}
  return h;
};

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


export { checkPluginStatus, setPluginStatusUI, bindPluginStatusSocketListeners, getAuthToken, saveAuthToken, getSelectedProfileId, updateClearShortcutButton };
