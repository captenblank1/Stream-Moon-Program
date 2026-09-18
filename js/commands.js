// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { showConfirm } from "./utils-core.js";
import { ensureGiftsLoaded } from "./gifts.js";
import { escapeHtml } from "./utils-core.js";
import { decodeHtmlEntities } from "./utils-core.js";
import { updateClearShortcutButton } from "./pairing.js";
import { updateGiftDropdown } from "./gifts.js";
import { showMessage } from "./utils-core.js";
import { getSelectedProfileId } from "./pairing.js";
import { fetchWithAuth } from "./utils-core.js";
import { withTableSkeleton } from "./auth-flow.js";
import { getGiftImage, getGiftImages } from "./gifts.js";
import { safeImageUrl } from "./utils-core.js";
import { loadHotkeyCommands } from "./hotkeys.js";
import { checkStorageNotifications } from "./storage.js";

// ============================================================
// دوال الأوامر (Commands)
// ============================================================
function updateInputsForType(type) {
  const thresholdEl = document.getElementById("threshold");
  const thresholdLabel = document.querySelector('label[for="threshold"]');
  const keywordEl = document.getElementById("keyword");
  const keywordLabel = document.querySelector('label[for="keyword"]');
  const giftSection = document.getElementById("giftChooserSection");
  const giftRangeSection = document.getElementById("giftRangeSection");
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

  // ✅ "بدون" (nothing): أمر بدون تفاعل — يُنفذ يدوياً أو من الهوت كي فقط
  // كل حقول التفاعل تظل مخفية
  if (giftSection)
    giftSection.style.display = type === "gift" ? "block" : "none";

  // مؤشر هادئ ثابت (بدون رسائل منبثقة): يوضح سلوك "بدون تفاعل" فقط وقت
  // اختياره — لو كان الهدف التنفيذ مع البث اختر تفاعلاً من القائمة
  let nothingNote = document.getElementById("nothingTypeNote");
  if (type === "nothing") {
    if (!nothingNote) {
      nothingNote = document.createElement("div");
      nothingNote.id = "nothingTypeNote";
      nothingNote.style.cssText =
        "display:flex; align-items:center; gap:8px; font-size:12px; color:#9aa5b1; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:7px 10px; margin:4px 0;";
      nothingNote.innerHTML =
        "<i class='fas fa-hand-pointer'></i> يعمل يدوياً أو بالهوت كي فقط — ليعمل مع البث اختر تفاعلاً";
      const card = document.getElementById("addCard");
      const anchor = document.querySelector("#addCard .custom-select.action-select");
      if (anchor && anchor.nextSibling) card.insertBefore(nothingNote, anchor.nextSibling);
      else if (card) card.appendChild(nothingNote);
    }
    nothingNote.style.display = "flex";
  } else if (nothingNote) {
    nothingNote.style.display = "none";
  }
  // خانتا Min/Max تظهران فقط مع خيار Coins Range (gift_range)
  if (giftRangeSection)
    giftRangeSection.style.display = type === "gift_range" ? "block" : "none";
  if (hidden) hidden.value = type;
}

