// ============================================================
// js/livefeed.js — قسم اللايف فيد
// كل ما يحدث في اللايف (تعليق/لايك/هدية/متابعة/دخول/مشاركة) يصل
// عبر Socket.IO حدث "live-feed" بالاسم والصورة ويُرسم هنا لحظياً،
// مع مخزن محلي لآخر 200 حدث + تشيك بوكس تحديد أنواع الأحداث المعروضة
// (الاختيار محفوظ في localStorage — إخفاء النوع يخفي أحداثه كلها).
// ============================================================
import __S from "./state.js";
import { escapeHtml, fetchWithAuth } from "./utils-core.js";
import { showAddonSection } from "./addons-nav.js";

const T = (s) => (window.AppI18n ? AppI18n.t(s) : s);

// ---- حالة الوحدة ----
let loadedOnce = false;
const stats = { comments: 0, likes: 0, gifts: 0, follows: 0, shares: 0, joins: 0 };
const MAX_FEED_ITEMS = 200;
const FEED_FILTER_KEY = "sm_lf_filters";

// مخزن الأحداث — الأساس لإعادة الرسم عند تغيير الفلاتر
let feedBuffer = [];
// ملفات المشاهدين القادمة من الخادم (viewer-info) — username → profile
const viewerProfiles = new Map();
let visibleTypes = null; // Set أو null (null = الكل ظاهر)

const TYPE_META = {
  chat: { emoji: "💬" },
  gift: { emoji: "🎁" },
  like: { emoji: "❤️" },
  follow: { emoji: "➕" },
  join: { emoji: "👋" },
  share: { emoji: "🔄" },
  subscribe: { emoji: "⭐" },
  system: { emoji: "⭐" },
};
// الأنواع القابلة للفلترة (system دائماً ظاهر ولا يدخل العد)
const FILTERABLE_TYPES = [
  "chat",
  "like",
  "gift",
  "follow",
  "join",
  "share",
  "subscribe",
];

function el(id) {
  return document.getElementById(id);
}

function fmtTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString(
    window.AppI18n && AppI18n.lang === "en" ? "en-US" : "ar-EG",
    { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );
}

function updateStats() {
  const map = {
    lfStatComments: stats.comments,
    lfStatLikes: stats.likes,
    lfStatGifts: stats.gifts,
    lfStatFollows: stats.follows,
    lfStatShares: stats.shares,
    lfStatJoins: stats.joins,
  };
  for (const [id, val] of Object.entries(map)) {
    const n = el(id);
    if (n) n.textContent = val;
  }
}

function resetFeed() {
  feedBuffer = [];
  stats.comments = 0;
  stats.likes = 0;
  stats.gifts = 0;
  stats.follows = 0;
  stats.shares = 0;
  stats.joins = 0;
  updateStats();
  renderFeed();
}

// ---- الفلاتر ----
function loadVisibleTypes() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEED_FILTER_KEY) || "null");
    if (raw && typeof raw === "object") return new Set(raw);
  } catch (e) {}
  return null;
}

function saveVisibleTypes() {
  try {
    localStorage.setItem(
      FEED_FILTER_KEY,
      JSON.stringify(visibleTypes ? [...visibleTypes] : null),
    );
  } catch (e) {}
}

function isTypeVisible(type) {
  return !visibleTypes || type === "system" || visibleTypes.has(type);
}

function syncFilterChecks() {
  const box = el("lfFilters");
  if (!box) return;
  box.querySelectorAll("input[data-type]").forEach((inp) => {
    const on = isTypeVisible(inp.dataset.type);
    inp.checked = on;
    inp.closest(".lf-filter")?.classList.toggle("on", on);
  });
}

function bindFilters() {
  const box = el("lfFilters");
  if (!box) return;
  box.addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-type]");
    if (!inp) return;
    const type = inp.dataset.type;
    if (!visibleTypes) {
      // أول إيقاف: ابدأ بالكل مفعّلاً
      visibleTypes = new Set(FILTERABLE_TYPES);
    }
    if (inp.checked) visibleTypes.add(type);
    else visibleTypes.delete(type);
    // كل الأنواع مفعّلة = نلغي الفلترة نهائياً (نظام افتراضي نظيف)
    visibleTypes = visibleTypes.size >= FILTERABLE_TYPES.length
      ? null
      : visibleTypes;
    saveVisibleTypes();
    syncFilterChecks();
    renderFeed();
  });
  syncFilterChecks();
}

