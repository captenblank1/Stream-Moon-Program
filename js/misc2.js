// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { deleteAudioFile } from "./audio.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { deleteVideoFile } from "./video.js";
import { checkStorageNotifications } from "./storage.js";
import { getSelectedProfileId } from "./pairing.js";
import { showConfirm } from "./utils-core.js";
import { loadCommands } from "./commands.js";
import { renderProfileSelect } from "./profiles.js";

// ============================================================
// دوال مساعدة إضافية
// ============================================================
function clearAudio() {
  if (__S.tempUploadedFiles.audio) {
    deleteAudioFile(__S.tempUploadedFiles.audio, true)
      .then(() => {
        __S.tempUploadedFiles.audio = null;
      })
      .catch(() => {});
    document.getElementById("audioSelect").value = "";
    document.querySelector("#audioDropdown .selected").textContent =
      "اختر صوت...";
    if (__S.currentAudio) {
      __S.currentAudio.pause();
      __S.currentAudio.currentTime = 0;
    }
    return;
  }

  if (__S.editingId && __S.editingType) {
    const body = { audio: "" };
    const url =
      __S.editingType === "gift"
        ? `${__S.GIFT_API}/${__S.editingId}`
        : `${__S.INTERACT_API}/${__S.editingId}`;
    fetchWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(() => {
        showMessage(
          "<i class='fas fa-circle-check'></i> تم إزالة الصوت من الأمر",
        );
        document.getElementById("audioSelect").value = "";
        document.querySelector("#audioDropdown .selected").textContent =
          "اختر صوت...";
        if (__S.currentAudio) {
          __S.currentAudio.pause();
          __S.currentAudio.currentTime = 0;
        }
      })
      .catch(() =>
        showMessage("<i class='fas fa-circle-xmark'></i> فشل تحديث الأمر"),
      );
    return;
  }

  document.getElementById("audioSelect").value = "";
  document.querySelector("#audioDropdown .selected").textContent =
    "اختر صوت...";
  if (__S.currentAudio) {
    __S.currentAudio.pause();
    __S.currentAudio.currentTime = 0;
  }
}

function clearVideo() {
  if (__S.tempUploadedFiles.video) {
    deleteVideoFile(__S.tempUploadedFiles.video, true)
      .then(() => {
        __S.tempUploadedFiles.video = null;
        document.getElementById("video").value = "";
        document.getElementById("videoInput").value = "";
        document.getElementById("videoPreview").innerHTML = "";
        document.getElementById("videoFileName").textContent = "";
      })
      .catch(() => {});
    return;
  }

  if (__S.editingId && __S.editingType) {
    __S.videoWasCleared = true;
    const videoFileName = document.getElementById("video").value;
    if (!videoFileName) return;
    const url =
      __S.editingType === "gift"
        ? `${__S.GIFT_API}/${__S.editingId}`
        : `${__S.INTERACT_API}/${__S.editingId}`;
    fetchWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: "" }),
    })
      .then(() => {
        showMessage(
          "<i class='fas fa-circle-check'></i> تم إزالة الفيديو من الأمر",
        );
        document.getElementById("video").value = "";
        document.getElementById("videoInput").value = "";
        document.getElementById("videoPreview").innerHTML = "";
        document.getElementById("videoFileName").textContent = "";
        checkStorageNotifications();
      })
      .catch(() =>
        showMessage("<i class='fas fa-circle-xmark'></i> فشل تحديث الأمر"),
      );
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
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> لم يتم تحديد بروفايل",
    );
    return;
  }
  const profileName = __S.profileNames[profileId] || `Profile ${profileId}`;
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
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> لازم تختار Profile قبل الحذف",
      );
      closeModal();
      return;
    }
    const profileQuery = `?profile=${encodeURIComponent(profileId)}`;
    const [gRes, iRes] = await Promise.all([
      fetchWithAuth(`${__S.GIFT_API}${profileQuery}`, { method: "DELETE" }),
      fetchWithAuth(`${__S.INTERACT_API}${profileQuery}`, { method: "DELETE" }),
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
        `<i class="fas fa-trash-can"></i> تم حذف أوامر Profile ${profileId} — ${messages.join(" | ")}`,
      );
    else
      showMessage(
        `<i class="fas fa-triangle-exclamation"></i> حصلت مشاكل أثناء الحذف — راجع الكونسول`,
      );
    await loadCommands();
    await checkStorageNotifications();
    closeModal();
  } catch (err) {
    console.error("خطأ أثناء deleteAll:", err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ أثناء الحذف");
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
  if (__S.currentUserSelectedProfile) {
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/profiles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("فشل جلب البروفايلات");
      const j = await res.json();
      const profiles = j && j.profiles ? j.profiles : [];
      if (profiles.length > 0) {
        const exists = profiles.some(
          (p) => p.id === __S.currentUserSelectedProfile,
        );
        if (exists) {
          const labelEl = document.getElementById("current-profile-label");
          const nameDisplayEl = document.getElementById(
            "current-profile-name-display",
          );
          if (labelEl)
            labelEl.textContent = `Profile ${__S.currentUserSelectedProfile}`;
          if (nameDisplayEl) {
            nameDisplayEl.textContent =
              __S.profileNames[__S.currentUserSelectedProfile] ||
              `Profile ${__S.currentUserSelectedProfile}`;
          }
          renderProfileSelect(profiles, __S.currentUserSelectedProfile);
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
      const res = await fetchWithAuth(`${__S.API_BASE}/api/profiles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`فشل جلب البروفايلات (${res.status})`);
      const j = await res.json();
      const profiles = j && j.profiles ? j.profiles : [];
      if (profiles.length > 0) {
        const labelEl = document.getElementById("current-profile-label");
        const firstProfile = profiles[0].id;
        if (labelEl) labelEl.textContent = `Profile ${firstProfile}`;
        __S.profileNames = {};
        profiles.forEach((p) => {
          __S.profileNames[p.id] = p.name;
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


export { clearAudio, clearVideo, confirmDeleteAll, closeModal, deleteAll, safeJsonOrText, ensureProfileLoaded };
