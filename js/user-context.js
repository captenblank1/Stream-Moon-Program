// ============================================================
// js/user-context.js — ✅ السياق الموحد لهوية المستخدمين (Global User Context)
// المصدر الوحيد لمنطق: الاسم المعروض، سلسلة بدائل الصورة، وكتابة هوية
// صاحب البث في الواجهة. أي تعديل مستقبلي (أو ربط منصة جديدة) يتم هنا
// فقط بدل تفرّق الكود بين موديولات الجداول واللايف فيد والسايدبار.
// ============================================================
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";

// توكن بروكسي الصور — تُعبأ من overlay-links (getScreenTokenCached)
let _avatarToken = "";

export function setAvatarToken(token) {
  _avatarToken = token || "";
}

export async function ensureAvatarToken() {
  if (_avatarToken) return _avatarToken;
  try {
    const { getScreenTokenCached } = await import("./overlay-links.js");
    _avatarToken = (await getScreenTokenCached()) || "";
  } catch (e) {}
  return _avatarToken;
}

// سلسلة بدائل الصور (يُستدعى من onerror): الأصلي → البروكسي → إعادة
// محاولة البروكسي بكسر الكاش → الإزالة. فشل عابر واحد (شبكة/إعادة تشغيل
// سيرفر) كان يشيل الصورة نهائياً من الجدول حتى لو اتصلت بعد شوية
if (typeof window !== "undefined") {
  window.__pbAvatarErr = function (img) {
    const stage = img.dataset.stage || "";
    if (!stage && img.dataset.proxy) {
      img.dataset.stage = "1";
      img.src = img.dataset.proxy;
      return;
    }
    if (stage === "1" && img.dataset.proxy) {
      img.dataset.stage = "2";
      const sep = img.dataset.proxy.includes("?") ? "&" : "?";
      img.src = img.dataset.proxy + sep + "r=" + Date.now();
      return;
    }
    img.remove();
  };
}

/**
 * ✅ الاسم المعروض موحّد — displayName إن وجد وإلا username.
 * كل الجداول (نقاط المشاهدين/النقاط/المميزين/اللايف فيد) تستخدم هذا
 * بدل `nickname || username` المكتوب يدوياً في كل مكان.
 */
export function displayName(nickname, username) {
  const n = String(nickname || "").trim();
  const u = String(username || "").trim();
  return n || u || "";
}

/**
 * ✅ سلسلة بدائل صورة المشاهد (رابط تيك توك → بروكسي الخادم → أيقونة).
 * تُستخدم في جداول النقاط والمميزين ونقاط المشاهدين وأي جدول قادم.
 */
export function avatarHtml(username, avatarUrl) {
  const style =
    "display:inline-flex;align-items:center;justify-content:center;overflow:hidden;position:relative;width:32px;height:32px;background:#2a2d3a;color:#ffd166;";
  const fallback = '<i class="fas fa-user" style="opacity:.85;"></i>';
  const u = encodeURIComponent(
    String(username || "").trim().toLowerCase().slice(0, 60),
  );
  const direct = String(avatarUrl || "").trim();
  const proxy =
    u && _avatarToken
      ? `${__S.API_BASE}/api/songs/avatar?u=${u}&token=${encodeURIComponent(
          _avatarToken,
        )}`
      : "";
  const imgAttrs =
    'alt="" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="window.__pbAvatarErr && window.__pbAvatarErr(this)"';
  if (direct)
    return (
      `<span class="vps-avatar" style="${style}">${fallback}` +
      `<img src="${escapeHtml(
        direct,
      )}" data-proxy="${escapeHtml(proxy)}" ${imgAttrs}></span>`
    );
  if (proxy)
    return (
      `<span class="vps-avatar" style="${style}">` +
      // ✅ data-proxy على صورة البروكسي نفسها — الفشل العابر يعيد المحاولة
      // بدل إزالة الصورة نهائياً من أول مرة
      `<img src="${proxy}" data-proxy="${proxy}" ${imgAttrs}></span>`
    );
  return `<span class="vps-avatar" style="${style}">${fallback}</span>`;
}

// ============================================================
// هوية صاحب البث — كاتب واحد لكل عقد الواجهة (صورة/اسم/يوزر/حالة)
// حتى لا تتنافس الموديولات (streamer/live-status/socket/tiktok) على
// نفس العناصر بقيم مختلفة
// ============================================================
const _last = { picture: null, nickname: null, username: null, statusText: null };

function safeImageUrlLocal(url) {
  const u = String(url || "").trim();
  if (/^(https?:|images\/|data:)/i.test(u)) return u;
  return "";
}

/** تحديث صور واسم صاحب البث في كل عقد الواجهة دفعة واحدة */
export function applyStreamerIdentity({ username, nickname, profilePicture } = {}) {
  const img1 = document.getElementById("liveOwnerImg1");
  const img2 = document.getElementById("liveOwnerImg2");
  const nicknameEl = document.getElementById("liveOwnerText");
  const sidebarName = document.getElementById("tiktok-display");
  const picture = safeImageUrlLocal(profilePicture) || "images/img1.jpg";
  const shownNickname = String(nickname || "").trim() || "Stream Moon";
  if (
    picture === _last.picture &&
    shownNickname === _last.nickname &&
    String(username || "") === _last.username
  )
    return;
  _last.picture = picture;
  _last.nickname = shownNickname;
  _last.username = String(username || "");
  if (img1) img1.src = picture;
  if (img2) img2.src = picture;
  if (nicknameEl) nicknameEl.textContent = shownNickname;
  // ✅ اسم الحساب في السايدبار بدل النص الثابت "username" — نفس القيمة
  // التي يكتبها كاتب حالة الاتصال فلا تعارض بين الكاتبين
  if (sidebarName && _last.username) sidebarName.textContent = _last.username;
}

/** كتابة اسم الحساب في السايدبار (من أحداث حالة الاتصال الفورية) */
export function setSidebarUsername(name) {
  const sidebarName = document.getElementById("tiktok-display");
  if (!sidebarName) return;
  const v = String(name || "");
  if (sidebarName.textContent === v) return;
  sidebarName.textContent = v;
  _last.username = v;
}

/** كتابة نص/لون حالة الاتصال في السايدبار */
export function setConnectionStatus(text, color) {
  const el = document.getElementById("connect-text");
  if (!el) return;
  const t = (window.AppI18n && text ? AppI18n.t(text) : text) || "";
  if (el.textContent === t && el.style.color === color) return;
  el.textContent = t;
  if (color) el.style.color = color;
}
