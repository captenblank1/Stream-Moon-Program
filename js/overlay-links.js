// ============================================================
// overlay-links.js — روابط صفحات الأوفرلايز المشتركة
// (أوفرلايز اللايف + عداد الفوز + القوائم) مع كاش توكن الشاشة
// ============================================================
import __S from "./state.js";
import { fetchWithAuth, escapeHtml } from "./utils-core.js";

let _token = null;
let _cid = null;
let _promise = null;

// ============================================================
// ✅ هوية المشاهد للجداول — المنطق انتقل للسياق الموحد user-context.js
// (المصدر الوحيد للاسم المعروض وسلسلة بدائل الصورة). الدوال هنا أُعاد
// تصديرها للتوافق مع كل الموديولات التي تستوردها من هذا الملف
// ============================================================
import { avatarHtml as _avatarHtml, ensureAvatarToken as _ensureAvatarToken, setAvatarToken } from "./user-context.js";

export async function ensureAvatarToken() {
  try {
    // getScreenTokenCached معرَّف في هذا الملف أدناه (function declaration — hoisted)
    setAvatarToken((await getScreenTokenCached()) || "");
  } catch (e) {}
  return _ensureAvatarToken();
}

export function avatarHtml(username, avatarUrl) {
  return _avatarHtml(username, avatarUrl);
}

// أساس رابط الأوفرلايز:
// - ✅ متصل بالحساب السحابي → الروابط على الدومين https://www.streammoon.net
//   (نفس روابط الشاشات — الأوفرلايز تُفتح في OBS بالدومين لا برابط الباك إند)
// - متصل بسيرفر محلي (localhost/شبكة محلية) → الروابط محلية، فالدومين
//   لا يعرف بيانات السيرفر المحلي (404)
export function overlayBase() {
  const api = String(__S.API_BASE || "").trim();
  const isLocalApi = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(
    api,
  );
  if (api && !isLocalApi) {
    const widget = String(__S.WIDGET_BASE || "").trim();
    if (/^https?:\/\//i.test(widget)) return widget;
  }
  if (/^https?:\/\//i.test(api)) return api;
  if (
    typeof window !== "undefined" &&
    /^https?:\/\//i.test(window.location.origin || "")
  ) {
    return window.location.origin;
  }
  const widget2 = String(__S.WIDGET_BASE || "").trim();
  if (/^https?:\/\//i.test(widget2)) return widget2;
  return api;
}

// رابط أي أوفرلاي حسب نوعها:
// viewers/last-gift/highest-gift/leaderboard/coin-jar/followers/fireworks → /widget/live-overlay
// wins → /widget/wins — list-1/list-2 → /widget/overlay
// music → /widget/music (أوفرلاي طلبات الأغاني — من قسم الأغاني وروابط الشاشه)
export function overlayLinkFor(kind) {
  const cid = encodeURIComponent(_cid || "");
  if (kind === "wins") {
    return `${overlayBase()}/widget/wins?cid=${cid}`;
  }
  if (kind === "music") {
    return `${overlayBase()}/widget/music?cid=${cid}`;
  }
  if (kind === "list-1" || kind === "list-2") {
    return `${overlayBase()}/widget/overlay?cid=${cid}&id=${kind === "list-2" ? 2 : 1}`;
  }
  return `${overlayBase()}/widget/live-overlay?cid=${cid}&kind=${kind}`;
}

// جلب توكن الشاشة مع كاش — يعيد المحاولة عند الفشل في المرة القادمة
export async function getScreenTokenCached() {
  if (_token) return _token;
  if (_promise) return _promise;
  _promise = (async () => {
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/user/screen-token`);
      const data = await res.json();
      if (data.success) {
        _token = data.token;
        _cid = data.widgetId || null;
      }
    } catch (e) {}
    _promise = null;
    return _token;
  })();
  return _promise;
}

export function getWidgetCid() {
  return _cid;
}
