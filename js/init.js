// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { loadAudios } from "./audio.js";
import { ensureProfileLoaded } from "./misc2.js";
import { loadGifts } from "./gifts.js";
import { updateInputsForType } from "./commands.js";
import { ensureGiftsLoaded } from "./gifts.js";
import { setupCustomSelects } from "./captcha-watch.js";
import { showMessage } from "./utils-core.js";
import { deleteAudioFile } from "./audio.js";
import { deleteVideoFile } from "./video.js";
import { connectFrontendSocket } from "./socket.js";
import { initHotkey } from "./hotkeys.js";
import { startStreamerUpdates } from "./streamer.js";
import { checkLiveStatus } from "./live-status.js";
import { performDisconnect } from "./tiktok.js";
import { fetchAndShowNotification } from "./notifications.js";
import { initContactLinks } from "./notifications.js";

// ============================================================
// دوال التنظيف والتهيئة
// ============================================================
function cleanupFrontend() {
  if (__S.liveCheckInterval) {
    clearInterval(__S.liveCheckInterval);
    __S.liveCheckInterval = null;
  }
  if (__S.subscriptionInterval) {
    clearInterval(__S.subscriptionInterval);
    __S.subscriptionInterval = null;
  }
  if (__S.storageInterval) {
    clearInterval(__S.storageInterval);
    __S.storageInterval = null;
  }
  if (__S.streamerTimer) {
    clearInterval(__S.streamerTimer);
    __S.streamerTimer = null;
  }
  if (window._captchaInterval) {
    clearInterval(window._captchaInterval);
    window._captchaInterval = null;
  }
  if (__S.notificationTimer) {
    clearInterval(__S.notificationTimer);
    __S.notificationTimer = null;
  }
  // ✅ بعد تفكيك السوكت يجب السماح بإعادة ربط مستمعي حالة البلوجن
  __S._pluginStatusListenersBound = false;
  if (__S.captchaObserver) {
    __S.captchaObserver.disconnect();
    __S.captchaObserver = null;
  }

  for (const [id, timer] of __S.autoSaveTimers) {
    clearTimeout(timer);
  }
  __S.autoSaveTimers.clear();

  if (__S.saveTimeout) {
    clearTimeout(__S.saveTimeout);
    __S.saveTimeout = null;
  }
  if (__S.searchTimeout) {
    clearTimeout(__S.searchTimeout);
    __S.searchTimeout = null;
  }

  if (__S.frontendSocket) {
    __S.frontendSocket.off();
    __S.frontendSocket.disconnect();
    __S.frontendSocket = null;
  }

  if (__S.audioCtx) {
    __S.audioCtx.close().catch(() => {});
    __S.audioCtx = null;
  }

  if (__S.currentAudioObj) {
    __S.currentAudioObj.pause();
    __S.currentAudioObj = null;
  }
  if (__S.currentAudioObjGlobal) {
    __S.currentAudioObjGlobal.pause();
    __S.currentAudioObjGlobal = null;
  }
  if (typeof __S.currentAudio !== "undefined" && __S.currentAudio) {
    __S.currentAudio.pause();
    __S.currentAudio = null;
  }

  window.onclick = null;
  if (__S.closeOptionsListener) {
    document.removeEventListener("click", __S.closeOptionsListener);
    __S.closeOptionsListener = null;
  }

  __S.importedCommands = [];
  __S.duplicateCommands = [];
  __S.nonDuplicateCommands = [];

  __S.renderModalOptionsGlobal = null;
  __S.audioModalGlobal = null;
  __S.modalSearchGlobal = null;
  __S.selectedFieldGlobal = null;
  __S.hiddenInputGlobal = null;

  if (window._pendingFetchAbortController) {
    window._pendingFetchAbortController.abort();
    window._pendingFetchAbortController = null;
  }

  console.log("🧹 تم تنظيف جميع موارد الواجهة الأمامية");
}

// ✅ إخفاء شريط/نسبة تحميل الرفع نهائياً بعد انتهاء الرفع
// (نجاحاً أو فشلاً أو إلغاءً) — لا يبقى الشريط معلقاً على الشاشة
function hideUploadProgress(kind = "audio") {
  const box = document.getElementById(`${kind}ProgressContainer`);
  if (box) box.style.display = "none";
  const bar = document.getElementById(`${kind}Progress`);
  if (bar) {
    bar.value = 0;
    bar.textContent = "";
  }
  const sp = document.getElementById(`${kind}ProgressPercent`);
  if (sp) sp.textContent = "0%";
}

