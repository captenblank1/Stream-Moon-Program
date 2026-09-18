// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { withTableSkeleton } from "./auth-flow.js";
import { fetchWithAuth } from "./utils-core.js";
import { loadHotkeyCommands } from "./hotkeys.js";
import { renderHotkeysList } from "./hotkeys.js";
import { showMessage } from "./utils-core.js";
import { _loadCommandsImpl } from "./commands.js";

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

  if (__S.closeOptionsListener) {
    document.removeEventListener("click", __S.closeOptionsListener);
    __S.closeOptionsListener = null;
  }

  const newOptionsUl = optionsUl.cloneNode(false);
  optionsUl.parentNode.replaceChild(newOptionsUl, optionsUl);
  const finalOptionsUl = newOptionsUl;

  async function selectProfile(profileId) {
    // إغلاق قائمة البروفايلات فوراً + سكيلتون الجدول يبدأ لحظة الاختيار
    // ويغطي التبديل وإعادة تحميل الأوامر حتى تجهز بيانات البروفايل الجديد
    const optionsUlNew = document.querySelector("#select-profile .options");
    if (optionsUlNew) optionsUlNew.style.display = "none";
    return withTableSkeleton(async () => {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/profile/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileId }),
      });
      const data = await res.json();
      if (data.success) {
        __S.currentUserSelectedProfile = profileId;
        await loadProfilesData();
        // تحديث بيانات الهوت كي في الخلفية لتعكس البروفايل الجديد
        loadHotkeyCommands();
        renderHotkeysList();
        showMessage(
          `<i class="fas fa-circle-check"></i> تم التبديل إلى ${__S.profileNames[profileId] || `Profile ${profileId}`}`,
        );
      } else {
        showMessage("<i class='fas fa-circle-xmark'></i> فشل تبديل البروفايل");
      }
    });
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

  __S.closeOptionsListener = function closeOptions() {
    finalOptionsUl.style.display = "none";
  };
  document.addEventListener("click", __S.closeOptionsListener);
}

// جلب بيانات البروفايلات + رسم القائمة + تحميل أوامر البروفايل مباشرة
// (بدون غلاف سكيلتون — يُستدعى داخل withTableSkeleton عند تبديل البروفايل
// لتجنب انتظار دائري مع الطبقة الجارية)
async function loadProfilesData() {
  const res = await fetchWithAuth(`${__S.API_BASE}/api/profiles`);
  if (!res.ok) throw new Error("فشل تحميل البروفايلات");
  const data = await res.json();
  if (data.success && data.profiles) {
    __S.profileNames = {};
    data.profiles.forEach((p) => {
      __S.profileNames[p.id] = p.name;
    });
    if (
      __S.currentUserSelectedProfile &&
      data.profiles.some((p) => p.id === __S.currentUserSelectedProfile)
    ) {
      renderProfileSelect(data.profiles, __S.currentUserSelectedProfile);
    } else {
      const firstProfileId = data.profiles[0]?.id || 1;
      renderProfileSelect(data.profiles, firstProfileId);
    }
    await _loadCommandsImpl();
  }
}

async function loadProfiles() {
  try {
    await loadProfilesData();
  } catch (err) {
    console.warn("⚠️ فشل تحميل البروفايلات:", err.message);
  }
}

async function updateProfileName(profileId, newName) {
  try {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/profile/${profileId}/name`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      },
    );
    const data = await res.json();
    if (data.success) {
      __S.profileNames[profileId] = newName;
      showMessage("<i class='fas fa-circle-check'></i> تم تحديث اسم البروفايل");
      await loadProfiles();
    } else showMessage("<i class='fas fa-circle-xmark'></i> فشل تحديث الاسم");
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
  }
}


export { renderProfileSelect, loadProfilesData, loadProfiles, updateProfileName };
