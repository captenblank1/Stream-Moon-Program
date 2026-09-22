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
// ✅ هوية المشاهد للجداول — المصدر الموحد للصورة/الاسم/اليوزر.
// avatarHtml: سلسلة بدائل للصورة (رابط تيك توك → بروكسي الخادم →
// أيقونة مستخدم) تُستخدم في جداول النقاط والمميزين ونقاط المشاهدين
// ============================================================
let _avatarToken = "";

export async function ensureAvatarToken() {
  try {
    _avatarToken = (await getScreenTokenCached()) || "";
  } catch (e) {}
  return _avatarToken;
}

// سلسلة بدائل الصور (يُستدعى من onerror): الأصلي → البروكسي → الإزالة
if (typeof window !== "undefined") {
  window.__pbAvatarErr = function (img) {
    if (!img.dataset.stage && img.dataset.proxy) {
      img.dataset.stage = "1";
      img.src = img.dataset.proxy;
      return;
    }
    img.remove();
  };
}

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
      `<img src="${proxy}" ${imgAttrs}></span>`
    );
  return `<span class="vps-avatar" style="${style}">${fallback}</span>`;
}

// أساس رابط الأوفرلايز = السيرفر الذي التطبيق متصل به فعلاً (API_BASE):
// - متصل بالحساب السحابي → الروابط على الدومين https://www.streammoon.net
// - متصل بسيرفر محلي → الروابط محلية (الدومين لا يعرف بياناتك المحلية — 404)
export function overlayBase() {
  const api = String(__S.API_BASE || "").trim();
  if (/^https?:\/\//i.test(api)) return api;
  if (
    typeof window !== "undefined" &&
    /^https?:\/\//i.test(window.location.origin || "")
  ) {
    return window.location.origin;
  }
  const widget = String(__S.WIDGET_BASE || "").trim();
  if (/^https?:\/\//i.test(widget)) return widget;
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
