// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { getSelectedProfileId } from "./pairing.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { buildCommandSelectionTable } from "./export-import.js";
import { refreshExistingCommands } from "./export-import.js";
import { buildDuplicateTable } from "./export-import.js";
import { loadCommands } from "./commands.js";
import { loadHotkeyCommands } from "./hotkeys.js";
import { applyHotkeySettings } from "./hotkeys.js";

// ============================================================
// جدول اختصارات البروفايل في مودال الأوامر (نسخ/اضافة البروفايل)
// ============================================================
async function loadCurrentProfileHotkeys() {
  const profileId = getSelectedProfileId();
  if (!profileId) {
    __S.currentProfileHotkeys = [];
    return;
  }
  try {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/hotkey?profile=${profileId}`,
    );
    const data = await res.json();
    __S.currentProfileHotkeys = data.success && data.hotkeys ? data.hotkeys : [];
  } catch (err) {
    console.warn("فشل تحميل اختصارات البروفايل", err);
    __S.currentProfileHotkeys = [];
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
    if (ref.combo) parts.push(`<i class="fas fa-keyboard"></i> ${ref.combo}`);
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

  const existingKeys = new Set(__S.currentProfileHotkeys.map((h) => h.key));

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
  __S.currentCommandModalMode = "export";
  document.getElementById("copyTargetWrap").style.display = "none";
  document.getElementById("select-all-label").textContent = "تحديد الكل";
  document.getElementById("commandModalTitle").textContent = "تصدير الأوامر";
  document.getElementById("confirmCommandAction").textContent = "تحميل";
  document.getElementById("duplicateCommandsArea").style.display = "none";
  hideHotkeysSelectionArea();

  const profileId = getSelectedProfileId();
  if (!profileId) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> اختر بروفايل أولاً",
    );
    return;
  }
  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${__S.GIFT_API}?profile=${profileId}`).then((r) => r.json()),
      fetchWithAuth(`${__S.INTERACT_API}?profile=${profileId}`).then((r) =>
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
    showMessage("<i class='fas fa-circle-xmark'></i> فشل تحميل الأوامر");
  }
}

