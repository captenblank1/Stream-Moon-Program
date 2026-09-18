// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { showConfirm } from "./utils-core.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { checkStorageNotifications } from "./storage.js";

// ============================================================
// دوال الفيديو (Video)
// ============================================================
async function deleteVideoFile(filename, skipConfirm = false, keep = false) {
  if (!skipConfirm) {
    const confirmed = await showConfirm(
      `هل تريد حذف الفيديو "${filename}" نهائيًا؟`,
      "حذف الفيديو",
    );
    if (!confirmed) return;
  }

  try {
    const url = keep
      ? `${__S.API_BASE}/api/video/${encodeURIComponent(filename)}?keep=true`
      : `${__S.API_BASE}/api/video/${encodeURIComponent(filename)}`;
    const res = await fetchWithAuth(url, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showMessage(
        keep
          ? "<i class='fas fa-circle-check'></i> تم إزالة الفيديو من حسابك (يبقى في السحابة)"
          : "<i class='fas fa-circle-check'></i> تم حذف الفيديو نهائياً",
      );
      await checkStorageNotifications();
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل حذف الفيديو: " +
          (data.message || ""),
      );
    }
  } catch (err) {
    console.error(err);
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ أثناء حذف الفيديو");
  }
}


export { deleteVideoFile };