// ✅ تتبع ذكي لتقدم الرفع — الشريط يتحرك تدريجياً من 1 إلى 100 ويعكس الرفع الحقيقي
// المشكلة: المتصفح يسلّم الملف الصغير/المتوسط للـ socket محلياً دفعة واحدة، فيرسل
// حدث progress بقيمة 100% فوراً بينما الرفع للسيرفر ما زال جارياً.
// الحل الذكي:
//  1) إن وصلت أحداث progress متدرجة (ملفات كبيرة) → نعرضها مباشرة (مقيّدة عند 99)
//  2) إن قفزت لـ 100 فجأة (buffer محلي) → نتحول لتقدير زمني ناعم قائم على حجم الملف
//     وسرعة رفع مُتعلمة من الرفوعات السابقة (تُحفظ محلياً وتتحسن مع كل رفع)
//  3) الشريط يتحرك بسلاسة نحو الهدف دون قفزات، ولا يلمس 100% إلا مع استجابة السيرفر
function createUploadProgressTracker(kind, sizeBytes = 0) {
  const box = document.getElementById(`${kind}ProgressContainer`);
  const bar = document.getElementById(`${kind}Progress`);
  const sp = document.getElementById(`${kind}ProgressPercent`);
  const startAt = Date.now();
  // السرعة المتعلمة (بايت/ثانية) — افتراضي 1.5MB/s لأول رفع
  let learnedSpeed =
    parseFloat(localStorage.getItem("sm_upload_speed")) || 1.5 * 1024 * 1024;
  // ثابت زمن للمنحنى الأسي: يصل ~95% بعد 3τ — τ = نصف الزمن المتوقع للرفع
  const tau = Math.max(2, sizeBytes / learnedSpeed / 2.5);
  let displayed = 1;
  let target = 4;
  let estimateMode = false;
  let finished = false;
  let lastProgressAt = Date.now();
  const render = () => {
    const shown = Math.round(displayed);
    if (bar) bar.value = shown;
    if (sp) sp.textContent = shown + "%";
  };
  const timer = setInterval(() => {
    if (!finished) {
      // تباطأ مجرى الأحداث 2.5 ثانية بدون اكتمال البايتات → تقدير زمني أيضاً
      if (!estimateMode && Date.now() - lastProgressAt > 2500) estimateMode = true;
      if (estimateMode) {
        const elapsed = (Date.now() - startAt) / 1000;
        target = Math.min(99, 99 * (1 - Math.exp(-elapsed / tau)));
      }
    }
    // اقتراب سلس من الهدف — خطوة صغيرة دائمة حتى لا يتجمد الشريط
    const step = target >= 100 ? 9 : 0.35;
    displayed = Math.min(target, displayed + Math.max(step, (target - displayed) * 0.12));
    if (target < 100) displayed = Math.min(displayed, 99); // لا 100% قبل استجابة السيرفر
    render();
    if (finished && displayed >= 99.5) {
      clearInterval(timer);
    }
  }, 150);
  if (box) box.style.display = "block";
  render();
  return {
    cancel() {
      clearInterval(timer);
    },
    update(loaded, total) {
      if (!total || finished) return;
      lastProgressAt = Date.now();
      estimateMode = false;
      const raw = Math.round((loaded / total) * 100);
      if (raw >= 100) {
        // القفزة الفورية = الملف اتحَجَّز محلياً — تقدير زمني من هنا
        if (Date.now() - startAt < 4000) estimateMode = true;
        else target = 99;
      } else {
        // تقدم حقيقي متدرج — نتبعه مباشرة
        target = Math.min(99, Math.max(target, raw));
      }
    },
    complete() {
      finished = true;
      target = 100;
      // حفظ السرعة الفعلية لتحسين تقدير الرفع القادم
      const sec = (Date.now() - startAt) / 1000;
      if (sec > 0.5 && sizeBytes > 0) {
        try {
          localStorage.setItem("sm_upload_speed", String(sizeBytes / sec));
        } catch (e) {}
      }
    },
  };
}

