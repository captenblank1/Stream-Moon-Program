// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { getAuthToken } from "./pairing.js";
import { getCookie } from "./utils-core.js";
import { saveAuthToken } from "./pairing.js";
import { getDeviceId } from "./utils-core.js";
import { checkLiveStatus } from "./live-status.js";
import { bindPluginStatusSocketListeners } from "./pairing.js";
import { checkPluginStatus } from "./pairing.js";
import { fetchWithAuth } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { showProSubscribedModal } from "./utils-core.js";
import { adminUserMatchesCurrentFilter } from "./admin.js";
import { loadHotkeyCommands, renderHotkeysList } from "./hotkeys.js";
import { handleConnectResult, unlockConnectUI, setConnectBtnState } from "./tiktok.js";
import { buildAdminUserRowHtml } from "./admin.js";
import { escapeHtml } from "./utils-core.js";
import { buildAdminUserActionsHtml } from "./admin.js";
import { loadAdminNotifications } from "./admin.js";
import { updateStreamerImages } from "./streamer.js";
import { showBlockScreen } from "./notifications.js";
import { getDismissedNotifications } from "./notifications.js";
import { showNotification } from "./notifications.js";
import { removeNotificationBar } from "./notifications.js";
import { fetchAndShowNotification } from "./notifications.js";
import { hideNotification } from "./notifications.js";
import { applyContactLinksVisibility } from "./notifications.js";
import { safeMediaUrl } from "./utils-core.js";
import { forceSessionLogout } from "./notifications.js";

