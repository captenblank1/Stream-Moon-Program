// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { cleanupFrontend } from "./init.js";
import { escapeHtml } from "./utils-core.js";
import { saveAuthToken } from "./pairing.js";

// ============================================================
// إشعارات الأدمن
// ============================================================



function getDismissedNotifications() {
  try {
    return JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
  } catch {
    return [];
  }
}

function addDismissedNotification(id) {
  const list = getDismissedNotifications();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem("dismissedNotifications", JSON.stringify(list));
  }
}

async function fetchAndShowNotification() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/notifications/active`);
    const data = await res.json();
    if (data.success && data.notifications.length > 0) {
      const dismissed = getDismissedNotifications();
      const activeIds = new Set();
      // ✅ نعرض كل الإشعارات النشطة غير المغلقة — كل إشعار يتراكم أسفل الآخر
      data.notifications.forEach((n) => {
        activeIds.add(n._id);
        if (!dismissed.includes(n._id)) showNotification(n);
      });
      // إزالة الأشرطة التي انتهت صلاحيتها أو حُذفت من الخادم
      for (const [id] of __S.activeNotificationBars) {
        if (!activeIds.has(id)) removeNotificationBar(id);
      }
      if (__S.activeNotificationBars.size === 0) hideNotification();
    } else {
      hideNotification();
    }
  } catch (err) {
    console.warn("Failed to fetch notifications:", err);
  }
}

// حاوية التراكم — إشعار فوق إشعار والجديد يُضاف أسفل القديم
function ensureNotificationStack() {
  let stack = document.getElementById("adminNotificationStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "adminNotificationStack";
    stack.style.cssText = `
      position: fixed;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      width: min(760px, 94vw);
      pointer-events: none;
    `;
    document.body.appendChild(stack);
  }
  return stack;
}

// ✅ الإشعارات تتراكم للأسفل: الإشعار الجديد لا يغطي القديم بل يُضاف أسفله،
// والاهتزاز التنبيهي ينفذ 3 مرات فقط ثم يتوقف تماماً
 // id → { bar, entry }

function removeNotificationBar(id) {
  const entry = __S.activeNotificationBars.get(id);
  if (!entry) return;
  __S.activeNotificationBars.delete(id);
  entry.bar.remove();
  if (__S.activeNotificationBars.size === 0) {
    document.getElementById("adminNotificationStack")?.remove();
    if (__S.currentNotification && __S.currentNotification._id === id)
      __S.currentNotification = null;
  }
}

function showNotification(notification) {
  if (!notification || !notification._id) return;
  // نفس الإشعار معروض بالفعل — لا تكرره ولا تعيد اهتزازه
  if (__S.activeNotificationBars.has(notification._id)) {
    __S.currentNotification = notification;
    return;
  }

  __S.currentNotification = notification;
  const stack = ensureNotificationStack();

  const bar = document.createElement("div");
  bar.className = "adminNotificationBar";
  bar.style.cssText = `
    background: linear-gradient(135deg, #b71c1c 0%, #dc3545 60%, #e35d6a 100%);
    color: white;
    padding: 16px 28px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 8px 30px rgba(220,53,69,0.45);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 16px;
    font-weight: bold;
    direction: rtl;
    pointer-events: auto;
    animation: sm-notif-shake 0.5s ease 3;
  `;

  const textSpan = document.createElement("span");
  // ✅ نزول السطر في نص الإشعار يظهر كسطر جديد (pre-line) وليس كل السطور جمباً بعض
  textSpan.style.whiteSpace = "pre-line";
  textSpan.textContent = notification.text;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "<i class='fas fa-xmark'></i>";
  closeBtn.style.cssText = `
    background: transparent;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    padding: 0 8px;
    line-height: 1;
  `;
  closeBtn.onclick = function () {
    addDismissedNotification(notification._id);
    removeNotificationBar(notification._id);
  };

  bar.appendChild(textSpan);
  bar.appendChild(closeBtn);
  // ✅ الإضافة أسفل الإشعارات الموجودة (تراكم للأسفل)
  stack.appendChild(bar);

  const entry = { bar, notification };
  __S.activeNotificationBars.set(notification._id, entry);
}

// ===== شاشة الحظر — تعرض مرة واحدة وتمنع استخدام التطبيق =====

function showBlockScreen(reason, title) {
  if (__S.blockScreenShown) return;
  __S.blockScreenShown = true;
  try {
    cleanupFrontend();
  } catch (e) {}
  const ov = document.createElement("div");
  ov.id = "deviceBlockedOverlay";
  ov.style.cssText =
    "position:fixed; inset:0; z-index:999999; background:#0d0d10; display:flex; align-items:center; justify-content:center;";
  ov.innerHTML =
    '<div style="text-align:center; color:#fff; padding:30px; max-width:520px" dir="rtl">' +
    '<i class="fas fa-ban" style="font-size:64px; color:#f44336; margin-bottom:20px"></i>' +
    `<h2 style="margin:0 0 12px">${escapeHtml(title || "تم حظر هذا الجهاز")}</h2>` +
    '<p style="color:#aaa; line-height:1.8">' +
    (reason
      ? escapeHtml(reason)
      : "تم حظر هذا الجهاز من استخدام الخدمة. تواصل مع الدعم إذا كنت تعتقد أن هذا خطأ.") +
    "</p></div>";
  document.body.appendChild(ov);
}

// 🔒 خروج قسري عند تعارض الجلسة — الحساب مفتوح على جهاز آخر
async function forceSessionLogout(reason) {
  try {
    cleanupFrontend();
  } catch (e) {}
  try {
    await fetch(`${__S.API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {}
  try {
    saveAuthToken(null);
  } catch (e) {}
  showBlockScreen(
    reason || "تم فتح هذا الحساب من جهاز آخر — الجهاز الأول له الأولوية",
    "الحساب قيد الاستخدام على جهاز آخر",
  );
}

function hideNotification() {
  // إزالة كل أشرطة الإشعارات المعروضة وحاويتها
  for (const [id] of __S.activeNotificationBars) {
    const entry = __S.activeNotificationBars.get(id);
    if (entry) entry.bar.remove();
  }
  __S.activeNotificationBars.clear();
  document.getElementById("adminNotificationStack")?.remove();
  __S.currentNotification = null;
}

// فحص دوري: إزالة أي إشعار انتهت صلاحيته ثم جلب الجديد إن وُجد
__S.notificationTimer = setInterval(() => {
  let expired = false;
  for (const [id, entry] of __S.activeNotificationBars) {
    const n = entry.notification;
    if (n && n.expiresAt && new Date() > new Date(n.expiresAt)) {
      removeNotificationBar(id);
      expired = true;
    }
  }
  if (expired) fetchAndShowNotification();
}, 5000);

// ============================================================
// ✅ أيقونات التواصل (ديسكورد / تيك توك) — أقصى اليسار بالأسفل
// صغيرة وغير مزعجة ولا تأخذ مساحة، ويظهرها/يخفيها الأدمن من لوحة
// التحكم: واحدة فقط، أو الاثنين معاً، أو إخفاؤهما تماماً
// ============================================================





function ensureContactLinksContainer() {
  let box = document.getElementById("contactLinksBar");
  if (!box) {
    box = document.createElement("div");
    box.id = "contactLinksBar";
    box.style.cssText = `
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 9500;
      display: flex;
      gap: 8px;
      align-items: center;
    `;
    const mk = (id, href, icon, color, title) => {
      const a = document.createElement("a");
      a.id = `contact-${id}`;
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = title;
      a.innerHTML = `<i class="fa-brands ${icon}"></i>`;
      // الأيقونة داخل الدائرة: block + هامش تلقائي يوسّطها أفقياً ورأسياً
      a.style.cssText = `
        width: 30px; height: 30px; border-radius: 50%;
        display: none; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        color: ${color}; font-size: 14px; cursor: pointer;
        text-decoration: none; opacity: 0.7;
        transition: opacity .2s ease, transform .2s ease;
      `;
      const i = a.querySelector("i");
      if (i) {
        i.style.cssText =
          "display:block; width:100%; text-align:center; line-height:1; margin:0 auto;";
      }
      a.onmouseenter = () => {
        a.style.opacity = "1";
        a.style.transform = "translateY(-2px)";
      };
      a.onmouseleave = () => {
        a.style.opacity = "0.7";
        a.style.transform = "none";
      };
      return a;
    };
    box.appendChild(
      mk("discord", __S.CONTACT_URLS.discord, "fa-discord", "#7289da", "Discord"),
    );
    box.appendChild(
      mk("tiktok", __S.CONTACT_URLS.tiktok, "fa-tiktok", "#ffffff", "TikTok"),
    );
    document.body.appendChild(box);
  }
  return box;
}

// links: {discord: bool, tiktok: bool} — meta: {discordUrl, tiktokUrl} من إعدادات الأدمن
function applyContactLinksVisibility(links, meta) {
  const box = ensureContactLinksContainer();
  const d = document.getElementById("contact-discord");
  const t = document.getElementById("contact-tiktok");
  const showDiscord = !!(links && links.discord);
  const showTiktok = !!(links && links.tiktok);
  // الروابط القادمة من إعدادات الأدمن تُحدَّث لحظياً إن وُجدت
  // ✅ روابط https فقط — منع javascript: وأي مخطط خطير في href
  const safeUrl = (u) => {
    try {
      const parsed = new URL(String(u || ""));
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch (e) {
      return null;
    }
  };
  if (meta && meta.discordUrl && d && safeUrl(meta.discordUrl))
    d.href = safeUrl(meta.discordUrl);
  if (meta && meta.tiktokUrl && t && safeUrl(meta.tiktokUrl))
    t.href = safeUrl(meta.tiktokUrl);
  if (d) d.style.display = showDiscord ? "flex" : "none";
  if (t) t.style.display = showTiktok ? "flex" : "none";
  box.style.display = showDiscord || showTiktok ? "flex" : "none";
}

async function initContactLinks() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/contact-links`);
    const data = await res.json();
    if (data.success)
      applyContactLinksVisibility(data.links, data.meta);
  } catch (err) {
    console.warn("contact-links:", err.message);
  }
}


export { getDismissedNotifications, addDismissedNotification, fetchAndShowNotification, ensureNotificationStack, removeNotificationBar, showNotification, showBlockScreen, forceSessionLogout, hideNotification, ensureContactLinksContainer, applyContactLinksVisibility, initContactLinks };