function captureOriginalFormValues() {
  __S.originalFormValues = {
    actionName: document.getElementById("actionName").value.trim(),
    actionType: document.getElementById("actionType").value,
    giftSelect: document.getElementById("giftSelect").value,
    giftName: (document.getElementById("giftName").value || "").trim(),
    minDiamonds: document.getElementById("minDiamonds")?.value ?? "",
    maxDiamonds: document.getElementById("maxDiamonds")?.value ?? "",
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
    minDiamonds: document.getElementById("minDiamonds")?.value ?? "",
    maxDiamonds: document.getElementById("maxDiamonds")?.value ?? "",
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

  for (let key in __S.originalFormValues) {
    let oldVal = __S.originalFormValues[key];
    let newVal = current[key];
    if (oldVal === undefined || oldVal === null) oldVal = "";
    if (newVal === undefined || newVal === null) newVal = "";
    if (oldVal !== newVal) {
      if (
        key === "giftName" &&
        current.giftSelect === __S.originalFormValues.giftSelect
      )
        continue;
      return true;
    }
  }
  return false;
}

async function checkForChangesAndClose() {
  // أثناء رفع ملف: تأكيد دائماً — "نعم" يلغي كل شيء، "لا" يكمل الرفع ولا يغلق
  if (__S.pendingUploads.audio || __S.pendingUploads.video) {
    const confirmed = await showConfirm(
      "جاري رفع ملف حالياً. هل تريد إلغاء الرفع وإغلاق النافذة؟ سيتم فقد كل ما تم رفعه.",
      "إلغاء الرفع",
    );
    if (confirmed) {
      __S.uploadsCancelled = true;
      // إلغاء فعلي للرفع الجاري — لا نهاية في الخلفية بعد الخروج من الكارت
      try {
        window.__audioXhr && window.__audioXhr.abort();
      } catch (e) {}
      try {
        window.__videoXhr && window.__videoXhr.abort();
      } catch (e) {}
      hideAddCard();
      Promise.allSettled([__S.pendingUploads.audio, __S.pendingUploads.video]).finally(
        () => {
          __S.uploadsCancelled = false;
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
  if (commandData?.__type === "gift" && !__S.giftsLoaded) {
    ensureGiftsLoaded()
      .then(() => _showAddCard(commandData))
      .catch(() => _showAddCard(commandData));
  } else _showAddCard(commandData);
}

function _showAddCard(commandData = null) {
  __S.tempUploadedFiles.audio = null;
  __S.tempUploadedFiles.video = null;
  __S.videoWasCleared = false;

  if (commandData) {
    __S.editingId = commandData._id || null;
    __S.editingType = commandData.__type === "gift" ? "gift" : "interaction";
  } else {
    __S.editingId = null;
    __S.editingType = null;
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
      const rangeSection = document.getElementById("giftRangeSection");
      if (rangeSection)
        rangeSection.style.display =
          typeSelect.value === "gift_range" ? "block" : "none";
    });
    typeSelect._hasChangeListener = true;
  }

  const giftDropdownSelected = document.querySelector(
    "#giftDropdown .selected",
  );
  document.getElementById("shortcutData").value = "";
  document.getElementById("shortcutDisplay").textContent = "لم يتم التعيين";
  __S.currentShortcutCombo = "";

  if (commandData) {
    if (commandData.combo) {
      document.getElementById("shortcutData").value = commandData.combo;
      document.getElementById("shortcutDisplay").textContent =
        commandData.combo;
      __S.currentShortcutCombo = commandData.combo;
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
    // ✅ نصوص أنواع التفاعلات باللغة الإنجليزية — AppI18n.t يترجمها للعربية
    // تلقائياً عندما لغة التطبيق عربية (تطابق لغة التطبيق الحالية)
    const labelMap = {
      nothing: "<i class='fas fa-ban'></i> None",
      gift: "<i class='fas fa-gift'></i> Gift",
      follow: "Follow",
      like: "Like",
      comment: "Comment",
      share: "Share",
      join: "Join",
      first_activity: "First Activity",
      gift_range: "Coins Range",
    };
    if (actionSelectSpan) {
      const known = !!labelMap[givenType];
      const rawLabel = known
        ? labelMap[givenType]
        : escapeHtml(
            String(givenType).charAt(0).toUpperCase() +
              String(givenType).slice(1),
          );
      // القيم من labelMap ثابتة وآمنة — t() يترجمها للغة التطبيق الحالية
      actionSelectSpan.innerHTML = window.AppI18n
        ? AppI18n.t(rawLabel)
        : rawLabel;
    }

    giftSection.style.display = givenType === "gift" ? "block" : "none";

    const gid = commandData.giftId != null ? String(commandData.giftId) : "";
    document.getElementById("giftSelect").value = gid;
    document.getElementById("giftName").value = commandData.giftName || "";
    // تعبئة نطاق العملات في وضع التعديل
    const editMinD = document.getElementById("minDiamonds");
    const editMaxD = document.getElementById("maxDiamonds");
    if (editMinD)
      editMinD.value =
        commandData.minDiamonds != null ? commandData.minDiamonds : "";
    if (editMaxD)
      editMaxD.value =
        commandData.maxDiamonds != null ? commandData.maxDiamonds : "";
    document.getElementById("webhookUrl").value = commandData.webhookUrl || "";

    if (gid && __S.gifts && __S.gifts.length > 0) {
      const found = __S.gifts.find((g) => String(g.id) === gid);
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
      __S.pendingActiveState = commandData.active !== false;
      // ✅ حفظ حالة الصوت/الفيديو كما هي — التعديل لا يعيد تفعيلها قسراً
      __S.pendingPlaySound = commandData.playSound !== false;
      __S.pendingPlayVideo =
        commandData.playVideo !== undefined
          ? commandData.playVideo !== false
          : commandData.enableVideo !== false;
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
      const audioObj = __S.globalAudios.find((a) => a.file === commandData.audio);
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
    if (__S.overlayTextGroup) {
      __S.overlayTextGroup.style.display =
        showOverlayCheck && showOverlayCheck.checked ? "block" : "none";
    }
  } else {
    __S.editingId = null;
    __S.editingType = null;
    // ✅ الافتراضي الجديد: بدون تفاعل (nothing) — اختيار التفاعل اختياري
    typeSelect.value = "nothing";
    updateInputsForType("nothing");
    const actionSelectSpan = document.querySelector(
      "#addCard .custom-select.action-select .selected span",
    );
    if (actionSelectSpan)
      actionSelectSpan.innerHTML = "<i class='fas fa-ban'></i> None";
    document.getElementById("actionType").value = "nothing";
    giftSection.style.display = "none";
    document.getElementById("giftSelect").value = "";
    document.getElementById("giftName").value = "";
    // تصفير نطاق العملات عند إنشاء أمر جديد
    const newMinD = document.getElementById("minDiamonds");
    const newMaxD = document.getElementById("maxDiamonds");
    if (newMinD) newMinD.value = "";
    if (newMaxD) newMaxD.value = "";
    document.getElementById("webhookUrl").value = "";
    document.getElementById("actionName").value = "";
    document.getElementById("targetUser").value = "all";
    __S.pendingActiveState = true;
    __S.pendingPlaySound = true;
    __S.pendingPlayVideo = true;
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
    if (__S.overlayTextGroup) __S.overlayTextGroup.style.display = "none";
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
  __S.editingId = null;
  __S.editingType = null;
}

async function confirmAdd(event) {
  if (event) event.preventDefault();

  const saveBtn = document.querySelector("#addCard .confirm-btn");
  if (!saveBtn) {
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ: زر الحفظ غير موجود");
    return;
  }

  const actionName = document.getElementById("actionName").value.trim();
  if (!actionName) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> يرجى إدخال اسم الإجراء",
    );
    return;
  }

  const actionType = document.getElementById("actionType").value;
  const giftId = document.getElementById("giftSelect").value.trim();
  // نطاق عملات الهدية (اختياري) — لو محدد يكفي بدون اختيار هدية محددة
  const minDiamondsRaw =
    document.getElementById("minDiamonds")?.value ?? "";
  const maxDiamondsRaw =
    document.getElementById("maxDiamonds")?.value ?? "";
  const minDiamonds =
    minDiamondsRaw === "" ? null : parseInt(minDiamondsRaw, 10);
  const maxDiamonds =
    maxDiamondsRaw === "" ? null : parseInt(maxDiamondsRaw, 10);
  const isRangeGift = minDiamonds != null || maxDiamonds != null;
  if (actionType === "gift_range" && !isRangeGift) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> حدد Min أو Max على الأقل لأمر نطاق العملات",
    );
    return;
  }
  if (
    isRangeGift &&
    minDiamonds != null &&
    maxDiamonds != null &&
    minDiamonds > maxDiamonds
  ) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> Min لازم تكون أقل من أو تساوي Max",
    );
    return;
  }
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
  if (__S.saveInProgress) return;
  __S.saveInProgress = true;
  const originalBtnHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.style.opacity = 0.6;
  saveBtn.style.pointerEvents = "none";
  saveBtn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> جاري الحفظ...";

  try {
    // انتظار أي رفع ملفات جارٍ قبل الحفظ حتى لا يضيع اسم الملف
    if (__S.pendingUploads.audio || __S.pendingUploads.video) {
      showMessage(
        "<i class='fas fa-spinner fa-spin'></i> انتظار انتهاء رفع الملفات قبل الحفظ...",
      );
      const active = [__S.pendingUploads.audio, __S.pendingUploads.video].filter(
        Boolean,
      );
      await Promise.allSettled(active);
    }

    const audioFile =
      __S.tempUploadedFiles.audio || document.getElementById("audioSelect").value;
    const currentVideoFile = document.getElementById("video").value;
    const videoFile =
      __S.tempUploadedFiles.video ||
      currentVideoFile ||
      (!__S.videoWasCleared && __S.editingId && __S.editingType
        ? __S.originalFormValues.video
        : "");
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
      active: __S.pendingActiveState,
      // ✅ الحفاظ على حالة الصوت/الفيديو كما كانت — التعديل لا يفعّلهما تلقائياً
      playSound: __S.pendingPlaySound,
      playVideo: __S.pendingPlayVideo,
      oncePerLive,
      combo: shortcutData || undefined,
      showOverlay,
      overlayText,
      duration,
    };

    const profileId = getSelectedProfileId();
    if (profileId) baseCommand.profile = profileId;

    const isEditing = !!(__S.editingId && __S.editingType);
    const oldEditingId = __S.editingId;
    const oldEditingType = __S.editingType;

    // ✅ تغيير النوع الحقيقي فقط: gift ↔ غيره. actionType قيمة خام
    // (like/comment/gift_range/...) بينما editingType نوع الصف
    // (gift/interaction) — المقارنة المباشرة كانت تحسب كل تعديل أمر
    // تفاعلي "تغيير نوع" فيحذف الأمر ويعاد إنشاؤه بمعرّف جديد فينكسر
    // اختصار الهوت كي المرتبط به ("الأمر المرتبط بهذا الاختصار محذوف")
    const newIsGift = actionType === "gift";
    const typeChanged =
      isEditing && newIsGift !== (oldEditingType === "gift");

    try {
      if (isEditing && typeChanged) {
        // ✅ التحويل عبر PUT لنقاط التعديل الموجودة — الخادم ينشئ النوع
        // الجديد ويحذف القديم ويُرحّل اختصارات الهوت كي للمعرّف الجديد
        // (كان DELETE+POST يترك الاختصار معلقاً على معرّف محذوف)
        let url, bodyData;
        if (oldEditingType === "gift") {
          // هدية → تفاعل/نطاق عملات: وجود type مختلف عن gift يفعّل
          // مسار التحويل في الخادم مع ترحيل الاختصارات
          url = `${__S.GIFT_API}/${oldEditingId}`;
          bodyData = {
            ...baseCommand,
            type: actionType,
            keyword,
            threshold,
            minDiamonds,
            maxDiamonds,
          };
        } else if (actionType === "gift" && giftId) {
          // تفاعل → هدية محددة: وجود giftId يفعّل مسار التحويل مع الترحيل
          url = `${__S.INTERACT_API}/${oldEditingId}`;
          bodyData = {
            ...baseCommand,
            giftId,
            giftName,
            minDiamonds,
            maxDiamonds,
          };
        } else {
          // تفاعل → نطاق عملات (بلا هدية محددة): نفس النموذج ونفس
          // المعرّف بنوع gift_range — لا حاجة لأي ترحيل
          url = `${__S.INTERACT_API}/${oldEditingId}`;
          bodyData = {
            ...baseCommand,
            type: "gift_range",
            keyword: "",
            threshold: 0,
            minDiamonds,
            maxDiamonds,
          };
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
        showMessage(
          "<i class='fas fa-circle-check'></i> تم تغيير نوع الأمر بنجاح",
        );
      } else if (isEditing) {
        // تحديث عادي (نفس النوع)
        let url, bodyData;
        if (oldEditingType === "gift") {
          if (!giftId && !isRangeGift) {
            showMessage(
              "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار الهدية المرتبطة بالأمر أو تحديد نطاق العملات",
            );
            return;
          }
          url = `${__S.GIFT_API}/${oldEditingId}`;
          bodyData = {
            ...baseCommand,
            giftId,
            giftName,
            minDiamonds,
            maxDiamonds,
          };
        } else {
          url = `${__S.INTERACT_API}/${oldEditingId}`;
          bodyData = {
            ...baseCommand,
            type: actionType,
            keyword,
            threshold,
            minDiamonds,
            maxDiamonds,
          };
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
        showMessage("<i class='fas fa-circle-check'></i> تم تحديث الأمر");
      } else {
        // إنشاء جديد
        let url, bodyData;
        if (actionType === "gift") {
          if (!giftId && !isRangeGift) {
            showMessage(
              "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار هدية أو تحديد نطاق العملات",
            );
            return;
          }
          url = __S.GIFT_API;
          bodyData = {
            ...baseCommand,
            giftId,
            giftName,
            minDiamonds,
            maxDiamonds,
          };
        } else {
          url = __S.INTERACT_API;
          bodyData = {
            ...baseCommand,
            type: actionType,
            keyword,
            threshold,
            minDiamonds,
            maxDiamonds,
          };
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
        showMessage("<i class='fas fa-circle-check'></i> تم إضافة الأمر");
        document.getElementById("shortcutData").value = "";
        document.getElementById("shortcutDisplay").textContent =
          "لم يتم التعيين";
        __S.currentShortcutCombo = "";
      }

      // ✅ الإغلاق بعد نجاح الحفظ فقط — عند الخطأ يبقى الكارت مفتوحاً
      hideAddCard();
      __S.tempUploadedFiles.audio = null;
      __S.tempUploadedFiles.video = null;
      await loadCommands();
    } catch (err) {
      console.error(err);
      showMessage(
        "<i class='fas fa-circle-xmark'></i> خطأ أثناء الحفظ: " + escapeHtml(err.message),
      );
      await loadCommands();
    }
  } finally {
    __S.saveInProgress = false;
    saveBtn.disabled = false;
    saveBtn.style.opacity = "";
    saveBtn.style.pointerEvents = "";
    saveBtn.innerHTML = originalBtnHtml;
  }
}

async function loadCommands(profileIdParam = null, noCache = false) {
  return withTableSkeleton(() => _loadCommandsImpl(profileIdParam, noCache));
}

async function _loadCommandsImpl(profileIdParam, noCache) {
  try {
    // إلغاء المؤقتات القديمة
    for (const [id, timer] of __S.autoSaveTimers) {
      clearTimeout(timer);
    }
    __S.autoSaveTimers.clear();

    const profileId = __S.currentUserSelectedProfile;
    const profileQuery = profileId ? `?profile=${profileId}` : "";
    const fetchOptions = noCache ? { cache: "no-store" } : {};

    const [gRes, iRes] = await Promise.all([
      fetchWithAuth(`${__S.GIFT_API}${profileQuery}`, fetchOptions).then((r) =>
        r.json(),
      ),
      fetchWithAuth(`${__S.INTERACT_API}${profileQuery}`, fetchOptions).then((r) =>
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

    // الترتيب حسب order ثم الأحدث أولاً عند التعادل —
    // حتى يظهر الأمر المُنشأ حديثاً (هدية أو تفاعل) في أول الجدول
    merged.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 0;
      const orderB = b.order !== undefined ? b.order : 0;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    window.currentCommandsList = merged;

    const totalCommands = merged.length;
    let disabledCommandsSet = new Set();
    const warningDiv = document.getElementById("commandLimitWarning");
    const addBtn = document.querySelector(".add-btn");

    if (__S.currentUserPlan === "free") {
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
        if (!cmd.giftId && (cmd.minDiamonds != null || cmd.maxDiamonds != null)) {
          // أمر نطاقي — يعرض نطاق العملات بدل صورة هدية محددة
          const minTxt = cmd.minDiamonds != null ? cmd.minDiamonds : 0;
          const maxTxt = cmd.maxDiamonds != null ? cmd.maxDiamonds : "∞";
          giftCellContent = `<span style="color:#ffd54f; font-weight:700; font-size:12px; white-space:nowrap;" title="أمر نطاق العملات"><i class="fas fa-gift"></i> ${minTxt} - ${maxTxt} <i class="fas fa-gem"></i></span>`;
        } else {
          // ✅ هدية واحدة: حجمها الطبيعي — عدة هدايا: مصغرة متفرقة بشكل جميل
          const imgs = getGiftImages(cmd.giftId);
          if (imgs.length === 1) {
            giftCellContent = `<img src="${safeImageUrl(imgs[0].url)}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${escapeHtml(imgs[0].name)}">`;
          } else if (imgs.length > 1) {
            const giftHtml = imgs
              .map(
                (g) =>
                  `<img src="${safeImageUrl(g.url)}" style="width:22px;height:22px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" title="${escapeHtml(g.name)}">`,
              )
              .join("");
            giftCellContent = `<span style="display:inline-flex; align-items:center; gap:5px; flex-wrap:wrap; justify-content:center; max-width:130px;">${giftHtml}</span>`;
          } else {
            giftCellContent = `<i class="fas fa-gift" style="color:#ffd54f; font-size:15px;" title="${escapeHtml(cmd.giftName || cmd.name || "")}"></i>`;
          }
        }
      } else {
        let iconFile = "";
        const actionType = cmd.type || "";
        if (
          (actionType === "gift" &&
            (cmd.minDiamonds != null || cmd.maxDiamonds != null)) ||
          actionType === "gift_range"
        ) {
          // أمر نطاق عملات — يعرض النطاق بدل الأيقونة
          const minTxt = cmd.minDiamonds != null ? cmd.minDiamonds : 0;
          const maxTxt = cmd.maxDiamonds != null ? cmd.maxDiamonds : "∞";
          giftCellContent = `<span style="color:#ffd54f; font-weight:700; font-size:12px; white-space:nowrap;" title="نطاق العملات"><i class="fas fa-coins"></i> ${minTxt} - ${maxTxt} <i class="fas fa-gem"></i></span>`;
        } else {
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
              // ✅ الديفولت عند عدم اختيار تفاعل: nothing.png
              iconFile = "nothing.png";
          }
          giftCellContent = `<img src="images/${iconFile}" style="width:30px;height:30px;object-fit:cover;border-radius:4px;vertical-align:middle;" onerror="this.style.display='none'" title="${escapeHtml(actionType)}">`;
        }
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
        commandCellContent = `<div style="font-size:12px; color:#1dd9e6e1; word-break:break-all;"><i class="fas fa-link"></i> ${safeWebhook}</div>`;
      } else if (hasCombo) {
        const safeCombo = escapeHtml(decodeHtmlEntities(cmd.combo));
        commandCellContent = `<div style="font-size:12px; color:#ff9800;"><i class="fas fa-keyboard"></i> ${safeCombo}</div>`;
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
              if (id && __S.autoSaveTimers.has(id)) {
                clearTimeout(__S.autoSaveTimers.get(id));
                __S.autoSaveTimers.delete(id);
              }
              saveRowFromTr(tr);
            });
          } else {
            inp.addEventListener("input", () => scheduleAutoSave(tr));
            inp.addEventListener("blur", () => {
              const id = tr.dataset.id;
              if (id && __S.autoSaveTimers.has(id)) {
                clearTimeout(__S.autoSaveTimers.get(id));
                __S.autoSaveTimers.delete(id);
              }
              saveRowFromTr(tr);
            });
          }
        });
      }
    });

    enableDragAndDrop();
    // تحديث قائمة أوامر الهوت كي فقط — بدون applyHotkeySettings (تمس النموذج
    // وتعيد تسجيل الاختصارات) وبدون renderHotkeysList (تكرار سكيلتون بلا داعٍ)
    loadHotkeyCommands();
  } catch (err) {
    console.error("خطأ في تحميل الأوامر:", err);
  }
}
window.loadCommands = loadCommands;