// ---- الرسم ----
// نصوص ثانوية لكل نوع — مترجمة حسب لغة الواجهة
function describeItem(type, data) {
  switch (type) {
    case "like":
      return `${parseInt(data.text, 10) || 1} ${T("لايك")}`;
    case "follow":
      return T("متابعة جديدة");
    case "join":
      return T("دخول البث");
    case "share":
      return T("مشاركة البث");
    case "subscribe":
      return T("اشتراك جديد");
    case "system":
      return T(data.text || "");
    default:
      // نص التعليق/الأغنية يُعرض كما هو — لا تمريرته على المترجم
      return data.text || "";
  }
}

function buildItemHtml(item) {
  const meta = TYPE_META[item.type] || TYPE_META.system;
  const isSystem = item.type === "system";
  const user = isSystem ? "Stream Moon" : item.nickname || item.user || "—";
  const text = describeItem(item.type, item);
  const avatar = item.avatar
    ? '<img class="feed-item-avatar" src="' +
      escapeHtml(item.avatar) +
      '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();var s=this.parentNode&amp;&amp;this.parentNode.querySelector(\'.feed-item-emoji\');if(s)s.classList.remove(\'hidden\')">'
    : "";
  const coinsHtml =
    item.type === "gift" && item.coins
      ? '<span class="feed-item-coins">+' + item.coins + " 🪙</span>"
      : "";
  return (
    '<div class="feed-item-icon ' +
    escapeHtml(item.type) +
    '">' +
    avatar +
    '<span class="feed-item-emoji' +
    (item.avatar ? " hidden" : "") +
    '">' +
    meta.emoji +
    "</span></div>" +
    '<div class="feed-item-content">' +
    '<div class="feed-item-user">' +
    escapeHtml(user) +
    "</div>" +
    '<div class="feed-item-text">' +
    escapeHtml(text) +
    coinsHtml +
    "</div>" +
    "</div>" +
    '<div class="feed-item-time">' +
    fmtTime(item.ts) +
    "</div>"
  );
}

/** إعادة رسم الفيد كاملاً من المخزن مع تطبيق الفلاتر (الأحدث في الأسفل) */
function renderFeed() {
  const list = el("feed-list");
  if (!list) return;
  const empty = el("feed-empty");
  const visible = feedBuffer.filter((i) => isTypeVisible(i.type));
  // الحالة الفارغة تظهر فقط عند انعدام الأحداث الظاهرة (بعد الفلاتر)
  if (empty) empty.classList.toggle("hidden", visible.length > 0);
  list.innerHTML = "";
  // ✅ تنازلي: الأقدم أعلى والأحدث يظهر أسفل القائمة (نمط شات التيك توك)
  for (let i = 0; i < visible.length; i++) {
    const div = document.createElement("div");
    div.className = "feed-item";
    div.dataset.user = visible[i].user || "";
    div.innerHTML = buildItemHtml(visible[i]);
    attachFollowerChip(div, visible[i].user);
    list.appendChild(div);
  }
  // سقف الذاكرة — الأحدث في الأسفل فالأقدم (أول الصفوف) يُحذف
  while (list.children.length > MAX_FEED_ITEMS) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
  updateFeedStatus();
}

function updateFeedStatus() {
  const status = el("lfStatus");
  if (!status) return;
  if (__S.isLiveConnected) {
    status.textContent = T("جاري تسجيل أحداث البث...") + ` (${feedBuffer.length})`;
    status.classList.add("recording");
  } else {
    status.textContent = T("غير متصل ببث تيك توك حالياً");
    status.classList.remove("recording");
  }
}

