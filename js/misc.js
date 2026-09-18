// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { updateClearShortcutButton } from "./pairing.js";
import { showMessage } from "./utils-core.js";

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
  // أزرار النام باد تُسجل بأسمائها المستقلة (Num7 لا 7) حتى يستجيب لها الهوت كي
  if (key.classList.contains("numpad")) {
    const np = key.textContent.trim();
    const npMap = {
      ".": "Num.",
      "/": "Num/",
      "-": "Num-",
      "+": "+",
      "*": "*",
      "↵": "NumEnter",
      Num: "Num",
    };
    const mapped = /^\d$/.test(np) ? "Num" + np : npMap[np];
    if (mapped) {
      document.getElementById("modalSelectedKey").value = mapped;
      document.getElementById("modalSelectedKeyDisplay").textContent = mapped;
      return;
    }
  }
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
      __S.currentShortcutCombo = "";
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
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> يرجى اختيار مفتاح",
        );
        return;
      }
      let combo = "";
      if (ctrl) combo += "Ctrl+";
      if (alt) combo += "Alt+";
      if (shift) combo += "Shift+";
      combo += key;
      document.getElementById("shortcutData").value = combo;
      document.getElementById("shortcutDisplay").textContent = combo;
      __S.currentShortcutCombo = combo;
      updateClearShortcutButton();
      closeKeyboardShortcutModal();
      showMessage(
        "<i class='fas fa-circle-check'></i> تم تعيين الاختصار: " + combo,
      );
    });
  }
  const closeModalBtn = document.querySelector(
    "#keyboardShortcutModal .close-modal",
  );
  if (closeModalBtn)
    closeModalBtn.addEventListener("click", closeKeyboardShortcutModal);
});


export { setSelectedKeyboardKey, handleKeyClick, openKeyboardShortcutModal, closeKeyboardShortcutModal };