// ============================================================
// دوال الاتصال بـ Socket.IO
// ============================================================
async function connectFrontendSocket() {
  try {
    if (__S.frontendSocket) {
      __S.frontendSocket.off();
      __S.frontendSocket.disconnect();
      __S.frontendSocket = null;
    }

    // ✅ ضمان توكن قبل الاتصال: لو مش مخزن — تجديده من الكوكيز أولاً
    let token = getAuthToken();
    if (!token) {
      try {
        const r = await fetch(`${__S.API_BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          const t = d.token || getCookie("token");
          if (t) {
            saveAuthToken(t);
            token = t;
          }
        }
      } catch (e) {}
    }
    __S.frontendSocket = __S.io(__S.API_BASE, {
      withCredentials: true,
      // polling أولاً: مصادقة المصافحة تعتمد على كوكي httpOnly الذي لا
      // يُرسل مع websocket handshake من أصل التطبيق — بعد المصادقة تتم
      // الترقية لـ websocket تلقائياً
      transports: ["polling", "websocket"],
      // دالة auth: كل محاولة اتصال/إعادة اتصال تأخذ أحدث توكن مخزَّن —
      // فلو وصل بعد ما حفظ التوكن تتصل بنجاح بدون إعادة تشغيل
      auth: (cb) =>
        cb({
          token: getAuthToken(),
          deviceId: getDeviceId(),
          // بصمة العتاد — توحيد مفتاح الجلسة مع وكيل الأوامر (حراسة الجهاز الواحد)
          machineId: window.electronAPI?.getMachineIdSync?.() || "",
        }),
    });

    let reconnectAttempts = 0;

    __S.frontendSocket.on("connect", () => {
      console.log("✅ فرونت متصل بـ Socket.IO");
      reconnectAttempts = 0;
      checkLiveStatus(); // ✅ طلب أولي فقط
      // 🔗 استماع لحظي لتغيّر حالة اقتران البلوجن
      try {
        bindPluginStatusSocketListeners();
      } catch (e) {}
      checkPluginStatus().catch(() => {});
      fetchWithAuth(`${__S.API_BASE}/api/auth/me`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.user) {
            __S.frontendSocket.emit("join-room", { room: `user-${data.user.id}` });
          }
        })
        .catch((err) => console.warn("فشل جلب userId", err));
    });

    // ===== ✅ تحديث فوري لحالة اشتراك المستخدم (تفعيل/إلغاء) =====
    __S.frontendSocket.on("plan-updated", async (data) => {
      console.log("💎 [PLAN] تحديث خطة الاشتراك:", data?.action || "change");
      // الإلغاء الصريح: رسالة بسيطة + تحديث — بلا نافذة احتفالية
      if (data?.action === "deactivated") {
        showMessage("<i class='fas fa-gem'></i> تم تحديث حالة اشتراكك");
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      // التفعيل: نتحكم من الحالة الفعلية للحساب (يعمل حتى مع خادم قديم
      // لا يرسل تفاصيل في الحدث) ثم نعرض نافذة البرو — الإغلاق يحدّث البرنامج
      let planType = data?.planType;
      let expiry = data?.subscriptionExpiry;
      let isPro = false;
      try {
        const res = await fetchWithAuth(`${__S.API_BASE}/api/auth/me`);
        const d = await res.json();
        if (d.success && d.user) {
          planType = planType || d.user.planType;
          expiry = expiry || d.user.subscriptionExpiry;
          isPro = d.user.plan === "paid" && (!d.subscription || d.subscription.status === "active");
        }
      } catch (e) {
        isPro = data?.action === "activated";
      }
      if (isPro) {
        showProSubscribedModal({ planType, expiry });
        return;
      }
      showMessage("<i class='fas fa-gem'></i> تم تحديث حالة اشتراكك");
      setTimeout(() => window.location.reload(), 1200);
    });

    // ===== ✅ تحديث فوري للوحة الأدمن عند أي تغيير في البيانات =====
    // الأحداث اليومية (هدايا/كونكت/بث/اشتراك) تُحدّث الأرقام في مكانها فقط
    // دون إعادة رسم اللوحة (يحافظ على البحث والتمرير)، والأحداث الهيكلية
    // (مستخدم جديد/حذف/حظر/إشعار) تعيد رسم اللوحة كاملة
    let adminRefreshTimer = null;
    let lastAdminRefresh = 0;

    window.refreshAdminDataInPlace = async () => {
      try {
        const [statsRes, usersRes] = await Promise.all([
          fetchWithAuth(`${__S.API_BASE}/api/admin/stats`),
          fetchWithAuth(`${__S.API_BASE}/api/admin/users`),
        ]);
        const stats = await statsRes.json();
        const usersData = await usersRes.json();
        if (!stats.success || !usersData.success) return;

        // تحديث كروت الإحصائيات في مكانها
        for (const [key, val] of Object.entries(stats.stats)) {
          const el = document.getElementById(`stat-${key}`);
          if (el && el.textContent !== String(val)) el.textContent = val;
        }

        // تحديث الجدول في مكانه: خلايا موجودة تُحدَّث، صفوف جديدة تُضاف،
        // صفوف محذوفة تُزال — بدون إعادة رسم اللوحة (يحافظ على البحث والتمرير)
        const tbody = document.getElementById("adminTableBody");
        if (!tbody) return;
        const now = new Date();
        const apiIds = new Set(usersData.users.map((u) => String(u.id)));

        // إزالة صفوف مستخدمين لم يعودوا موجودين (حُذفوا)
        tbody
          .querySelectorAll("tr[data-uid]")
          .forEach((row) => {
            if (!apiIds.has(String(row.dataset.uid))) row.remove();
          });

        for (const user of usersData.users) {
          let row = tbody.querySelector(`tr[data-uid="${user.id}"]`);
          if (!row) {
            // مستخدم جديد — يُضاف فقط لو يطابق فلتر البحث الحالي
            if (!adminUserMatchesCurrentFilter(user)) continue;
            const placeholder = tbody.querySelector("tr:not([data-uid])");
            if (placeholder) placeholder.remove();
            row = document.createElement("tr");
            row.dataset.uid = user.id;
            row.innerHTML = buildAdminUserRowHtml(user, now);
            tbody.appendChild(row);
            continue;
          }
          const setCell = (cls, html) => {
            const cell = row.querySelector(`.${cls}`);
            if (cell && cell.innerHTML !== html) cell.innerHTML = html;
          };
          setCell("cell-plan",
            user.plan === "paid"
              ? '<span class="badge-paid">مدفوع</span>'
              : '<span class="badge-free">مجاني</span>');
          const planTypeHtml = user.planType
            ? user.planType === "monthly"
              ? "شهري"
              : "سنوي"
            : "—";
          setCell("cell-plan-type", planTypeHtml);
          const expiryHtml = user.subscriptionExpiry
            ? new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")
            : "—";
          setCell("cell-expiry", expiryHtml);
          setCell("cell-role",
            user.role === "admin"
              ? '<span class="badge-admin">مدير</span>'
              : '<span class="badge-user">مستخدم</span>');
          const tiktokCell = user.tiktokUsername
            ? `<span class="tiktok-user">@${escapeHtml(user.tiktokUsername)}</span>`
            : "—";
          setCell("cell-tiktok", tiktokCell);
          const liveHtml = user.isLiveNow
            ? '<span class="status-live"><i class="fas fa-circle" style="color:#4caf50"></i> مباشر</span>'
            : '<span class="status-offline"><i class="fas fa-circle" style="color:#444"></i> غير متصل</span>';
          setCell("cell-live", liveHtml);
          setCell("cell-connects", String(user.connectsToday ?? 0));
          setCell("cell-gifts-today", String(user.giftsToday ?? 0));
          setCell("cell-gifts-month", String(user.giftsThisMonth ?? 0));
          const deviceCell = user.deviceId ? escapeHtml(user.deviceId) : "—";
          const deviceEl = row.querySelector(".cell-device");
          if (deviceEl && deviceEl.textContent !== deviceCell) {
            const uid = escapeHtml(user.deviceId || "");
            deviceEl.title = "اضغط للنسخ";
            deviceEl.onclick = () =>
              navigator.clipboard
                .writeText(uid)
                .then(() =>
                  showMessage("<i class='fas fa-clipboard'></i> تم نسخ البصمة"),
                );
            deviceEl.textContent = deviceCell;
          }
          setCell("cell-commands", String(user.commandCount ?? 0));
          setCell("cell-created",
            new Date(user.createdAt).toLocaleDateString("ar-EG"));
          // خلية الأزرار (حالة الحظر/الاشتراك/الترقية) — الأزرار تعمل
          // عبر حدث مفوَّض على الحاوية فلا تحتاج ربط إضافي
          setCell("cell-actions", buildAdminUserActionsHtml(user, now));
        }

        // تحديث الكاش حتى يطابق الفلترة البيانات الجديدة
        window.allAdminUsers = usersData.users;
      } catch (err) {
        console.warn("فشل التحديث الجزئي للوحة:", err);
      }
    };

    // التحديث يعتمد على السوكيت فقط (admin-refresh) — لا polling دوري
    // حتى لا تتحدث الخلايا كل شوية بدون سبب
    __S.frontendSocket.on("admin-refresh", (data) => {
      console.log("📡 [ADMIN] تحديث فوري للوحة التحكم:", data?.reason);
      const adminContainer = document.getElementById("adminDashboardContainer");
      if (!adminContainer || !adminContainer.innerHTML.trim()) return;
      if (data?.reason === "block-evasion") {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> محاولة تهرب من حظر جهاز — تم توسيع الحظر تلقائياً",
        );
      }
      // كل الأحداث — حتى الهيكلية (مستخدم جديد/حذف/حظر) — تُحدَّث في مكانها:
      // الصفوف الجديدة تُضاف والمحذوفة تُزال والخلايا تُحدَّث بدون إعادة رسم
      // (يحافظ على البحث والفلترة والتمرير)
      if (data?.reason === "notification") loadAdminNotifications();
      clearTimeout(adminRefreshTimer);
      const runAdminRefresh = () => {
        const since = Date.now() - lastAdminRefresh;
        if (since < 1000) {
          adminRefreshTimer = setTimeout(runAdminRefresh, 1000 - since);
          return;
        }
        lastAdminRefresh = Date.now();
        if (typeof refreshAdminDataInPlace === "function")
          refreshAdminDataInPlace().catch(() => {});
      };
      adminRefreshTimer = setTimeout(runAdminRefresh, 250);
    });

    // ===== ✅ مستمع التحديث الفوري لحالة البث =====
    __S.frontendSocket.on("live-status-updated", (data) => {
      console.log("📡 [LIVE] استلام تحديث فوري:", data);

      const connectText = document.getElementById("connect-text");
      const tiktokDisplay = document.getElementById("tiktok-display");
      const userInput = document.getElementById("user-tiktok");
      const connectProfile = document.getElementById("connect-profile-aside");
      const tiktokDisplayAside = document.getElementById(
        "tiktok-display-aside",
      );

      if (data.isLive) {
        // ===== حالة الاتصال =====
        __S.isLiveConnected = true;
        // ✅ نجح الاتصال فعلاً — تحرير الزر فوراً حتى لو تأخرت
        // نتيجة tiktok-connect-result (كان الزر يبقى مقفولاً حتى تصل)
        unlockConnectUI();
        setConnectBtnState("disconnect");
        connectText.textContent = window.AppI18n
          ? AppI18n.t("Connected")
          : "Connected";
        connectText.style.color = "#1dd9e6e1";
        if (data.username) {
          tiktokDisplay.textContent = data.username;
          if (userInput) userInput.value = data.username;
          if (tiktokDisplayAside)
            tiktokDisplayAside.textContent = data.username;
        }
        if (connectProfile) {
          connectProfile.style.pointerEvents = "none";
          connectProfile.style.opacity = 0.6;
        }
      } else if (data.reconnecting) {
        // ✅ حالة إعادة الاتصال التلقائي: لا نغيّر الزر إلى Connect فوراً
        // الخادم سيعيد الاتصال خلال ثوانٍ — نعرض حالة انتظار فقط
        connectText.textContent = window.AppI18n
          ? AppI18n.t("Reconnecting...")
          : "Reconnecting...";
        connectText.style.color = "#ffa500";
        setConnectBtnState("disconnect");
        console.log("🔄 [LIVE] قطع مؤقت — جاري إعادة الاتصال تلقائياً");
      } else {
        // ===== حالة قطع الاتصال =====
        __S.isLiveConnected = false;
        setConnectBtnState("connect");
        connectText.textContent = window.AppI18n
          ? AppI18n.t("Disconnected")
          : "Disconnected";
        connectText.style.color = "red";
        if (tiktokDisplay) tiktokDisplay.textContent = "";
        if (tiktokDisplayAside) tiktokDisplayAside.textContent = "";
        if (connectProfile) {
          connectProfile.style.pointerEvents = "auto";
          connectProfile.style.opacity = 1;
        }
        updateStreamerImages(true);
      }
    });

    // ===== ✅ مستمع الإشعارات الفورية من الأدمن =====
    // ✅ الحظر الفوري: الخادم يطرد الجلسة ويبلغ الواجهة بشاشة الحظر
    __S.frontendSocket.on("account-blocked", (data) => {
      console.log("🚫 [BLOCKED] تم حظر الحساب");
      showBlockScreen(data?.reason || "");
    });

    // ✅ تنبيهات أمنية — تصل للأدمن فقط (غرفة admins في الخادم)
    __S.frontendSocket.on("security-alert", (data) => {
      if (__S.currentUserRole !== "admin") return;
      showMessage(
        "<i class='fas fa-shield-halved' style='color:#ff9800'></i> " +
          (escapeHtml(data?.message || "تنبيه أمني")),
      );
    });

    // ✅ أخطاء الويب هوك من الخادم — كانت كل الفشل (timeout/HTTP/حجم/رابط
    // محلي بلا وكيل) تظهر في لوجات الخادم فقط والمستخدم يظن الويب هوك شغال
    __S.frontendSocket.on("webhook-error", (data) => {
      console.warn("⚠️ [WEBHOOK-ERROR]", data?.message, data?.url);
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          escapeHtml(data?.message || "فشل إرسال Webhook"),
      );
    });

    __S.frontendSocket.on("new-notification", (notification) => {
      const dismissed = getDismissedNotifications();
      if (!dismissed.includes(notification._id)) {
        showNotification(notification);
      }
    });

    __S.frontendSocket.on("notification-updated", (notification) => {
      // إذا كان الإشعار معروضاً — نحدّثه أو نزيله حسب حالته
      if (
        notification &&
        notification._id &&
        __S.activeNotificationBars.has(notification._id)
      ) {
        if (
          notification.isActive &&
          new Date() < new Date(notification.expiresAt)
        ) {
          const entry = __S.activeNotificationBars.get(notification._id);
          entry.notification = notification;
          if (entry.bar) {
            const textSpan = entry.bar.querySelector("span");
            if (textSpan) textSpan.textContent = notification.text;
          }
          __S.currentNotification = notification;
        } else {
          removeNotificationBar(notification._id);
        }
      } else {
        // إذا لم يكن معروضاً، نتحقق من أنه جديد ونعرضه إن لم يكن مغلقاً
        fetchAndShowNotification();
      }
    });

    __S.frontendSocket.on("notification-deleted", (data) => {
      if (data && data.id && __S.activeNotificationBars.has(data.id)) {
        removeNotificationBar(data.id);
      } else if (__S.currentNotification && __S.currentNotification._id === data.id) {
        hideNotification();
      }
    });

    // ✅ تحديث لحظي لأيقونات التواصل (إظهار/إخفاء + الروابط) عندما يغيّرها الأدمن
    __S.frontendSocket.on("contact-links-updated", (links, meta) => {
      applyContactLinksVisibility(links, meta);
    });

    // ✅ مزامنة حية: أي تعديل/حذف/تحويل أمر (من هذا الجهاز أو غيره) يحدّث
    // قائمة اختيار الهوت كي وجدولها — الباك اند يبث الحدث بعد كل عملية
    __S.frontendSocket.on("commands-updated", () => {
      loadHotkeyCommands().catch(() => {});
      renderHotkeysList().catch(() => {});
    });

    // ✅ نتيجة الكونكت الفورية — بدل استطلاع كل ثانية
    __S.frontendSocket.on("tiktok-connect-result", (data) => {
      handleConnectResult(data);
    });

    __S.frontendSocket.on("play-sound", async (payload) => {
      if (payload.id && payload.id === __S.lastPlayedSoundId) return;
      __S.lastPlayedSoundId = payload.id;
      try {
        if (!payload || !payload.filename) return;
        const finalUrl = safeMediaUrl(payload.filename, "audio");
        if (!finalUrl) {
          console.warn("⚠️ تم تجاهل رابط صوت غير آمن:", payload.filename);
          return;
        }
        await tryUnlockAudio();
        const audio = new Audio(finalUrl);
        audio.volume = Math.min(1, Math.max(0, (payload.volume || 100) / 100));
        audio.crossOrigin = "anonymous";
        await audio.play();
        // أخبر السيرفر أن الصوت اشتغل فعلاً (يظهر ✅ في لوج الباك اند)
        try { __S.frontendSocket.emit("sound-ack", { id: payload.id }); } catch (e) {}
        console.log(`🔊 تم تشغيل الصوت في الفرونت: ${finalUrl}`);
      } catch (err) {
        console.warn("❌ فشل تشغيل الصوت في الفرونت:", err.message);
      }
    });

    __S.frontendSocket.on("connect_error", (err) => {
      console.warn("⚠️ خطأ في اتصال Socket.IO (فرونت):", err.message);
    });

    // 🔒 تعارض جلسة: نفس الحساب/اليوزر مفتوح من جهاز آخر — الأقدم يبقى والأحدث يُطرد
    __S.frontendSocket.on("session-conflict", (data) => {
      console.warn("🔒 [session-conflict]", data?.reason || "");
      __S.sessionConflictHit = true;
      try {
        __S.frontendSocket.disconnect();
      } catch (e) {}
      forceSessionLogout(data?.reason);
    });

    __S.frontendSocket.on("disconnect", (reason) => {
      console.log(`❌ فرونت قطع اتصال Socket.IO: ${reason}`);
      if (__S.sessionConflictHit) return; // الجلسة مطرودة — لا إعادة اتصال
      if (__S.isEditingUsername) return;
      if (reason === "io server disconnect") {
        __S.frontendSocket.connect();
        return;
      }
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      setTimeout(() => {
        if (__S.sessionConflictHit) return;
        reconnectAttempts++;
        __S.frontendSocket.connect();
      }, delay);
    });

    __S.frontendSocket.on("error", (err) => {
      console.error("❌ خطأ في Socket.IO:", err.message);
    });

    // ✅ مستمع تنفيذ Webhook عبر الوكيل المحلي (الروابط المحلية)
    // حماية SSRF مطابقة للبروسيس الرئيسي: http/https فقط + رفض الشبكات المحلية
    const isSafeWebhookUrl = (raw) => {
      try {
        const parsed = new URL(String(raw || ""));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
          return false;
        const host = parsed.hostname.toLowerCase();
        if (
          host === "localhost" ||
          host.endsWith(".localhost") ||
          host.endsWith(".local") ||
          host.endsWith(".internal") ||
          host === "metadata.google.internal"
        )
          return false;
        const v4 = host.match(
          /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
        );
        if (v4) {
          const a = parseInt(v4[1], 10);
          const b = parseInt(v4[2], 10);
          if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
          if (a === 169 && b === 254) return false;
          if (a === 172 && b >= 16 && b <= 31) return false;
          if (a === 192 && b === 168) return false;
          if (a === 100 && b >= 64 && b <= 127) return false;
        }
        return true;
      } catch (e) {
        return false;
      }
    };
    __S.frontendSocket.on("webhook-request", async (data) => {
      if (!isSafeWebhookUrl(data.url)) {
        console.warn("🚫 رفض webhook-request إلى رابط غير آمن:", data.url);
        __S.frontendSocket.emit("webhook-response", {
          url: data.url,
          ok: false,
          error: "unsafe url",
        });
        return;
      }
      try {
        const response = await fetch(data.url, {
          method: data.method || "POST",
          headers: data.headers || {},
          body: data.body,
        });
        console.log("Webhook response:", response.status);
        // إرسال تأكيد للخادم (اختياري لكنه مفيد للمراقبة)
        __S.frontendSocket.emit("webhook-response", {
          url: data.url,
          status: response.status,
          ok: response.ok,
        });
      } catch (err) {
        console.error("Webhook request failed:", err.message);
        __S.frontendSocket.emit("webhook-response", {
          url: data.url,
          ok: false,
          error: err.message,
        });
      }
    });
  } catch (err) {
    console.error("❌ فشل إنشاء اتصال Socket.IO (فرونت):", err.message);
  }
}

async function tryUnlockAudio() {
  if (__S.audioUnlocked) return true;
  try {
    if (!__S.audioCtx) {
      __S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (__S.audioCtx.state === "suspended") {
      await __S.audioCtx.resume();
    }
    const buffer = __S.audioCtx.createBuffer(1, 1, 22050);
    const source = __S.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(__S.audioCtx.destination);
    source.start(0);
    __S.audioUnlocked = true;
    return true;
  } catch (e) {
    console.warn("فشل فتح الصوت:", e);
    return false;
  }
}


export { connectFrontendSocket, tryUnlockAudio };