async function showImportModal() {
  __S.currentCommandModalMode = "import";
  document.getElementById("copyTargetWrap").style.display = "none";
  // مربع الرأس = تحديد الكل للأوامر المراد استيرادها (مثل التصدير)
  document.getElementById("select-all-label").textContent = "تحديد الكل";
  document.getElementById("commandModalTitle").textContent = "استيراد الأوامر";
  document.getElementById("confirmCommandAction").textContent = "إضافة";
  document.getElementById("duplicateCommandsArea").style.display = "none";
  document.getElementById("duplicateTableBody").innerHTML = "";
  hideHotkeysSelectionArea();

  await refreshExistingCommands();
  await loadCurrentProfileHotkeys();

  __S.nonDuplicateCommands = [];
  __S.duplicateCommands = [];

  for (const cmd of __S.importedCommands) {
    let isDuplicate = false;
    if (cmd.giftId !== undefined && cmd.giftId !== null) {
      // ✅ كشف التكرار مع أوامر الهدايا المتعددة — أي تقاطع هويات يُعتبر تكراراً
      const ids = String(cmd.giftId)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      isDuplicate = ids.some((id) => __S.existingCommandsMap.has(`gift_${id}`));
    } else {
      let key = `interact_${cmd.type}`;
      if (cmd.type === "comment") key += `_${cmd.keyword || ""}`;
      else if (cmd.type === "like") key += `_${cmd.threshold || 0}`;
      else key += `_${cmd.keyword || ""}`;
      isDuplicate = __S.existingCommandsMap.has(key);
    }
    if (isDuplicate) {
      __S.duplicateCommands.push(cmd);
    } else {
      __S.nonDuplicateCommands.push(cmd);
    }
  }

  buildCommandSelectionTable(__S.nonDuplicateCommands, true);

  if (__S.duplicateCommands.length > 0) {
    document.getElementById("duplicateCommandsArea").style.display = "block";
    buildDuplicateTable(__S.duplicateCommands);
  }

  // جدول اختصارات الملف
  document.getElementById("hotkeysAreaTitle").textContent =
    "اختصارات الملف — حدد ما تريد استيراده";
  document.getElementById("select-all-hotkeys-label").textContent =
    "تحديد الكل";
  buildHotkeySelectionTable(
    __S.importedHotkeys.map((h) => ({ ...h, __fromFile: true })),
    "import",
  );
  setupHotkeySelectAll();

  // مربع الرأس: تحديد الكل لأوامر الجدول الرئيسي (غير المكرر)
  const selectAll = document.getElementById("select-all-commands");
  selectAll.checked = true;
  selectAll.onchange = function () {
    document
      .querySelectorAll("#commandSelectionTableBody .command-checkbox")
      .forEach((cb) => (cb.checked = this.checked));
  };

  // «استبدال الكل» يعيش داخل جدول المكرر — يتحكم في كل مربعات الاستبدال
  const dupSelectAll = document.getElementById("duplicate-select-all");
  if (dupSelectAll) {
    dupSelectAll.checked = true;
    dupSelectAll.onchange = function () {
      document
        .querySelectorAll(".duplicate-replace-checkbox")
        .forEach((cb) => (cb.checked = this.checked));
    };
  }

  document.querySelectorAll(".duplicate-replace-checkbox").forEach((cb) => {
    cb.addEventListener("change", function () {
      const all = document.querySelectorAll(".duplicate-replace-checkbox");
      const checked = document.querySelectorAll(
        ".duplicate-replace-checkbox:checked",
      );
      if (dupSelectAll)
        dupSelectAll.checked = all.length === checked.length;
    });
  });

  let isSharedExport = false;
  for (const cmd of __S.importedCommands) {
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
  showMessage(
    "<i class='fas fa-circle-check'></i> تم التحميل إلى مجلد التنزيلات",
  );
}

// --- نسخ البروفايل (الواجهة القديمة: يعمل تلقائياً على البروفايل الحالي) ---
// مثل الأصل تماماً: يفتح قائمة أوامر البروفايل الحالي وتحمّل الملف المشفر
async function showCopyProfileModal() {
  const sourceId = getSelectedProfileId();
  if (!sourceId) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> اختر بروفايل أولاً",
    );
    return;
  }
  __S.currentCommandModalMode = "copy";
  document.getElementById("copyTargetWrap").style.display = "none";
  document.getElementById("select-all-label").textContent = "تحديد الكل";
  document.getElementById("commandModalTitle").textContent = "تصدير الأوامر";
  document.getElementById("confirmCommandAction").textContent = "تحميل";
  document.getElementById("duplicateCommandsArea").style.display = "none";

  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${__S.GIFT_API}?profile=${sourceId}`).then((r) => r.json()),
      fetchWithAuth(`${__S.INTERACT_API}?profile=${sourceId}`).then((r) =>
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
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> لا توجد أوامر في هذا البروفايل لنسخها",
      );
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
    buildHotkeySelectionTable(__S.currentProfileHotkeys, "copy");
    setupHotkeySelectAll();

    document.getElementById("commandSelectionModal").style.display = "flex";
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> فشل تحميل الأوامر");
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
    showMessage(
      "<i class='fas fa-spinner fa-spin'></i> جارٍ قراءة الملف من الخادم...",
    );
    try {
      const formData = new FormData();
      formData.append("tfcFile", file);
      const res = await fetchWithAuth(`${__S.API_BASE}/api/profiles/parse-file`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.success || !Array.isArray(data.commands)) {
        showMessage(
          "<i class='fas fa-circle-xmark'></i> " +
            (escapeHtml(data.message || "ملف غير صالح")),
        );
        return;
      }
      showMessage(
        `<i class="fas fa-circle-check"></i> تم قراءة ${data.commands.length} أمر من الملف`,
      );
      __S.importedCommands = data.commands;
      __S.importedHotkeys = Array.isArray(data.hotkeys) ? data.hotkeys : [];
      showImportModal();
    } catch (err) {
      console.error(err);
      showMessage(
        "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال أثناء قراءة الملف",
      );
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

      if (__S.currentCommandModalMode === "copy") {
        // مثل القديم: يعمل تلقائياً على البروفايل الحالي - تصدير الأوامر المحددة
        const sourceId = getSelectedProfileId();
        if (!sourceId) {
          showMessage(
            "<i class='fas fa-triangle-exclamation'></i> لا يوجد بروفايل محدد",
          );
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
          showMessage(
            "<i class='fas fa-triangle-exclamation'></i> لم تختر أي أمر",
          );
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
            __S.currentProfileHotkeys[i] && __S.currentProfileHotkeys[i]._id
              ? String(__S.currentProfileHotkeys[i]._id)
              : null,
          )
          .filter(Boolean);

        // تصدير ملف .tfc مشفر من الباك اند للمشاركة مع الآخرين
        try {
          const res = await fetchWithAuth(
            `${__S.API_BASE}/api/profiles/export-file/${sourceId}?commandIds=${encodeURIComponent(commandIds.join(","))}` +
              (hotkeyIds.length > 0
                ? `&hotkeyIds=${encodeURIComponent(hotkeyIds.join(","))}`
                : ""),
          );
          if (!res.ok) {
            let msg = "";
            try {
              msg = (await res.json()).message || "";
            } catch {}
            showMessage(
              "<i class='fas fa-circle-xmark'></i> فشل تصدير الملف: " + msg,
            );
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
            "<i class='fas fa-circle-check'></i> تم تحميل الملف المشفر — أرسله لمن تريد، لا يُفتح إلا داخل التطبيق",
          );
          document.getElementById("commandSelectionModal").style.display =
            "none";
        } catch (err) {
          console.error(err);
          showMessage(
            "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال أثناء التصدير",
          );
        }
      } else if (__S.currentCommandModalMode === "export") {
        const profileId = getSelectedProfileId();
        if (!profileId) {
          showMessage(
            "<i class='fas fa-triangle-exclamation'></i> لا يوجد بروفايل محدد",
          );
          return;
        }
        // التصدير يتم من الباك اند: ملف .tfc مشفر بالكامل (AES-256-GCM)
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/profiles/export-file/${profileId}`,
        );
        if (!res.ok) {
          let msg = "";
          try {
            msg = (await res.json()).message || "";
          } catch {}
          showMessage(
            "<i class='fas fa-circle-xmark'></i> فشل تصدير البروفايل: " + msg,
          );
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
        showMessage(
          "<i class='fas fa-circle-check'></i> تم تحميل البروفايل المشفر (.tfc)",
        );
        document.getElementById("commandSelectionModal").style.display = "none";
      } else if (__S.currentCommandModalMode === "import") {
        const selectedNonDuplicateIndices = Array.from(
          document.querySelectorAll(
            "#commandSelectionTableBody .command-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const selectedNonDuplicate = selectedNonDuplicateIndices.map(
          (i) => __S.nonDuplicateCommands[i],
        );
        const replaceChecks = document.querySelectorAll(
          ".duplicate-replace-checkbox:checked",
        );
        const selectedDuplicateIndices = Array.from(replaceChecks).map((cb) =>
          parseInt(cb.dataset.index),
        );
        const selectedDuplicate = selectedDuplicateIndices.map(
          (i) => __S.duplicateCommands[i],
        );

        // الاختصارات المحددة من ملف .tfc
        const selectedHotkeyIndices = Array.from(
          document.querySelectorAll(
            "#hotkeysSelectionTbody .hotkey-checkbox:checked",
          ),
        ).map((cb) => parseInt(cb.dataset.index));
        const selectedHotkeys = selectedHotkeyIndices
          .map((i) => __S.importedHotkeys[i])
          .filter(Boolean);

        if (
          selectedNonDuplicate.length === 0 &&
          selectedDuplicate.length === 0 &&
          selectedHotkeys.length === 0
        ) {
          showMessage(
            "<i class='fas fa-triangle-exclamation'></i> لم تختر أي أمر",
          );
          return;
        }

        const profileId = getSelectedProfileId();

        if (window.isSharedExport) {
          const allSelected = [...selectedNonDuplicate, ...selectedDuplicate];
          if (allSelected.length === 0 && selectedHotkeys.length === 0) {
            showMessage(
              "<i class='fas fa-triangle-exclamation'></i> لم تختر أي أمر",
            );
            return;
          }
          const gifts = allSelected.filter(
            (c) => c.giftId || c.__type === "gift",
          );
          // ⚠️ الأوامر المحددة نفسها هي ما يُرسل — كان يُرسل __S.gifts
          // (كتالوج الهدايا العام بلا giftId) فتفشل كل أوامر الهدايا في
          // الخادم بـ "giftId is required" ولا يُستورد إلا التفاعلات
          const interactions = allSelected.filter((c) => !gifts.includes(c));

          try {
            const res = await fetchWithAuth(
              `${__S.API_BASE}/api/profiles/import-shared`,
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
                "<i class='fas fa-circle-check'></i> تم استيراد البروفايل المشترك بنجاح (مع رفع الوسائط)",
              );
              await loadCommands(true);
              await loadHotkeyCommands();
              await applyHotkeySettings();
            } else {
              showMessage(
                "<i class='fas fa-circle-xmark'></i> فشل استيراد البروفايل المشترك: " +
                  (escapeHtml(data.message || "خطأ غير معروف")),
              );
            }
          } catch (err) {
            console.error(err);
            showMessage(
              "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال أثناء الاستيراد المشترك",
            );
          }
        } else {
          let importSuccess = true;
          let hotkeysSent = selectedHotkeys.length === 0;
          try {
            if (selectedNonDuplicate.length > 0) {
              const res = await fetchWithAuth(
                `${__S.API_BASE}/api/profiles/import`,
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
                  "<i class='fas fa-circle-xmark'></i> فشل استيراد الأوامر الجديدة: " +
                    (escapeHtml(data.message || "خطأ غير معروف")),
                );
              }
            } else if (selectedHotkeys.length > 0) {
              // استيراد اختصارات فقط بدون أوامر
              const res = await fetchWithAuth(
                `${__S.API_BASE}/api/profiles/import`,
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
                  "<i class='fas fa-circle-xmark'></i> فشل استيراد الاختصارات: " +
                    (escapeHtml(data.message || "خطأ غير معروف")),
                );
              }
            }
            if (importSuccess && selectedDuplicate.length > 0) {
              const res = await fetchWithAuth(
                `${__S.API_BASE}/api/profiles/import`,
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
                  "<i class='fas fa-circle-xmark'></i> فشل استيراد الأوامر المكررة: " +
                    (escapeHtml(data.message || "خطأ غير معروف")),
                );
              }
            }
          } catch (err) {
            console.error(err);
            importSuccess = false;
            showMessage(
              "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال أثناء الاستيراد",
            );
          }
          if (importSuccess) {
            showMessage(
              "<i class='fas fa-circle-check'></i> تم الاستيراد بنجاح",
            );
            await loadCommands(true);
            await loadHotkeyCommands();
            await applyHotkeySettings();
          }
        }
        document.getElementById("commandSelectionModal").style.display = "none";
      }
    } catch (err) {
      console.error(err);
      showMessage(
        "<i class='fas fa-circle-xmark'></i> حدث خطأ غير متوقع: " + escapeHtml(err.message),
      );
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


export { loadCurrentProfileHotkeys, describeHotkeyCommand, buildHotkeySelectionTable, setupHotkeySelectAll, hideHotkeysSelectionArea, showExportModal, showImportModal, downloadJSON, fallbackDownload, showCopyProfileModal, showAddProfileFromFile };