// ---- استقبال الأحداث ----
function pushEvent(item) {
  if (!item || !item.type) return;
  if (item.type === "chat") stats.comments++;
  else if (item.type === "like") stats.likes += parseInt(item.text, 10) || 1;
  else if (item.type === "gift") stats.gifts++;
  else if (item.type === "follow") stats.follows++;
  else if (item.type === "share") stats.shares++;
  else if (item.type === "join") stats.joins++;
  updateStats();
  feedBuffer.push(item);
  while (feedBuffer.length > MAX_FEED_ITEMS) feedBuffer.shift();
  // الحدث الجديد يُضاف أسفل القائمة (تنازلي) — مع تتبع تلقائي للأسفل
  // لو المستخدم كان قريباً من آخر الفيد أصلاً
  if (isTypeVisible(item.type)) {
    const list = el("feed-list");
    if (list) {
      const nearBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      const div = document.createElement("div");
      div.className = "feed-item";
      div.dataset.user = item.user || "";
      div.innerHTML = buildItemHtml(item);
      attachFollowerChip(div, item.user);
      list.appendChild(div);
      while (list.children.length > MAX_FEED_ITEMS) list.firstChild.remove();
      if (nearBottom) list.scrollTop = list.scrollHeight;
    }
  }
  updateFeedStatus();
}