function scheduleAutoSave(tr) {
  const id = tr.dataset.id;
  if (!id) return;
  if (__S.autoSaveTimers.has(id)) clearTimeout(__S.autoSaveTimers.get(id));
  const t = setTimeout(() => {
    __S.autoSaveTimers.delete(id);
    saveRowFromTr(tr);
  }, 800);
  __S.autoSaveTimers.set(id, t);
}

async function saveRowFromTr(tr) {
  const id = tr.dataset.id;
  const rowType = tr.dataset.type;
  if (!id)
    return showMessage(
      "<i class='fas fa-triangle-exclamation'></i> لا يمكن حفظ أمر بدون ID",
    );
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
  // ✅ الحقول الأساسية — تُرسل فقط عند وجودها فعلاً (null كان يرفض
  // طلبات التفاعلات ويفشل الحفظ صامتاً)
  const rowGiftId = (tr.dataset.giftId || "").trim();
  const rowGiftName = (tr.dataset.giftName || "").trim();
  if (rowGiftId) body.giftId = rowGiftId;
  if (rowGiftName) body.giftName = rowGiftName;
  if (
    typeof body.type === "undefined" ||
    body.type === "" ||
    body.type === null
  ) {
    body.type =
      tr.dataset.actionKind || (rowType === "gift" ? "gift" : "comment");
  }
  if (!body.name || String(body.name).trim() === "") {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> لازم تحط اسم للأمر قبل الحفظ",
    );
    return;
  }
  const profileId = getSelectedProfileId();
  if (profileId) body.profile = profileId;

  try {
    const url =
      rowType === "gift" ? `${__S.GIFT_API}/${id}` : `${__S.INTERACT_API}/${id}`;
    const res = await fetchWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // ✅ كان يتجاهل رفض السيرفر — أي 400/500 كان يعرض "تم الحفظ" كذباً
    // والتعديل يضيع بدون أي إشعار
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const detail = Array.isArray(errData.errors) && errData.errors[0]?.msg
        ? errData.errors[0].msg
        : errData.message || `فشل الحفظ (${res.status})`;
      showMessage(
        `<i class='fas fa-circle-xmark'></i> لم يتم الحفظ: ${escapeHtml(detail)}`,
      );
      return;
    }
    showMessage("<i class='fas fa-circle-check'></i> تم الحفظ تلقائيًا");
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ أثناء الحفظ");
  }
}

