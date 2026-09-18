// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { getSelectedProfileId } from "./pairing.js";
import { fetchWithAuth } from "./utils-core.js";
import { updateClearShortcutButton } from "./pairing.js";
import { showMessage } from "./utils-core.js";
import { withHotkeyChange } from "./auth-flow.js";
import { withHotkeySkeleton } from "./auth-flow.js";
import { getGiftImage } from "./gifts.js";
import { safeImageUrl } from "./utils-core.js";
import { escapeHtml } from "./utils-core.js";
import { showConfirm } from "./utils-core.js";
import { closeKeyboardShortcutModal } from "./misc.js";
import { openKeyboardShortcutModal } from "./misc.js";
import { executeCommand } from "./commands.js";

// ============================================================
// دوال HOTKEY (النظام الكامل)
// ============================================================

// دالة التحقق من صحة المفتاح (تدعم المعدلات: Ctrl+Alt+Shift+F1 مثلاً)


















































































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
  return __S.HOTKEY_VALID_KEYS.includes(actualKey);
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
      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
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
      __S.hotkeySettings = {
        key: hk.key || "",
        commandId: hk.commandId || null,
        commandType: hk.commandType || null,
        active: hk.active !== false,
      };
    } else {
      // لا توجد اختصارات
      __S.hotkeySettings = {
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
      statusEl.innerHTML =
        "<i class='fas fa-circle-xmark'></i> فشل تحميل الإعدادات";
      statusEl.style.color = "var(--error-color, #f44336)";
    }
    __S.hotkeySettings = {
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
    const res = await fetchWithAuth(`${__S.API_BASE}/api/hotkey`, {
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
// ✅ آخر نتيجة جلب للاختصارات — تُشارك بين التسجيل والعد والرسم بدل
// ثلاثة طلبات متتالية لنفس النقطة في كل دورة تحديث
let lastHotkeyFetch = null;

async function updateHotkeyRegistration() {
  if (!window.electronAPI || !window.electronAPI.hotkey) {
    console.warn("⚠️ Electron API غير متاح، الهوت كي لن يعمل في المتصفح");
    return false;
  }

  try {
    await window.electronAPI.hotkey.unregisterAll();
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
    );
    const data = await res.json();
    if (data.success && Array.isArray(data.hotkeys)) {
      lastHotkeyFetch = data.hotkeys;
      window.currentHotkeys = data.hotkeys;
    }
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
          `<i class="fas fa-triangle-exclamation"></i> فشل تسجيل الاختصار ${combo}:`,
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

  // ✅ التسجيل يجلب الاختصارات مرة واحدة — العدّ والرسم يعيدان استخدام
  // نفس النتيجة (كانت /api/hotkey تُجلب 3 مرات في الدورة الواحدة)
  const registered = await updateHotkeyRegistration();
  const current = Array.isArray(lastHotkeyFetch) ? lastHotkeyFetch : null;
  const activeCount = current
    ? current.filter((h) => h.active !== false).length
    : 0;

  const statusEl = document.getElementById("hotkeyStatus");
  if (statusEl) {
    if (!registered) {
      statusEl.innerHTML =
        "<i class='fas fa-triangle-exclamation'></i> فشل تسجيل الاختصارات في النظام";
      statusEl.style.color = "var(--warning-color, #ff9800)";
    } else if (activeCount > 0) {
      statusEl.innerHTML = `<i class="fas fa-circle-check"></i> الاختصارات النشطة: ${activeCount}`;
      statusEl.style.color = "var(--success-color, #4caf50)";
    } else {
      statusEl.innerHTML = "<i class='fas fa-pause'></i> لا توجد اختصارات نشطة";
      statusEl.style.color = "var(--text-muted, #888)";
    }
  }

  // الرسم يستخدم نفس البيانات بدون جلب جديد (null = الجلب العادي)
  await renderHotkeysList(false, current);
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
  __S.hotkeySettings = {
    ...__S.hotkeySettings,
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
  __S.editingHotkeyId = null;
}

// ===== عرض رسالة حالة Hotkey مع اختفاء تلقائي =====

function showHotkeyStatus(text, color) {
  const el = document.getElementById("hotkeyStatus");
  if (!el) return;
  el.innerHTML = window.AppI18n ? AppI18n.t(text) : text;
  el.style.color = color;
  if (__S.hotkeyStatusTimer) clearTimeout(__S.hotkeyStatusTimer);
  __S.hotkeyStatusTimer = setTimeout(() => {
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
      "<i class='fas fa-circle-xmark'></i> عناصر الواجهة غير موجودة",
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
      "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار مفتاح من لوحة المفاتيح",
      "var(--warning-color, #ff9800)",
    );
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار مفتاح من لوحة المفاتيح أولاً",
    );
    return;
  }

  if (!isValidHotkeyKey(newKey)) {
    showHotkeyStatus(
      `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" غير مدعوم`,
      "var(--warning-color, #ff9800)",
    );
    showMessage(
      `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" غير مدعوم`,
    );
    return;
  }

  if (!commandId || !commandType) {
    showHotkeyStatus(
      "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار أمر من القائمة",
      "var(--warning-color, #ff9800)",
    );
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار أمر من القائمة",
    );
    return;
  }

  // السكيلتون يبدأ فوراً لحظة الحفظ — يغطي الحفظ وإعادة التسجيل وتحديث القائمة
  return withHotkeyChange(async () => {
    try {
      // ✅ جلب جميع اختصارات البروفايل الحالي من السيرفر
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
      );
      const data = await res.json();

      if (data.success && data.hotkeys) {
        // ✅ حالة التعديل (editingHotkeyId موجود)
        if (__S.editingHotkeyId) {
          // البحث عن الاختصار الذي نعدله
          const oldHotkey = data.hotkeys.find(
            (h) => h.commandId === __S.editingHotkeyId,
          );

          // إذا لم نجد الاختصار القديم، هذا يعني أنه تم حذفه أو أن المعرف غير صحيح
          if (!oldHotkey) {
            showHotkeyStatus(
              "<i class='fas fa-circle-xmark'></i> الاختصار المطلوب تعديله غير موجود",
              "var(--error-color, #f44336)",
            );
            showMessage(
              "<i class='fas fa-circle-xmark'></i> الاختصار المطلوب تعديله غير موجود",
            );
            __S.editingHotkeyId = null;
            clearHotkeyFormFields();
            return;
          }

          const oldKey = oldHotkey.key;

          // ✅ التحقق من عدم استخدام المفتاح الجديد من قبل أمر آخر (باستثناء نفسه)
          const existingHotkey = data.hotkeys.find(
            (h) => h.key === newKey && h.commandId !== __S.editingHotkeyId,
          );

          if (existingHotkey) {
            showHotkeyStatus(
              `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" مستخدم بالفعل مع أمر آخر`,
              "var(--warning-color, #ff9800)",
            );
            showMessage(
              `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" مستخدم بالفعل مع أمر آخر`,
            );
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
              `<i class="fas fa-triangle-exclamation"></i> هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
              "var(--warning-color, #ff9800)",
            );
            showMessage(
              `<i class="fas fa-triangle-exclamation"></i> هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
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
            `${__S.API_BASE}/api/hotkey/${encodeURIComponent(oldKey)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(settings),
            },
          );

          if (updateRes.ok) {
            __S.hotkeySettings = settings;
            await updateHotkeyRegistration();
            await _renderHotkeysListImpl();

            showHotkeyStatus(
              `<i class="fas fa-circle-check"></i> تم تحديث الاختصار: ${newKey}`,
              "var(--success-color, #4caf50)",
            );
            showMessage(
              `<i class="fas fa-circle-check"></i> تم تحديث الاختصار من "${oldKey}" إلى "${newKey}"`,
            );

            // ✅ مسح حالة التعديل وتصفير الحقول بعد التحديث
            clearHotkeyFormFields();
            updateClearShortcutButton();
            return;
          } else {
            const errorData = await updateRes.json().catch(() => ({}));
            showHotkeyStatus(
              `<i class="fas fa-circle-xmark"></i> فشل تحديث الاختصار: ${errorData.message || "خطأ غير معروف"}`,
              "var(--error-color, #f44336)",
            );
            showMessage(
              `<i class="fas fa-circle-xmark"></i> فشل تحديث الاختصار: ${errorData.message || "خطأ غير معروف"}`,
            );
            return;
          }
        }

        // ✅ حالة الإضافة الجديدة - التحقق من عدم وجود المفتاح
        const existingHotkey = data.hotkeys.find((h) => h.key === newKey);
        if (existingHotkey) {
          showHotkeyStatus(
            `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" مستخدم بالفعل`,
            "var(--warning-color, #ff9800)",
          );
          showMessage(
            `<i class="fas fa-triangle-exclamation"></i> المفتاح "${newKey}" مستخدم بالفعل`,
          );
          return;
        }

        // منع استخدام نفس الأمر في أكثر من اختصار
        const dupCommand = data.hotkeys.find(
          (h) => h.commandId === commandId && h.commandType === commandType,
        );
        if (dupCommand) {
          showHotkeyStatus(
            `<i class="fas fa-triangle-exclamation"></i> هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
            "var(--warning-color, #ff9800)",
          );
          showMessage(
            `<i class="fas fa-triangle-exclamation"></i> هذا الأمر مستخدم بالفعل مع المفتاح "${dupCommand.key}"`,
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
      __S.hotkeySettings = settings;

      const saved = await saveHotkeySettingsToServer(settings);

      if (saved) {
        showHotkeyStatus(
          `<i class="fas fa-circle-check"></i> تم حفظ الاختصار: ${newKey}`,
          "var(--success-color, #4caf50)",
        );
        // تحديث hotkeySettings بالقيم الجديدة
        __S.hotkeySettings = { key: newKey, commandId, commandType, active };
        await updateHotkeyRegistration();
        await _renderHotkeysListImpl();
        showMessage(
          `<i class="fas fa-circle-check"></i> تم تعيين الاختصار: ${newKey}`,
        );
        // ✅ تصفير الحقول بعد الحفظ حتى لا يبقى آخر أمر محددًا
        clearHotkeyFormFields();
        updateClearShortcutButton();
      } else {
        showHotkeyStatus(
          "<i class='fas fa-circle-xmark'></i> فشل حفظ الإعدادات على السيرفر",
          "var(--error-color, #f44336)",
        );
        showMessage("<i class='fas fa-circle-xmark'></i> فشل حفظ الاختصار");
      }
    } catch (err) {
      console.error("❌ خطأ في saveHotkeySettings:", err);
      showHotkeyStatus(
        "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال",
        "var(--error-color, #f44336)",
      );
      showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
    }
  });
}

// ملء القائمة المنسدلة بأسماء الأوامر
// قائمة أوامر الهوت كي — النداءات المتزامنة تتنفذ بالترتيب
// حتى لا تتداخل وتكرر الخيارات في القائمة المنسدلة

async function loadHotkeyCommands() {
  const run = () => _loadHotkeyCommandsImpl();
  if (__S.hotkeyCmdLoadChain)
    return (__S.hotkeyCmdLoadChain = __S.hotkeyCmdLoadChain.then(run, run));
  return (__S.hotkeyCmdLoadChain = run());
}

async function _loadHotkeyCommandsImpl() {
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
      fetchWithAuth(`${__S.GIFT_API}?profile=${profileId}`).then((r) => r.json()),
      fetchWithAuth(`${__S.INTERACT_API}?profile=${profileId}`).then((r) =>
        r.json(),
      ),
    ]);

    const gifts = giftsRes.gifts || [];
    const interactions = interactRes.list || [];

    // ✅ أوامر الهدايا الخاصة بالبروفايل (giftsRes.gifts) — كانت تعرض
    // __S.gifts وهو كتالوج هدايا تيك توك الكامل (مئات الهدايا غير المرتبطة
    // بأي أمر) فتظهر قائمة "حاجات غريبة" ولا يعمل ربط أي منها
    gifts.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = `gift_${g._id}`;
      opt.dataset.id = g._id;
      opt.dataset.type = "gift";
      const giftName =
        g.name || g.giftName || `Gift ${String(g.giftId || "").slice(0, 20)}`;
      opt.textContent = giftName;
      if (
        __S.hotkeySettings.commandId === g._id &&
        __S.hotkeySettings.commandType === "gift"
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
          follow: "متابعة",
          like: "لايك",
          comment: "تعليق",
          share: "مشاركة",
          gift: "هدية",
          join: "دخول",
          first_activity: "أول نشاط",
          gift_range: "نطاق عملات",
          nothing: "بدون تفاعل",
          all: "الكل",
        }[cmd.type] || cmd.type;
      opt.textContent = `${typeLabel} - ${cmd.name || "بدون اسم"}`;
      if (
        __S.hotkeySettings.commandId === cmd._id &&
        __S.hotkeySettings.commandType === "interaction"
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
    select.innerHTML =
      '<option value=""><i class="fas fa-circle-xmark"></i> فشل تحميل الأوامر</option>';
  }
}

// عرض قائمة Hotkey المسجلة — preloaded: اختصارات جُلبت للتو (توفير طلب)
async function renderHotkeysList(force, preloaded = null) {
  return withHotkeySkeleton(() => _renderHotkeysListImpl(preloaded), force);
}

// رسم قائمة الاختصارات — النداءات المتزامنة تتنفذ بالترتيب
// حتى لا تتداخل وتضاعف الصفوف في الجدول

function _renderHotkeysListImpl(preloaded = null) {
  const run = () => _renderHotkeysListNow(preloaded);
  if (__S.hotkeyRenderChain)
    return (__S.hotkeyRenderChain = __S.hotkeyRenderChain.then(run, run));
  return (__S.hotkeyRenderChain = run());
}

async function _renderHotkeysListNow(preloaded = null) {
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
    td.textContent = window.AppI18n ? AppI18n.t(text) : text;
    tr.appendChild(td);
    tbody.appendChild(tr);
  };

  try {
    let hotkeys = preloaded;
    if (!Array.isArray(hotkeys)) {
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
      );
      const data = await res.json();
      if (!data.success || !Array.isArray(data.hotkeys)) {
        emptyRow("<i class='fas fa-circle-xmark'></i> فشل تحميل الاختصارات");
        return;
      }
      hotkeys = data.hotkeys;
    }
    window.currentHotkeys = hotkeys;
    if (hotkeys.length === 0) {
      emptyRow("لا توجد اختصارات مسجلة في هذا البروفايل");
      return;
    }

    tbody.innerHTML = "";
    hotkeys.forEach((hk, index) => {
      const tr = document.createElement("tr");
      if (__S.hotkeySettings.key === hk.key) tr.className = "current-hotkey";

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
      // نوع الأمر بالاسم — أسماء إنجليزية تمر عبر AppI18n.t فتظهر
      // بالعربية تلقائياً عندما لغة التطبيق عربية (وتطابق لغة التطبيق)
      const hotkeyTypeLabels = {
        like: "Like",
        follow: "Follow",
        comment: "Comment",
        share: "Share",
        gift: "Gift",
        join: "Join",
        first_activity: "First Activity",
        gift_range: "Coins Range",
        nothing: "None",
        all: "All",
      };
      tdType.textContent = window.AppI18n
        ? AppI18n.t(
            hk.commandType === "gift"
              ? "Gift"
              : hotkeyTypeLabels[cmd && cmd.type] || "Interaction",
          )
        : hk.commandType === "gift"
          ? "هدية"
          : hotkeyTypeLabels[cmd && cmd.type] || "تفاعل";
      tr.appendChild(tdType);

      const tdGift = document.createElement("td");
      tdGift.style.textAlign = "center";
      if (cmd && (cmd.__type || hk.commandType) === "gift") {
        // هدية — صورة الهدية نفسها بدل الـ ID
        const rawImgUrl = getGiftImage(cmd.giftId);
        const safeImg = safeImageUrl(rawImgUrl);
        const safeTitle = escapeHtml(cmd.giftName || cmd.name || "");
        tdGift.innerHTML = `<img src="${safeImg}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${safeTitle}">`;
      } else if (cmd) {
        // تفاعل — أيقونة نوعه (لايك/متابعة/تعليق/مشاركة/دخول/أول نشاط)
        let iconFile = "";
        switch (cmd.type || "") {
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
          case "join":
            iconFile = "join.png";
            break;
          case "first_activity":
            iconFile = "firstactive.png";
            break;
          case "nothing":
            iconFile = "nothing.png";
            break;
          default:
            // الديفولت عند عدم اختيار تفاعل: nothing.png
            iconFile = "nothing.png";
        }
        tdGift.innerHTML = `<img src="images/${iconFile}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${escapeHtml(cmd.type || "")}">`;
      }
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
      editBtn.innerHTML = '<i class="fas fa-pen-to-square"></i>';
      editBtn.title = "تعديل";
      editBtn.dataset.key = hk.key;
      editBtn.dataset.id = hk.commandId;
      editBtn.dataset.type = hk.commandType;
      editBtn.dataset.active = String(hk.active !== false);
      tdActions.appendChild(editBtn);
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "hotkey-delete-btn";
      deleteBtn.innerHTML = '<i class="fas fa-trash-can"></i>';
      deleteBtn.title = "حذف";
      deleteBtn.dataset.key = hk.key;
      tdActions.appendChild(deleteBtn);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });

    attachHotkeyToggleEvents(tbody);
    attachHotkeyDeleteEvents(tbody);
    attachHotkeyEditEvents(tbody);
    if (window.AppI18n) AppI18n.applyDOM();
  } catch (err) {
    console.warn("⚠️ فشل عرض قائمة الاختصارات", err);
    emptyRow("<i class='fas fa-circle-xmark'></i> فشل تحميل الاختصارات");
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

  return withHotkeyChange(async () => {
    try {
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/hotkey${hotkeyProfileQuery()}`,
      );
      const data = await res.json();
      const hk = data.hotkeys.find((h) => h.key === key);
      if (!hk) {
        showMessage(
          "<i class='fas fa-circle-xmark'></i> لم يتم العثور على الاختصار",
        );
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
      const saveRes = await fetchWithAuth(`${__S.API_BASE}/api/hotkey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (saveRes.ok) {
        if (__S.hotkeySettings.key === key) __S.hotkeySettings.active = active;
        showMessage(
          `<i class="fas fa-circle-check"></i> ${active ? "تفعيل" : "إلغاء تفعيل"} الاختصار ${hk.key}`,
        );
        // إعادة تسجيل كل الاختصارات الفعالة من السيرفر (يلغي القديم ويسجل الجديد)
        await updateHotkeyRegistration();
        await _renderHotkeysListImpl();
      } else {
        showMessage("<i class='fas fa-circle-xmark'></i> فشل تحديث الحالة");
        cb.checked = !active;
      }
    } catch (err) {
      console.error(err);
      showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      cb.checked = !active;
    }
  });
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

  __S.editingHotkeyId = id;

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
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> الأمر غير موجود في القائمة (ربما محذوف)",
      );
      return;
    }
  }

  __S.hotkeySettings.key = key;
  __S.hotkeySettings.commandId = id;
  __S.hotkeySettings.commandType = type;
  __S.hotkeySettings.active = active;

  const saveBtn = document.getElementById("saveHotkeyBtn");
  if (saveBtn) {
    saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> تحديث الاختصار';
    saveBtn.style.backgroundColor = "#ff9800";
  }

  document
    .querySelector(".hotkey-settings")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(
    `<i class="fas fa-circle-check"></i> تم تحميل بيانات الاختصار "${key}" للتعديل. اضغط "تحديث الاختصار" لتطبيق التغييرات.`,
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

  return withHotkeyChange(async () => {
    try {
      const res = await fetchWithAuth(
        `${__S.API_BASE}/api/hotkey/${encodeURIComponent(key)}${hotkeyProfileQuery()}`,
        { method: "DELETE" },
      );

      if (res.ok) {
        if (window.electronAPI && window.electronAPI.hotkey) {
          await window.electronAPI.hotkey.unregister(key);
        }
        // إزالة الاختصار من hotkeySettings إذا كان هو نفسه
        if (__S.hotkeySettings.key === key) {
          __S.hotkeySettings = {
            key: "",
            commandId: null,
            commandType: null,
            active: false,
          };
          // لا نستدعي clearHotkeyFormFields هنا، بل نترك loadHotkeySettings يعيد تعبئة الحقول
        }
        showMessage(
          `<i class="fas fa-circle-check"></i> تم حذف الاختصار ${key}`,
        );
        await updateHotkeyRegistration();
        await _renderHotkeysListImpl();
      } else {
        showMessage("<i class='fas fa-circle-xmark'></i> فشل حذف الاختصار");
      }
    } catch (err) {
      console.error(err);
      showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
    }
  });
}

// ===== معالج حفظ الاختصار من مودال الكيبورد =====
function handleSaveShortcut() {
  const key = document.getElementById("modalSelectedKey").value;
  const ctrl = document.getElementById("modalModCtrl").checked;
  const alt = document.getElementById("modalModAlt").checked;
  const shift = document.getElementById("modalModShift").checked;

  if (!key) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار مفتاح",
    );
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
  showMessage(
    `<i class="fas fa-circle-check"></i> تم اختيار المفتاح: ${combo}`,
  );
}

function handleHotkeyFormKeydown(e) {
  if (e.key !== "Enter" || e.target.closest("button, textarea")) return;

  e.preventDefault();
  document.getElementById("saveHotkeyBtn")?.click();
}

// ===== ربط أحداث Hotkey =====
function setupHotkeyEvents() {
  // زر حفظ الإعدادات
  const saveBtn = document.getElementById("saveHotkeyBtn");
  if (saveBtn) {
    saveBtn.removeEventListener("click", saveHotkeySettings);
    saveBtn.addEventListener("click", () =>
      __S.withButtonLock(saveBtn, saveHotkeySettings),
    );
  }

  const hotkeySettingsForm = document.querySelector(".hotkey-settings");
  if (hotkeySettingsForm) {
    hotkeySettingsForm.removeEventListener("keydown", handleHotkeyFormKeydown);
    hotkeySettingsForm.addEventListener("keydown", handleHotkeyFormKeydown);
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
          `<i class="fas fa-bolt"></i> تنفيذ Hotkey للأمر: ${data.commandId} (${data.commandType})`,
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


export { isValidHotkeyKey, hotkeyProfileQuery, loadHotkeySettings, saveHotkeySettingsToServer, updateHotkeyRegistration, applyHotkeySettings, clearHotkeyFormFields, showHotkeyStatus, saveHotkeySettings, loadHotkeyCommands, _loadHotkeyCommandsImpl, renderHotkeysList, _renderHotkeysListImpl, _renderHotkeysListNow, attachHotkeyToggleEvents, handleToggleChange, attachHotkeyDeleteEvents, attachHotkeyEditEvents, handleEditClick, handleDeleteClick, handleSaveShortcut, handleHotkeyFormKeydown, setupHotkeyEvents, initHotkey };