// ---- التحميل الأولي (لقطة آخر الأحداث عند الفتح في منتصف البث) ----
async function loadFeedSnapshot() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/live-feed`);
    const data = await res.json();
    if (data.success && Array.isArray(data.items)) {
      // الأقدم أولاً — نرسم بالترتيب فيظهر الأحدث أسفل القائمة
      for (const item of data.items) pushEvent(item);
    }
  } catch (e) {}
  updateFeedStatus();
}

function openLivefeedSection() {
  showAddonSection("startSectionLivefeed", ".livefeed", () => {
    if (!loadedOnce) {
      loadedOnce = true;
      loadFeedSnapshot();
    }
    updateFeedStatus();
  });
}

// ---- ملفات المشاهدين ----
function followerChipHtml(username) {
  const p = viewerProfiles.get(String(username || "").toLowerCase());
  if (!p || p.followersCount == null) return "";
  return (
    '<span class="feed-item-fcount"><i class="fas fa-users"></i> ' +
    formatCount(p.followersCount) +
    "</span>"
  );
}

function formatCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function attachFollowerChip(div, username) {
  const chip = followerChipHtml(username);
  if (chip) div.querySelector(".feed-item-user").insertAdjacentHTML("afterend", chip);
}

function refreshViewerChips(username) {
  const key = String(username || "").toLowerCase();
  document
    .querySelectorAll('#feed-list .feed-item[data-user="' + key + '"]')
    .forEach((div) => {
      const chip = followerChipHtml(key);
      const old = div.querySelector(".feed-item-fcount");
      if (old) old.remove();
      if (chip) div.querySelector(".feed-item-user").insertAdjacentHTML("afterend", chip);
    });
}

function showProfileCard(username, fallbackAvatar) {
  const key = String(username || "").toLowerCase();
  if (!key || key === "stream moon") return;
  const card = el("lfProfileCard");
  if (!card) return;
  // من الكاش فوراً ثم من الخادم — وصورة الصف نفسه احتياط لو ملف الخادم
  // فاضي (بعد إعادة تشغيله) حتى لا يظهر الكارت بلا صورة أبداً
  const cached = viewerProfiles.get(key);
  renderProfileCard({
    username: key,
    ...(cached || {}),
    avatar: cached?.avatar || fallbackAvatar || "",
  });
  fetchWithAuth(
    `${__S.API_BASE}/api/viewer-profile?username=${encodeURIComponent(key)}`,
  )
    .then((r) => r.json())
    .then((data) => {
      if (data.success && data.profile) {
        const profile = {
          ...data.profile,
          avatar: data.profile.avatar || fallbackAvatar || "",
        };
        viewerProfiles.set(key, profile);
        renderProfileCard(profile);
        refreshViewerChips(key);
      }
    })
    .catch(() => {});
  card.hidden = false;
}

function roleLabel(v) {
  if (v === "during-live")
    return { text: T("أثناء هذا البث"), cls: "during" };
  if (v === "yes") return { text: T("نعم"), cls: "yes" };
  return null;
}

function renderProfileCard(p) {
  // ✅ src فاضي كان يُحمَّل كرابط للصفحة نفسها — نحذفه ونخفي الصورة،
  // ونجدّد الظهور عند وجود صورة (بعد إخفاء سابق بعطل تحميل)
  const avatarEl = el("lfProfileAvatar");
  if (p.avatar) {
    avatarEl.style.visibility = "";
    avatarEl.src = p.avatar;
  } else {
    avatarEl.removeAttribute("src");
    avatarEl.style.visibility = "hidden";
  }
  el("lfProfileNick").textContent = p.nickname || p.username || "—";
  el("lfProfileUser").textContent = "@" + (p.username || "");
  el("lfProfileFollowers").textContent =
    p.followersCount != null ? formatCount(p.followersCount) : "—";
  el("lfProfileCoins").textContent = "🪙 " + (p.coins || 0);
  el("lfProfileLikes").textContent = "❤️ " + (p.likes || 0);
  el("lfProfileComments").textContent = "💬 " + (p.comments || 0);
  el("lfProfileGifts").textContent = "🎁 " + (p.gifts || 0);
  const roles = el("lfProfileRoles");
  roles.innerHTML = "";
  const f = roleLabel(p.followsStreamer);
  if (f) {
    const s = document.createElement("span");
    s.className = "lf-role-badge " + f.cls;
    s.textContent = "➕ " + T("متابع لك") + " (" + f.text + ")";
    roles.appendChild(s);
  }
  const sb = roleLabel(p.subscriber);
  if (sb) {
    const s = document.createElement("span");
    s.className = "lf-role-badge " + sb.cls;
    s.textContent = "⭐ " + T("مشترك") + " (" + sb.text + ")";
    roles.appendChild(s);
  }
  if (p.teamMemberLevel) {
    const s = document.createElement("span");
    s.className = "lf-role-badge yes";
    s.textContent = "🛡 " + T("قلب الفريق") + " L" + p.teamMemberLevel;
    roles.appendChild(s);
  }
  if (!roles.children.length) {
    const s = document.createElement("span");
    s.className = "lf-role-badge none";
    s.textContent = T("لا أدوار معروفة بعد");
    roles.appendChild(s);
  }
}

// ---- الربط ----
function init() {
  const nav = document.querySelector(".livefeed");
  if (nav) nav.addEventListener("click", openLivefeedSection);

  const clearBtn = el("lfClearBtn");
  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      resetFeed();
      updateFeedStatus();
    });

  visibleTypes = loadVisibleTypes();
  bindFilters();

  // النقر على مشاهد → كارت ملفه الكامل — صورة الصف نفسه تُمرر احتياطاً
  // حتى لا يظهر الكارت بلا صورة لو الخادم بلا ملف محفوظ
  el("feed-list")?.addEventListener("click", (e) => {
    const item = e.target.closest(".feed-item");
    if (!item) return;
    const rowAvatar = item.querySelector(".feed-item-avatar")?.src || "";
    showProfileCard(item.dataset.user, rowAvatar);
  });
  el("lfProfileClose")?.addEventListener("click", () => {
    const card = el("lfProfileCard");
    if (card) card.hidden = true;
  });

  // الأحداث الحية من السيرفر
  const bind = () => {
    if (!__S.frontendSocket) {
      setTimeout(bind, 500);
      return;
    }
    __S.frontendSocket.on("live-feed", pushEvent);
    // ✅ ملفات المشاهدين القادمة من الخادم — تحديث الكاش والشارات
    __S.frontendSocket.on("viewer-info", (data) => {
      const p = data?.profile;
      if (!p || !p.username) return;
      viewerProfiles.set(String(p.username).toLowerCase(), p);
      refreshViewerChips(p.username);
    });

    // بدء بث جديد فعلاً (fresh) فقط: تصفير العدادات — إعادة الاتصال التلقائي
    // أثناء نفس البث لا يمسح الفيد ولا العدادات
    __S.frontendSocket.on("live-status-updated", (data) => {
      if (data?.isLive && data?.fresh) resetFeed();
      updateFeedStatus();
    });
  };
  bind();
}

init();