async function moveRowUp(tr) {
  const prev = tr.previousElementSibling;
  if (!prev) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> هذا الأمر في الأعلى بالفعل",
    );
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
    const res = await fetchWithAuth(`${__S.API_BASE}/api/commands/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    if (!data.success) {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل حفظ الترتيب، جاري استعادة الحالة السابقة",
      );
      await loadCommands();
    } else {
      showMessage("<i class='fas fa-circle-check'></i> تم نقل الأمر لأعلى");
    }
  } catch (err) {
    console.error(err);
    showMessage(
      "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال، جاري استعادة الحالة السابقة",
    );
    await loadCommands();
  }
}

async function moveRowDown(tr) {
  const next = tr.nextElementSibling;
  if (!next) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> هذا الأمر في الأسفل بالفعل",
    );
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
    const res = await fetchWithAuth(`${__S.API_BASE}/api/commands/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    if (!data.success) {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل حفظ الترتيب، جاري استعادة الحالة السابقة",
      );
      await loadCommands();
    } else {
      showMessage("<i class='fas fa-circle-check'></i> تم نقل الأمر لأسفل");
    }
  } catch (err) {
    console.error(err);
    showMessage(
      "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال، جاري استعادة الحالة السابقة",
    );
    await loadCommands();
  }
}

