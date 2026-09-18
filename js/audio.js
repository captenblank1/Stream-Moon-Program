// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { escapeHtml } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { showConfirm } from "./utils-core.js";
import { checkStorageNotifications } from "./storage.js";

// ============================================================
// دوال الصوت (Audio)
// ============================================================
async function loadAudios() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/audio`);
    if (!res.ok) throw new Error(`فشل تحميل الأصوات: ${res.status}`);
    const data = await res.json();

    function getCleanDisplayName(filename) {
      let name = filename.replace(/^\/audios\//, "");
      name = name.replace(/\.[^/.]+$/, "");
      name = name.replace(/-\d+$/, "");
      name = name.replace(/-/g, " ");
      return name;
    }

    let audios = [];
    if (data.success && Array.isArray(data.audios)) {
      audios = data.audios.map((a) => ({
        file: a.file,
        owner: a.owner || (a.isDefault ? "افتراضي" : "غير معروف"),
        displayName: getCleanDisplayName(a.file),
        cloudinaryUrl: a.cloudinaryUrl,
        isDefault: a.isDefault || false,
      }));
    }

    __S.globalAudios = [
      ...audios.filter((a) => !a.isDefault),
      ...audios.filter((a) => a.isDefault),
    ];

    const modal = document.getElementById("audioModal");
    const modalSearch = document.getElementById("audioSearchInput");
    const modalContainer = document.getElementById("audioOptionsContainer");
    const closeModalBtn = document.querySelector(
      "#audioModal .close-audio-modal",
    );
    let selectedField = document.querySelector("#audioDropdown .selected");
    const hiddenInput = document.getElementById("audioSelect");

    if (!modal || !modalContainer || !selectedField) return;

    function renderModalOptions(filter = "") {
      if (!modalContainer) return;
      modalContainer.innerHTML = "";

      const filtered = __S.globalAudios.filter((a) =>
        a.displayName.toLowerCase().includes(filter.toLowerCase()),
      );

      if (filtered.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "audio-option";
        emptyDiv.style.justifyContent = "center";
        emptyDiv.innerHTML =
          "<i class='fas fa-circle-xmark'></i> لا توجد نتائج";
        modalContainer.appendChild(emptyDiv);
        return;
      }

      filtered.forEach((audio) => {
        const optionDiv = document.createElement("div");
        optionDiv.className = "audio-option";
        optionDiv.setAttribute("data-file", audio.file);

        const leftDiv = document.createElement("div");
        leftDiv.className = "audio-left";
        const icon = document.createElement("i");
        icon.className = "fas fa-music audio-icon";
        leftDiv.appendChild(icon);
        const nameDiv = document.createElement("div");
        const nameSpan = document.createElement("div");
        nameSpan.className = "audio-name";
        nameSpan.textContent = audio.displayName;
        const ownerSpan = document.createElement("div");
        ownerSpan.className = "audio-owner";
        ownerSpan.innerHTML = `<i class="fas fa-user-circle"></i> ${escapeHtml(audio.owner)}`;
        nameDiv.appendChild(nameSpan);
        nameDiv.appendChild(ownerSpan);
        leftDiv.appendChild(nameDiv);

        const rightDiv = document.createElement("div");
        rightDiv.className = "audio-right";
        const playBtn = document.createElement("button");
        playBtn.className = "play-audio-btn";
        playBtn.title = "تجربة الصوت";
        playBtn.innerHTML = '<i class="fas fa-play"></i> استماع';
        rightDiv.appendChild(playBtn);
        if (!audio.isDefault) {
          const delBtn = document.createElement("button");
          delBtn.className = "delete-audio-btn";
          delBtn.title = "حذف الصوت";
          delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
          rightDiv.appendChild(delBtn);
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteAudioFile(String(audio.file), false, false);
          });
        }

        optionDiv.appendChild(leftDiv);
        optionDiv.appendChild(rightDiv);

        playBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (__S.currentAudioObj) {
            __S.currentAudioObj.pause();
            __S.currentAudioObj.currentTime = 0;
          }
          let audioUrl;
          if (audio.isDefault) {
            audioUrl = audio.cloudinaryUrl || `${__S.API_BASE}${audio.file}`;
          } else {
            if (audio.cloudinaryUrl) {
              audioUrl = audio.cloudinaryUrl;
            } else {
              showMessage(
                "<i class='fas fa-circle-xmark'></i> رابط الصوت غير متوفر، تأكد من رفعه بنجاح",
              );
              return;
            }
          }
          __S.currentAudioObj = new Audio(audioUrl);
          const volEl = document.getElementById("volume");
          const vol = volEl ? parseInt(volEl.value) || 100 : 100;
          __S.currentAudioObj.volume = Math.max(0, Math.min(1, vol / 100));
          __S.currentAudioObj.play().catch((err) => {
            console.error("فشل تشغيل الصوت:", err);
          });
        });

        optionDiv.addEventListener("click", () => {
          selectedField.textContent = audio.displayName;
          hiddenInput.value = audio.file;
          modalSearch.value = "";
          modal.style.display = "none";
          if (__S.currentAudioObj) {
            __S.currentAudioObj.pause();
            __S.currentAudioObj.currentTime = 0;
          }
        });

        modalContainer.appendChild(optionDiv);
      });
    }

    __S.renderModalOptionsGlobal = renderModalOptions;
    __S.audioModalGlobal = modal;
    __S.modalSearchGlobal = modalSearch;
    __S.selectedFieldGlobal = selectedField;
    __S.hiddenInputGlobal = hiddenInput;
    __S.currentAudioObjGlobal = __S.currentAudioObj;

    const newSelectedField = selectedField.cloneNode(true);
    selectedField.parentNode.replaceChild(newSelectedField, selectedField);
    const finalSelectedField = newSelectedField;
    selectedField = finalSelectedField;

    finalSelectedField.addEventListener("click", () => {
      renderModalOptions(modalSearch.value);
      modal.style.display = "flex";
      modalSearch.focus();
    });

    if (closeModalBtn) {
      closeModalBtn.onclick = () => {
        modal.style.display = "none";
        if (__S.currentAudioObj) {
          __S.currentAudioObj.pause();
          __S.currentAudioObj.currentTime = 0;
        }
      };
    }

    window.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        if (__S.currentAudioObj) {
          __S.currentAudioObj.pause();
          __S.currentAudioObj.currentTime = 0;
        }
      }
    };

    // ✅ ربط مرة واحدة — loadAudios تتكرر مع كل رفع وكانت تتراكم المستمعات
    if (!modalSearch._inputBound) {
      modalSearch.addEventListener("input", () =>
        renderModalOptions(modalSearch.value),
      );
      modalSearch._inputBound = true;
    }

    if (__S.globalAudios.length === 0) {
      finalSelectedField.innerHTML =
        "<i class='fas fa-triangle-exclamation'></i> لا توجد أصوات - ارفع ملفاً";
    } else {
      const currentFile = hiddenInput.value;
      if (currentFile) {
        const found = __S.globalAudios.find((a) => a.file === currentFile);
        if (found) {
          finalSelectedField.textContent = found.displayName;
        } else {
          finalSelectedField.textContent = "اختر صوت...";
          hiddenInput.value = "";
        }
      }
    }

    if (modal.style.display === "flex") renderModalOptions(modalSearch.value);
  } catch (err) {
    console.error("خطأ في تحميل الأصوات:", err);
  }
}

async function deleteAudioFile(filename, skipConfirm = false, keep = false) {
  if (!skipConfirm) {
    const confirmed = await showConfirm(
      `هل تريد حذف الصوت "${filename}" نهائيًا؟`,
      "حذف الصوت",
    );
    if (!confirmed) return;
  }

  try {
    const url = keep
      ? `${__S.API_BASE}/api/audio/${encodeURIComponent(filename)}?keep=true`
      : `${__S.API_BASE}/api/audio/${encodeURIComponent(filename)}`;
    const res = await fetchWithAuth(url, { method: "DELETE" });
    const data = await res.json();

    if (data.success) {
      showMessage(
        keep
          ? "<i class='fas fa-circle-check'></i> تم إزالة الصوت من حسابك (يبقى في السحابة)"
          : "<i class='fas fa-circle-check'></i> تم حذف الصوت نهائياً",
      );
      if (!keep) {
        __S.globalAudios = __S.globalAudios.filter((a) => a.file !== filename);
        document.getElementById("audioSelect").value = "";
        document.querySelector("#audioDropdown .selected").textContent =
          "اختر صوت...";
      }
      await checkStorageNotifications();
      if (
        __S.audioModalGlobal &&
        __S.audioModalGlobal.style.display === "flex" &&
        __S.renderModalOptionsGlobal
      ) {
        const searchValue = __S.modalSearchGlobal ? __S.modalSearchGlobal.value : "";
        __S.renderModalOptionsGlobal(searchValue);
      }
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل حذف الصوت: " +
          (escapeHtml(data.message || "")),
      );
    }
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ أثناء حذف الصوت");
  }
}


export { loadAudios, deleteAudioFile };