async function init() {
  cleanupFrontend();
  await loadAudios();
  await ensureProfileLoaded();
  await loadGifts();
  updateInputsForType(document.getElementById("actionType").value || "gift");

  const actionTypeEl = document.getElementById("actionType");
  if (actionTypeEl) {
    actionTypeEl.addEventListener("change", (e) => {
      document.getElementById("giftChooserSection").style.display =
        e.target.value === "gift" ? "block" : "none";
    });
  }

  const giftDropdown = document.getElementById("giftDropdown");
  if (giftDropdown) {
    const observer = new MutationObserver(() => {
      if (giftDropdown.style.display === "block" && !__S.giftsLoaded) {
        ensureGiftsLoaded();
        observer.disconnect();
      }
    });
    observer.observe(giftDropdown, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  setupCustomSelects();

  // رفع الصوت والفيديو
  document
    .getElementById("audioUploadInput")
    .addEventListener("change", async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("audio", file);
      showMessage("<i class='fas fa-spinner fa-spin'></i> جاري رفع الصوت...");
      const progress = createUploadProgressTracker("audio", file.size);
      __S.pendingUploads.audio = (async () => {
        try {
          // رفع بـ XHR لعرض شريط تقدم حقيقي (fetch لا يدعم progress)
          const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            window.__audioXhr = xhr;
            xhr.open("POST", `${__S.API_BASE}/api/upload-audio`);
            const authHeaders = window.__getAuthHeaders
              ? window.__getAuthHeaders()
              : {};
            for (const [k, v] of Object.entries(authHeaders))
              xhr.setRequestHeader(k, v);
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) progress.update(e.loaded, e.total);
            };
            xhr.onload = () => {
              window.__audioXhr = null;
              progress.complete();
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                resolve({ success: xhr.status >= 200 && xhr.status < 300 });
              }
            };
            xhr.onabort = () => {
              window.__audioXhr = null;
              progress.cancel();
              resolve({ success: false, aborted: true });
            };
            xhr.onerror = () => reject(new Error("network"));
            xhr.send(formData);
          });
          if (data.aborted) return;
          if (data.success) {
            if (__S.uploadsCancelled) {
              // الرفع أُلغي أثناء التنفيذ: نحذف الملف المؤقت فوراً
              deleteAudioFile(data.filename, true).catch(() => {});
              return;
            }
            __S.tempUploadedFiles.audio = data.filename;
            await loadAudios();
            document.querySelector("#audioDropdown .selected").textContent =
              data.filename;
            document.getElementById("audioSelect").value = data.filename;
            showMessage(
              "<i class='fas fa-circle-check'></i> تم رفع الصوت بنجاح",
            );
          } else {
            showMessage(
              "<i class='fas fa-circle-xmark'></i> فشل رفع الصوت: " +
                (escapeHtml(data.message || "")),
            );
          }
        } catch (err) {
          showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
        } finally {
          __S.pendingUploads.audio = null;
          progress.cancel();
          // ✅ إخفاء شريط تقدم رفع الصوت نهائياً بعد انتهاء الرفع
          hideUploadProgress("audio");
        }
      })();
    });

  document
    .getElementById("videoInput")
    .addEventListener("change", async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("video", file);
      showMessage("<i class='fas fa-spinner fa-spin'></i> جاري رفع الفيديو...");
      const progress = createUploadProgressTracker("video", file.size);
      __S.pendingUploads.video = (async () => {
        try {
          const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            window.__videoXhr = xhr;
            xhr.open("POST", `${__S.API_BASE}/api/upload-video`);
            const authHeaders2 = window.__getAuthHeaders
              ? window.__getAuthHeaders()
              : {};
            for (const [k, v] of Object.entries(authHeaders2))
              xhr.setRequestHeader(k, v);
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) progress.update(e.loaded, e.total);
            };
            xhr.onload = () => {
              window.__videoXhr = null;
              progress.complete();
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                resolve({ success: xhr.status >= 200 && xhr.status < 300 });
              }
            };
            xhr.onabort = () => {
              window.__videoXhr = null;
              progress.cancel();
              resolve({ success: false, aborted: true });
            };
            xhr.onerror = () => reject(new Error("network"));
            xhr.send(formData);
          });
          if (data.success) {
            if (__S.uploadsCancelled) {
              // الرفع أُلغي أثناء التنفيذ: نحذف الملف المؤقت فوراً
              deleteVideoFile(data.filename, true).catch(() => {});
              return;
            }
            __S.tempUploadedFiles.video = data.filename;
            __S.videoWasCleared = false;
            document.getElementById("video").value = data.filename;
            document.getElementById("videoFileName").textContent =
              data.filename;
            showMessage(
              "<i class='fas fa-circle-check'></i> تم رفع الفيديو بنجاح",
            );
          } else {
            showMessage(
              "<i class='fas fa-circle-xmark'></i> فشل رفع الفيديو: " +
                (escapeHtml(data.message || "")),
            );
          }
        } catch (err) {
          showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
        } finally {
          __S.pendingUploads.video = null;
          progress.cancel();
          // ✅ إخفاء شريط/نسبة تقدم رفع الفيديو نهائياً بعد انتهاء الرفع
          hideUploadProgress("video");
        }
      })();
    });

  await connectFrontendSocket();
  await initHotkey();
  __S.hotkeySectionLoaded = true;
  startStreamerUpdates();

  // ✅ طلب أولي للحالة
  await checkLiveStatus();
  // الحالة المتبقية من جلسة سابقة: الخادم قد يظن المستخدم متصلاً — تصفير فوري
  if (__S.isLiveConnected) {
    await performDisconnect(true);
  }
  // فحص دوري كل 30 ثانية — انتهاء البث يظهر تلقائياً بدون تدخل
  if (__S.liveCheckInterval) clearInterval(__S.liveCheckInterval);
  __S.liveCheckInterval = setInterval(() => checkLiveStatus(), 15000);
  // سحب الإشعارات النشطة — الدوري يديره __S.notificationTimer في notifications.js
  // (كان هنا interval ثانٍ غير مُخزَّن يستمر حتى بعد cleanupFrontend — تسريب)
  fetchAndShowNotification();
  // ✅ أيقونات التواصل أسفل اليسار — حسب ما فعّله الأدمن
  initContactLinks();

  // البيانات جاهزة — إخفاء صفحة السكيلتون الافتتاحية فوراً (بدون انتظار مهلة الأمان)
  if (window.Skeleton && window.Skeleton.hideAppSkeleton)
    window.Skeleton.hideAppSkeleton();
}

init();


export { cleanupFrontend, hideUploadProgress, init };