async function executeCommand(id, rowType) {
  // تنفيذ مباشر بدون سكيلتون — التجربة لا تغطي قسم الأكشنز بطبقة تحميل
  return _executeCommandImpl(id, rowType);
}

async function _executeCommandImpl(id, rowType) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (!tr) {
    // ✅ مسار احتياطي (من الهوت كي غالباً): الصف غير موجود في الجدول —
    // ننفذ مباشرة عبر API بدون الحاجة للصف، وإن كان الأمر محذوفاً
    // تظهر رسالة واضحة بدل "لم يتم العثور على السطر" المبهمة
    try {
      const url =
        rowType === "gift"
          ? `${__S.GIFT_API}/${id}/execute`
          : `${__S.INTERACT_API}/${id}/execute`;
      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });
      if (res.status === 404) {
        return showMessage(
          "<i class='fas fa-triangle-exclamation'></i> الأمر المرتبط بهذا الاختصار محذوف — افتح الهوت كي واربطه بأمر جديد",
        );
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return showMessage(
          `<i class='fas fa-circle-xmark'></i> ${escapeHtml(errData.message || "فشل التنفيذ")}`,
        );
      }
      return showMessage("<i class='fas fa-circle-check'></i> تم تنفيذ الأمر");
    } catch (err) {
      console.error(err);
      return showMessage(
        "<i class='fas fa-circle-xmark'></i> خطأ في تنفيذ الأمر",
      );
    }
  }
  const activeCheckbox = tr.querySelector(".active-checkbox");
  const isActive = !!(activeCheckbox && activeCheckbox.checked);
  if (!isActive)
    return showMessage(
      "<i class='fas fa-triangle-exclamation'></i> الأمر متوقف لأنه غير مفعل",
    );

  showMessage("<i class='fas fa-bolt'></i> جاري تنفيذ الأمر...");

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
      rowType === "gift" ? `${__S.GIFT_API}/${id}` : `${__S.INTERACT_API}/${id}`;
    await fetchWithAuth(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // ✅ بلا active هنا: التنفيذ لا يتم إلا والأمر مفعل، وإلغاء
        // التفعيل يُحفظ بمسار تغيير الصندوق الخاص — كان إرسال active:true
        // مع كل تنفيذ يتسابق مع PUT إلغاء التفعيل ومع Mongo البطيء
        // فيهبط القديم بعده فيرجع الأمر "أكتيف لوحده"
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
        ? `${__S.GIFT_API}/${id}/execute`
        : `${__S.INTERACT_API}/${id}/execute`;
    const execRes = await fetchWithAuth(execUrl, { method: "POST" });
    if (execRes.ok) {
      showMessage("<i class='fas fa-circle-check'></i> تم تنفيذ الأمر بنجاح");
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل تنفيذ الأمر — راجع الكونسول",
      );
    }
  } catch (err) {
    console.error("خطأ أثناء تنفيذ الأمر:", err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ أثناء تنفيذ الأمر");
  }
}

async function deleteCommand(id, rowType) {
  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا الأمر؟",
    "حذف الأمر",
  );
  if (!confirmed) return;
  if (!id) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> معرف الأمر غير صالح",
    );
    return;
  }

  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    tr.remove();
    showMessage(
      "<i class='fas fa-trash-can'></i> تم حذف الأمر محلياً، جاري المزامنة مع الخادم...",
    );
  }
  if (__S.autoSaveTimers.has(id)) {
    clearTimeout(__S.autoSaveTimers.get(id));
    __S.autoSaveTimers.delete(id);
  }

  try {
    let audioFile = null;
    let videoFile = null;
    const url =
      rowType === "gift" ? `${__S.GIFT_API}/${id}` : `${__S.INTERACT_API}/${id}`;

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
          `${__S.API_BASE}/api/video/${encodeURIComponent(videoFile)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.warn("فشل حذف الفيديو:", err.message);
      }
    }
    if (audioFile) {
      try {
        await fetchWithAuth(
          `${__S.API_BASE}/api/audio/${encodeURIComponent(audioFile)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.warn("فشل حذف الصوت:", err.message);
      }
    }

    const deleteRes = await fetchWithAuth(url, { method: "DELETE" });
    if (deleteRes.ok) {
      showMessage("<i class='fas fa-circle-check'></i> تم حذف الأمر نهائياً");
    } else if (deleteRes.status === 404) {
      showMessage(
        "<i class='fas fa-trash-can'></i> الأمر غير موجود بالفعل (تم حذفه محلياً)",
      );
    } else {
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> فشل حذف الأمر من الخادم، لكن تم حذفه محلياً",
      );
    }
    await checkStorageNotifications();
  } catch (err) {
    console.error("❌ خطأ أثناء حذف الأمر:", err);
    showMessage(
      "<i class='fas fa-circle-xmark'></i> خطأ أثناء حذف الأمر: " + escapeHtml(err.message),
    );
    // ✅ إعادة الرسم بدون سكيلتون — الحذف لا يجب أن يُظهر صفحة تحميل
    await _loadCommandsImpl(true);
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
        const res = await fetchWithAuth(`${__S.API_BASE}/api/commands/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage(
            "<i class='fas fa-circle-check'></i> تم حفظ الترتيب الجديد",
          );
        } else {
          showMessage(
            "<i class='fas fa-circle-xmark'></i> فشل حفظ الترتيب، جاري الاستعادة",
          );
          await loadCommands();
        }
      } catch (err) {
        console.error(err);
        showMessage(
          "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال، جاري الاستعادة",
        );
        await loadCommands();
      }
    },
  });
}


export { updateInputsForType, captureOriginalFormValues, hasFormChanged, checkForChangesAndClose, showAddCard, _showAddCard, hideAddCard, confirmAdd, loadCommands, _loadCommandsImpl, scheduleAutoSave, saveRowFromTr, moveRowUp, moveRowDown, executeCommand, _executeCommandImpl, deleteCommand, enableDragAndDrop };
