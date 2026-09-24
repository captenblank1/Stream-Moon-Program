// ============================================================
// js/songs.js — قسم طلبات الأغاني (Song Requests)
// الطابور وقيد التشغيل يتحدثان لحظياً عبر Socket.IO (sr-queue)،
// والإعدادات تُحفظ عبر REST، ورابط أوفرلاي OBS يُنسخ بنفس نمط
// روابط الأوفرلايز الموجودة في البرنامج.
// ============================================================
import __S from "./state.js";
import { escapeHtml, fetchWithAuth, showMessage, showConfirm, getDeviceId, initPointsMasterSwitch } from "./utils-core.js";
import { showAddonSection, registerAddonLoader } from "./addons-nav.js";
import { displayName } from "./user-context.js";
import { overlayBase, getScreenTokenCached, getWidgetCid, avatarHtml, ensureAvatarToken } from "./overlay-links.js";
import { getAuthToken } from "./pairing.js";

const T = (s) => (window.AppI18n ? AppI18n.t(s) : s);

let loadedOnce = false;
let settingsReady = false; // ✅ لا حفظ قبل تحميل الإعدادات الفعلية من السيرفر
let searchTimer = null;
let currentSearchResults = [];

function el(id) {
  return document.getElementById(id);
}

// ✅ كتابة حالة القسم — كانت مستدعاة في مواضع كثيرة بلا تعريف داخل الموديول
// (ReferenceError صامت يوقف رسائل الحفظ التلقائي) — نفس نمط tts.js
function showStatus(text, ok) {
  const status = el("srStatus");
  if (!status) return;
  status.textContent = text;
  status.style.color = ok ? "#4caf50" : "var(--danger-color)";
}

// ✅ سلسلة بدائل لصور المشاهد (تُستخدم في كل الجداول):
// 1) الرابط الأصلي من تيك توك  2) بروكسي الخادم (data-proxy)  3) الأيقونة
// يُستدعى من خاصية onerror للصور في جداول النقاط والمميزين والمشاهدين

// ============================================================
// قيد التشغيل الآن + الطابور
// ============================================================
function renderNowPlaying(current, paused) {
  const empty = el("srNowEmpty");
  const body = el("srNowBody");
  const art = el("srNowArt");
  const pausedBadge = el("srNowPaused");
  if (!current) {
    empty.style.display = "block";
    body.style.display = "none";
    return;
  }
  empty.style.display = "none";
  body.style.display = "flex";
  // صورة الألبوم تظهر فقط عند توفرها — src فارغ يعني أيقونة صورة مكسورة
  if (current.artwork) {
    art.src = current.artwork;
    art.style.display = "block";
  } else {
    art.removeAttribute("src");
    art.style.display = "none";
  }
  el("srNowTitle").textContent = current.title || "";
  el("srNowArtist").textContent = current.artist || "";
  el("srNowReq").innerHTML =
    '<i class="fas fa-music"></i> ' +
    T("مطلوبة بواسطة") +
    " " +
    escapeHtml(current.requestedBy || "");
  if (pausedBadge) pausedBadge.hidden = !paused;
}

function renderQueue(queue) {
  const list = el("srQueueList");
  if (!list) return;
  if (!queue || !queue.length) {
    list.innerHTML =
      '<div class="sr-queue-empty">' +
      T("الطابور فاضي — المشاهدون يطلبون عبر !play") +
      "</div>";
    return;
  }
  list.innerHTML = queue
    .map(
      (q) =>
        '<div class="sr-queue-item" data-id="' +
        escapeHtml(q.id) +
        '">' +
        '<img src="' +
        escapeHtml(q.artwork || "") +
        '" alt="" loading="lazy">' +
        '<div class="t"><div class="n">' +
        escapeHtml(q.title || "") +
        " — " +
        escapeHtml(q.artist || "") +
        '</div><div class="s">' +
        T("بواسطة") +
        " " +
        escapeHtml(q.requestedBy || "") +
        "</div></div>" +
        '<button class="remove-sr" title="' +
        T("إزالة") +
        '"><i class="fas fa-xmark"></i></button>' +
        "</div>",
    )
    .join("");
}

function renderSearchState(available) {
  const badge = el("srSearchState");
  if (!badge) return;
  if (available === undefined || available === null) {
    badge.textContent = "";
    return;
  }
  if (available) {
    badge.innerHTML =
      '<i class="fas fa-circle-check"></i> ' + T("البحث في ساوند كلاود متاح");
    badge.className = "sr-search-state ok";
  } else {
    badge.innerHTML =
      '<i class="fas fa-circle-xmark"></i> ' +
      T("البحث غير متاح الآن — جرّب لاحقاً أو استخدم لينك مباشر");
    badge.className = "sr-search-state down";
  }
}

function applyState(state) {
  if (!state) return;
  renderNowPlaying(state.current || null, !!state.paused);
  renderQueue(state.queue || []);
  if ("searchAvailable" in state) renderSearchState(state.searchAvailable);
}

// ============================================================
// سجل التشغيلات
// ============================================================
const HIST_STATUS = {
  played: "تم تشغيلها",
  skipped: "تم تخطيها",
  revoked: "تم إلغاؤها",
};

function renderHistory(history) {
  const body = el("srHistoryBody");
  if (!body) return;
  if (!history || !history.length) {
    body.innerHTML =
      '<tr><td colspan="4" class="sr-history-empty">' +
      T("لا يوجد سجل بعد") +
      "</td></tr>";
    return;
  }
  body.innerHTML = history
    .map((h) => {
      const statusKey = HIST_STATUS[h.status] ? h.status : "played";
      const date = h.date ? new Date(h.date) : null;
      const timeStr = date
        ? date.toLocaleString(
            window.AppI18n && AppI18n.lang === "en" ? "en-US" : "ar-EG",
            { dateStyle: "short", timeStyle: "short" },
          )
        : "";
      return (
        "<tr>" +
        "<td>" +
        escapeHtml(h.track || "") +
        "</td>" +
        "<td>" +
        escapeHtml(h.user || "") +
        "</td>" +
        '<td class="sr-hist-status-' +
        statusKey +
        '">' +
        T(HIST_STATUS[statusKey]) +
        "</td>" +
        "<td>" +
        timeStr +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

// ============================================================
// الإعدادات
// ============================================================
function fillSettingsForm(s) {
  const set = (id, on) => {
    const c = el(id);
    if (c) c.checked = !!on;
  };
  const num = (id, v) => {
    const n = el(id);
    if (n) n.value = v ?? 0;
  };
  set("srEnabled", s.enabled ?? true);
  set("srPlayEnabled", s.playEnabled ?? true);
  set("srSkipEnabled", s.skipEnabled ?? true);
  num("srPlayCost", s.playCost ?? 0);
  num("srSkipCost", s.skipCost ?? 1);
  num("srMaxQueue", s.maxQueue ?? 20);
  num("srMaxQueuePerUser", s.maxQueuePerUser ?? 2);
  num("srPointsPerMessage", s.pointsPerMessage ?? 1);
  num("srPointsPerLike", s.pointsPerLike ?? 0);
  num("srPointsPerCoins", s.pointsPerCoins ?? 0);
  // ✅ تشيك بوكسات ثلاثية النقاط — التفعيل/الإيقاف من صاحب البث
  set("srPointsMsgOn", (s.pointsPerMessage ?? 0) > 0);
  set("srPointsLikeOn", (s.pointsPerLike ?? 0) > 0);
  set("srPointsCoinsOn", (s.pointsPerCoins ?? 0) > 0);
  // ✅ المفتاح الرئيسي لخيارات النقاط — محفوظ بالسيرفر: إعادة التفعيل
  // تعرض الخيارات كما كانت قبل الإيقاف
  const master = el("srPointsMaster");
  if (master) {
    master.checked = s.pointsEnabled !== false;
    master.__applyPointsMasterState?.();
  }
  num("srVolume", s.volume ?? 80);
  num("srOverlayScale", s.overlayScale ?? 100);
  // ✅ مزامنة القيم المعروضة — كانت تعتمد على حدث input فقط فظلت تعرض
  // القيمة الافتراضية بعد تحميل الإعدادات المحفوظة حتى يحركها المستخدم
  const volOut = el("srVolumeVal");
  if (volOut) volOut.textContent = el("srVolume").value;
  const scaleOut = el("srOverlayScaleVal");
  if (scaleOut) scaleOut.textContent = el("srOverlayScale").value;
  const af = s.allowedFor || {};
  // ✅ تحميل الأوضاع كما حُفظت — اختيار حر متعدد بلا حصرية قسرية
  set("srAllowedAll", af.all ?? true);
  set("srAllowedFollowers", af.followers ?? false);
  set("srAllowedSubs", af.subs ?? false);
  num("srAllowedSubsLevel", af.subsLevel ?? 1);
  set("srAllowedMods", af.mods ?? false);
  set("srAllowedTopFan", af.topFan ?? false);
  set("srAllowedTopGifters", af.topGifters ?? false);
  num("srAllowedTopGiftersCount", af.topGiftersCount ?? 3);
  set("srAllowExplicit", s.allowExplicit ?? true);
  set("srAllowSkipRequested", s.allowSkipRequested ?? true);
  set("srOverlayPermanent", s.overlayPermanent ?? true);
}

function collectSettingsForm() {
  const form = {
    enabled: el("srEnabled").checked,
    playEnabled: el("srPlayEnabled").checked,
    skipEnabled: el("srSkipEnabled").checked,
    playCost: parseInt(el("srPlayCost").value, 10) || 0,
    skipCost: parseInt(el("srSkipCost").value, 10) || 0,
    maxQueue: parseInt(el("srMaxQueue").value, 10) || 20,
    maxQueuePerUser: parseInt(el("srMaxQueuePerUser").value, 10) || 2,
    // ✅ ثلاثية النقاط: التشيك بوكس مطفي = القيمة تصفر (0 = معطل بالباكند)
    pointsEnabled: el("srPointsMaster")?.checked !== false,
    pointsPerMessage: el("srPointsMsgOn")?.checked
      ? parseInt(el("srPointsPerMessage").value, 10) || 0
      : 0,
    pointsPerLike: el("srPointsLikeOn")?.checked
      ? parseInt(el("srPointsPerLike").value, 10) || 0
      : 0,
    pointsPerCoins: el("srPointsCoinsOn")?.checked
      ? parseInt(el("srPointsPerCoins").value, 10) || 0
      : 0,
    // ✅ NaN-safe بدل || — كان 0 (كتم الصوت) يتحول لـ80 عند الحفظ
    volume: Number.isFinite(parseInt(el("srVolume").value, 10))
      ? parseInt(el("srVolume").value, 10)
      : 80,
    overlayScale: parseInt(el("srOverlayScale").value, 10) || 100,
    allowedFor: {
      all: el("srAllowedAll").checked,
      followers: el("srAllowedFollowers").checked,
      subs: el("srAllowedSubs").checked,
      subsLevel: parseInt(el("srAllowedSubsLevel")?.value, 10) || 1,
      mods: el("srAllowedMods").checked,
      topFan: el("srAllowedTopFan").checked,
      topGifters: el("srAllowedTopGifters").checked,
      topGiftersCount: parseInt(el("srAllowedTopGiftersCount").value, 10) || 3,
    },
    allowExplicit: el("srAllowExplicit").checked,
    allowSkipRequested: el("srAllowSkipRequested").checked,
    overlayPermanent: el("srOverlayPermanent").checked,
  };
  // ✅ حماية "لا أحد": لو كل أوضاع الصلاحيات طلعت مطفأة — الجميع يُفعّل
  // تلقائياً قبل الحفظ (نفس سلوك TTS) حتى لا تُحفظ إعدادات تمنع الجميع
  const af = form.allowedFor;
  if (
    !af.all && !af.followers && !af.subs &&
    !af.mods && !af.topFan && !af.topGifters
  ) {
    af.all = true;
    const allBox = el("srAllowedAll");
    if (allBox) allBox.checked = true;
  }
  return form;
}

// ============================================================
// لوحة "أعلى المشاهدين نقاطاً" — جدول بطاقة النقاط (تُستخدم في
// قسم الأغاني وقسم TTS — نفس رصيد النقاط) — تُصدَّر لـ tts.js
// ============================================================
function fmtCount(n) {
  // ✅ الأرقام تُعرض كاملة بفواصل الآلاف — بدون اختصار K/M
  if (n == null) return "—";
  return (parseInt(n, 10) || 0).toLocaleString("en-US");
}


const pointsBoardRows = new Map(); // tbodyId → صفوف اللوحة الحالية (للتعديل والبحث)

export async function loadPointsBoard(tbodyId, base = "/api/songs") {
  const tbody = el(tbodyId);
  if (!tbody) return;
  try {
    await ensureAvatarToken();
    const res = await fetchWithAuth(`${__S.API_BASE}${base}/points`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "failed");
    pointsBoardRows.set(tbodyId, data.rows || []);
    renderPointsBoard(tbodyId);
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="vps-empty">' +
      T("فشل تحميل النقاط") +
      "</td></tr>";
  }
}

// ✅ الرسم مع فلتر البحث باليوزر/الاسم
function renderPointsBoard(tbodyId) {
  const tbody = el(tbodyId);
  if (!tbody) return;
  const all = pointsBoardRows.get(tbodyId) || [];
  const searchId =
    tbodyId === "srPointsBoardBody" ? "srPointsSearch" : "ttsPointsSearch";
  const q = (el(searchId)?.value || "").trim().toLowerCase();
  const rows = q
    ? all.filter(
        (r) =>
          r.username.includes(q) ||
          String(r.nickname || "").toLowerCase().includes(q),
      )
    : all;
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="vps-empty">' +
      (q
        ? T("مفيش نتيجة للبحث ده")
        : T("لا يوجد مشاهدون بنقاط بعد — تُكتسب من الشات واللايكات والهدايا")) +
      "</td></tr>";
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const u = escapeHtml(r.username);
      return (
        "<tr>" +
        '<td><span style="display: flex; align-items: center; gap: 8px;">' +
        avatarHtml(r.username, r.avatar) +
        '<span class="vps-names"><b>' +
        escapeHtml(displayName(r.nickname, r.username)) +
        "</b><i>@" +
        u +
        "</i></span>" +
        "</span></td>" +
        '<td class="pb-points-cell"><span style="font-weight: 700;"><i class="fas fa-star"></i> ' +
        fmtCount(r.points) +
        "</span></td>" +
        '<td class="vps-options" style="min-width: 140px;">' +
        '<div class="row-actions" style="display: flex; align-items: center; justify-content: center; width: 100%;">' +
        `<button type="button" class="vps-act edit pb-act" data-act="edit" data-u="${u}" title="${T(
          "تعديل النقاط",
        )}"><i class="fas fa-pen-to-square"></i></button>` +
        `<button type="button" class="vps-act del pb-act" data-act="del" data-u="${u}" title="${T(
          "حذف النقاط",
        )}"><i class="fas fa-trash"></i></button>` +
        "</div>" +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

// ✅ توگل "مجاني" — يعفي المشاهد من أسعار الطلب والتخطي حتى لو مفعلة
// ===== تعديل/حذف نقاط مشاهد من الجدول =====
async function handlePointsBoardAction(e, tbodyId, base = "/api/songs") {
  const btn = e.target.closest("button.pb-act");
  if (!btn) return;
  const row = btn.closest("tr");
  if (!row) return;
  const user = btn.dataset.u || "";
  const act = btn.dataset.act;

  // ✅ التحرير داخل الخلية: زر النقاط يتحول لحقل رقمي + زر تأكيد
  if (act === "edit") {
    const cell = row.querySelector(".pb-points-cell");
    if (!cell || cell.querySelector("input")) return;
    const current =
      (pointsBoardRows.get(tbodyId) || []).find((r) => r.username === user)
        ?.points ?? 0;
    cell.innerHTML =
      '<span style="display: inline-flex; align-items: center; gap: 6px;">' +
      `<input type="number" class="pb-points-input" value="${current}" min="0" style="width: 90px;">` +
      // ✅ نفس زر الحفظ الموحد 30×30 (.vps-act) المستخدم في جداول الموقع
      `<button type="button" class="vps-act save pb-act" data-act="save" data-u="${escapeHtml(
        user,
      )}" title="${T("حفظ")}"><i class="fas fa-check"></i></button>` +
      "</span>";
    cell.querySelector("input")?.focus();
    return;
  }

  if (act === "save") {
    const points = parseInt(row.querySelector(".pb-points-input")?.value, 10);
    if (!Number.isFinite(points) || points < 0) {
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          T("اكتب عدداً صحيحاً للنقاط"),
      );
      return;
    }
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}${base}/points/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, points }),
      });
      const d = await res.json();
      if (d.success) loadPointsBoard(tbodyId);
      else
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> " +
            (d.message || T("فشل الحفظ")),
        );
    } catch {
      showMessage("<i class='fas fa-triangle-exclamation'></i> " + T("فشل الحفظ"));
    }
    return;
  }

  if (act === "del") {
    const ok = await showConfirm(
      T("حذف المستخدم") + ' "' + user + '" ' + T("من القائمة؟"),
    );
    if (!ok) return;
    try {
      const res = await fetchWithAuth(
        `${__S.API_BASE}${base}/points/delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user }),
        },
      );
      const d = await res.json();
      if (d.success) loadPointsBoard(tbodyId);
      else
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> " +
            (d.message || T("فشل الحفظ")),
        );
    } catch {
      showMessage("<i class='fas fa-triangle-exclamation'></i> " + T("فشل الحفظ"));
    }
  }
}

// ============================================================
// جدول "الأشخاص المميزين" — المعفون من أسعار الطلب والتخطي.
// دائمون لا يُصفَّرون مع اللايف. نمط جدول الأصوات المخصصة في TTS:
// إضافة بالاسم + تعديل (زر الإضافة يتحول لتحديث) + حذف
// ============================================================

export async function loadVipBoard(tbodyId, base = "/api/songs") {
  const tbody = el(tbodyId);
  if (!tbody) return;
  try {
    await ensureAvatarToken();
    const res = await fetchWithAuth(`${__S.API_BASE}${base}/vips`);
    const data = await res.json();
    if (!data.success) throw new Error("failed");
    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="2" class="vps-empty">' +
        T("لا يوجد أشخاص مميزين بعد — أضف من الحقل أعلاه") +
        "</td></tr>";
      return;
    }
    tbody.innerHTML = rows
      .map((r) => {
        const u = escapeHtml(r.username);
        return (
        "<tr>" +
        '<td><span style="display: flex; align-items: center; gap: 8px;">' +
        avatarHtml(r.username, r.avatar) +
        '<span class="vps-names"><b>' +
        escapeHtml(displayName(r.nickname, r.username)) +
        "</b><i>@" +
        u +
        "</i></span>" +
        "</span></td>" +
        '<td class="vps-options" style="min-width: 140px;">' +
          '<div class="row-actions" style="display: flex; align-items: center; justify-content: center; width: 100%;">' +
          `<button type="button" class="vps-act edit vip-act" data-act="edit" data-u="${u}" title="${T(
            "تعديل",
          )}"><i class="fas fa-pen"></i></button>` +
          `<button type="button" class="vps-act del vip-act" data-act="del" data-u="${u}" title="${T(
            "حذف",
          )}"><i class="fas fa-trash"></i></button>` +
          "</div>" +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="2" class="vps-empty">' +
      T("فشل تحميل القائمة") +
      "</td></tr>";
  }
}

async function handleVipAdd(cfg) {
  const input = el(cfg.inputId);
  const addBtn = el(cfg.addBtnId);
  const user = (input?.value || "").trim();
  if (!user) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> " +
        T("اكتب اسم المستخدم أولاً"),
    );
    return;
  }
  const editing = addBtn?.dataset.editing;
  try {
    const res = editing
      ? await fetchWithAuth(`${__S.API_BASE}${cfg.base}/vips/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: editing, to: user }),
        })
      : await fetchWithAuth(`${__S.API_BASE}${cfg.base}/vips/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user }),
        });
    const d = await res.json();
    if (d.success) {
      if (addBtn) delete addBtn.dataset.editing;
      if (addBtn)
        addBtn.innerHTML = '<i class="fas fa-plus"></i> ' + T("إضافة");
      if (input) input.value = "";
      // ✅ تمرير مخزن القسم (/api/songs أو /api/tts) — كان يُحمّل قائمة
      // الأغاني دائماً فبدا كأن جدول TTS لا يتحدث بعد الإضافة
      loadVipBoard(cfg.tbodyId, cfg.base);
    } else {
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          (d.message || T("فشل الحفظ")),
      );
    }
  } catch {
    showMessage("<i class='fas fa-triangle-exclamation'></i> " + T("فشل الحفظ"));
  }
}

async function handleVipBoardAction(e, cfg) {
  const btn = e.target.closest("button.vip-act");
  if (!btn) return;
  const user = btn.dataset.u || "";
  const input = el(cfg.inputId);
  const addBtn = el(cfg.addBtnId);

  // ✅ التعديل يملأ الحقل ويحول زر الإضافة لتحديث — بنمط أصوات TTS
  if (btn.dataset.act === "edit") {
    if (input) {
      input.value = user;
      input.focus();
    }
    if (addBtn) {
      addBtn.dataset.editing = user;
      addBtn.innerHTML = '<i class="fas fa-save"></i> ' + T("تحديث");
    }
    vipEditing.set(cfg.tbodyId, user);
    return;
  }

  if (btn.dataset.act === "del") {
    const ok = await showConfirm(
      T("حذف المستخدم") + ' "' + user + '" ' + T("من القائمة؟"),
    );
    if (!ok) return;
    try {
      const res = await fetchWithAuth(
        `${__S.API_BASE}${cfg.base}/vips/remove`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user }),
        },
      );
      const d = await res.json();
      if (d.success) {
        // لو المحذوف هو الجاري تعديله — صفّر حالة التحديث
        if (addBtn?.dataset.editing === user) {
          delete addBtn.dataset.editing;
          addBtn.innerHTML = '<i class="fas fa-plus"></i> ' + T("إضافة");
          if (input) input.value = "";
        }
        loadVipBoard(cfg.tbodyId, cfg.base);
      } else {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> " +
            (d.message || T("فشل الحفظ")),
        );
      }
    } catch {
      showMessage("<i class='fas fa-triangle-exclamation'></i> " + T("فشل الحفظ"));
    }
  }
}

export function bindVipBoardControls(inputId, addBtnId, tbodyId, base = "/api/songs") {
  const cfg = { inputId, addBtnId, tbodyId, base };
  el(addBtnId)?.addEventListener("click", () => handleVipAdd(cfg));
  el(inputId)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleVipAdd(cfg);
  });
  el(tbodyId)?.addEventListener("click", (e) => handleVipBoardAction(e, cfg));
}

async function loadState() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/songs/state`);
    const data = await res.json();
    if (!data.success) {
      showStatus(data.message || T("فشل تحميل حالة الأغاني"), false);
      return;
    }
    if (data.settings) fillSettingsForm(data.settings);
    // ✅ الإعدادات الفعلية على الشاشة الآن — يُسمح بالحفظ التلقائي بعدها فقط
    settingsReady = true;
    applyState(data);
    renderHistory(data.history || []);
  } catch (e) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> " + T("فشل تحميل حالة الأغاني"),
    );
  }
}

// ============================================================
// الحفظ التلقائي — أي تغيير في أي إعداد يُحفظ بعد تهدئة قصيرة بلا زر
// ============================================================
let autoSaveTimer = null;
let autoSaving = false;
let pendingSave = false;

function scheduleAutoSave() {
  // ✅ حماية من المسح: قبل تحميل الإعدادات الفعلية أي حفظ يكتب
  // الافتراضيات فوق إعدادات المستخدم المحفوظة (نفس حماية TTS)
  if (!settingsReady) {
    showStatus(T("الإعدادات لم تُحمّل بعد — أعد فتح القسم"), false);
    return;
  }
  clearTimeout(autoSaveTimer);
  showStatus(T("جاري الحفظ..."), true);
  autoSaveTimer = setTimeout(doAutoSave, 300);
}

// ✅ إن أُغلقت النافذة خلال مهلة الحفظ المؤجل — أرسل الحفظ فوراً
// (keepalive يُبقي الطلب حياً أثناء الإغلاق) — كان آخر تغيير يضيع
window.addEventListener("beforeunload", () => {
  if (!autoSaveTimer || !settingsReady) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  try {
    fetch(`${__S.API_BASE}/api/songs/settings`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
        "x-device-id": getDeviceId(),
      },
      body: JSON.stringify({ settings: collectSettingsForm() }),
    }).catch(() => {});
  } catch (e) {}
});

async function doAutoSave() {
  if (autoSaving) {
    pendingSave = true;
    return;
  }
  autoSaving = true;
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/songs/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: collectSettingsForm() }),
    });
    const data = await res.json();
    if (data.success) showStatus(T("تم الحفظ تلقائياً"), true);
    else showStatus(data.message || T("فشل الحفظ"), false);
  } catch (e) {
    showStatus(T("فشل حفظ الإعدادات"), false);
  } finally {
    autoSaving = false;
    if (pendingSave) {
      pendingSave = false;
      scheduleAutoSave();
    }
  }
}

// ============================================================
// البحث والإضافة
// ============================================================
function renderSearchResults(results) {
  const box = el("srSearchResults");
  if (!box) return;
  if (!results || !results.length) {
    box.innerHTML =
      '<div class="sr-search-msg">' + T("لا توجد نتائج") + "</div>";
    return;
  }
  box.innerHTML = results
    .map(
      (r, i) =>
        '<div class="sr-result-item" data-idx="' +
        i +
        '">' +
        '<img src="' +
        escapeHtml(r.artwork || "") +
        '" alt="" loading="lazy">' +
        '<div class="t"><div class="n">' +
        escapeHtml(r.title || "") +
        '</div><div class="a">' +
        escapeHtml(r.artist || "") +
        "</div></div>" +
        '<i class="fas fa-plus" style="color:var(--primary-color)"></i>' +
        "</div>",
    )
    .join("");
  box.querySelectorAll(".sr-result-item").forEach((row) => {
    row.addEventListener("click", () => {
      const r = currentSearchResults[parseInt(row.dataset.idx, 10)];
      if (r) addSong(r.permalink || r.title);
    });
  });
}

async function runSearch(q) {
  try {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/songs/search?q=${encodeURIComponent(q)}`,
    );
    const data = await res.json();
    if (data.success) {
      currentSearchResults = data.results || [];
      renderSearchResults(currentSearchResults);
    } else {
      currentSearchResults = [];
      renderSearchResults([]);
    }
  } catch (e) {
    currentSearchResults = [];
    renderSearchResults([]);
  }
}

async function addSong(query) {
  if (!query) return;
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/songs/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.success) showStatus(T("تمت إضافة الأغنية للطابور"), true);
    else showStatus(data.message || T("فشل الطلب"), false);
  } catch (e) {
    showStatus(T("فشل الطلب"), false);
  }
}

// ============================================================
// رابط أوفرلاي OBS — نفس نمط روابط الأوفرلايز
// ============================================================
async function copyOverlayLink() {
  try {
    const token = await getScreenTokenCached();
    if (!token) {
      showMessage(
        "<i class='fas fa-triangle-exclamation'></i> " +
          T("فشل الحصول على التوكن"),
      );
      return;
    }
    const cid = encodeURIComponent(getWidgetCid() || "");
    const link = `${overlayBase()}/widget/music?cid=${cid}`;
    await navigator.clipboard.writeText(link);
    showMessage("<i class='fas fa-clipboard'></i> " + T("تم نسخ رابط OBS"));
  } catch (e) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> " + T("خطأ في النسخ"),
    );
  }
}

// ============================================================
// التحميل الأولي والربط
// ============================================================
// ✅ ضمان تحميل بيانات القسم — يُستدعى من فتح القسم ومن تاب "الكل"
export function ensureSongsLoaded() {
  if (!loadedOnce) {
    loadedOnce = true;
    loadState();
  } else if (!settingsReady) {
    // ✅ تحميل سابق فشل — أعد المحاولة قبل السماح بالحفظ
    loadState();
  }
  // ✅ جدول أعلى المشاهدين نقاطاً + جدول الأشخاص المميزين
  loadPointsBoard("srPointsBoardBody");
  loadVipBoard("srVipBody");
  const st = el("srStatus");
  if (st && !st.textContent) {
    st.textContent = T("الحفظ تلقائي — أي تعديل يُحفظ مباشرة");
    st.style.color = "var(--text-muted)";
  }
}

function openSongsSection() {
  showAddonSection("startSectionSongs", ".songs", ensureSongsLoaded);
}

function init() {
  const nav = document.querySelector(".songs");
  if (nav) nav.addEventListener("click", openSongsSection);

  // ✅ تاب "الكل" يعرض القسم ويحمّل بياناته (نفس محمّل الفتح)
  registerAddonLoader("startSectionSongs", ensureSongsLoaded);

  // ✅ زر التحديث أُزيل — الجدول يتحدث لحظياً عبر السوكيت تلقائياً
  // ✅ تعديل/حذف نقاط المشاهدين — لكل قسم مخزن نقاطه: الأغاني /api/songs
  // وTTS /api/tts
  el("srPointsBoardBody")?.addEventListener("click", (e) =>
    handlePointsBoardAction(e, "srPointsBoardBody"),
  );
  el("ttsPointsBoardBody")?.addEventListener("click", (e) =>
    handlePointsBoardAction(e, "ttsPointsBoardBody", "/api/tts"),
  );
  // ✅ بحث باليوزر/الاسم — لا يعيد البناء أثناء تحرير نقاط مفتوح
  const bindPointsSearch = (inputId, tbodyId) => {
    el(inputId)?.addEventListener("input", () => {
      if (document.querySelector(".pb-points-input")) return;
      renderPointsBoard(tbodyId);
    });
  };
  bindPointsSearch("srPointsSearch", "srPointsBoardBody");
  bindPointsSearch("ttsPointsSearch", "ttsPointsBoardBody");
  // ✅ جدول الأشخاص المميزين (المعفيون) — قائمة مستقلة لكل قسم.
  // ✅ ربط عناصر TTS يحدث في tts.js فقط — كان مربوطاً هنا أيضاً فكل ضغطة
  // إضافة تطلق طلبين وإعادة تحميلين متتاليين على نفس الجدول
  bindVipBoardControls("srVipUser", "srVipAdd", "srVipBody");

  // أزرار التحكم بالمشغل
  el("srPauseBtn")?.addEventListener("click", () =>
    fetchWithAuth(`${__S.API_BASE}/api/songs/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    }).catch(() => {}),
  );
  el("srResumeBtn")?.addEventListener("click", () =>
    fetchWithAuth(`${__S.API_BASE}/api/songs/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    }).catch(() => {}),
  );
  el("srRestartBtn")?.addEventListener("click", () =>
    fetchWithAuth(`${__S.API_BASE}/api/songs/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart" }),
    }).catch(() => {}),
  );
  el("srSkipBtn")?.addEventListener("click", () =>
    fetchWithAuth(`${__S.API_BASE}/api/songs/skip`, { method: "POST" }).catch(
      () => {},
    ),
  );
  el("srClearBtn")?.addEventListener("click", () =>
    fetchWithAuth(`${__S.API_BASE}/api/songs/clear`, { method: "POST" }).catch(
      () => {},
    ),
  );

  // ✅ حذف آخر التشغيلات — تأكيد ثم مسح السجل (لا يمس الطابور ولا النقاط)
  el("srHistoryClearBtn")?.addEventListener("click", async () => {
    const ok = await showConfirm(T("حذف كل سجل آخر التشغيلات؟"));
    if (!ok) return;
    try {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/songs/history/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (d.success) {
        renderHistory([]);
        showStatus(T("تم حذف سجل التشغيلات"), true);
      } else {
        showStatus(d.message || T("فشل الحذف"), false);
      }
    } catch (e) {
      showStatus(T("فشل الحذف"), false);
    }
  });

  // إزالة أغنية من الطابور (حدث مفوَّض على الحاوية)
  el("srQueueList")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-sr");
    if (!btn) return;
    const id = btn.closest(".sr-queue-item")?.dataset.id;
    if (id)
      fetchWithAuth(`${__S.API_BASE}/api/songs/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).catch(() => {});
  });

  // البحث مع تهدئة كتابة + الإضافة اليدوية
  el("srSearchInput")?.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!q) {
      currentSearchResults = [];
      el("srSearchResults").innerHTML = "";
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 400);
  });
  el("srAddBtn")?.addEventListener("click", () => {
    const q = el("srSearchInput").value.trim();
    if (q) addSong(q);
  });

  // ✅ اختيار حر متعدد — كل الأوضاع تُشتغل مع بعض (OR بالباكند) —
  // مع منع إطفاء كل الأوضاع: آخر وضع يظل مفعولاً لا يمكن إلغاؤه
  const allowedIds = [
    "srAllowedAll",
    "srAllowedFollowers",
    "srAllowedSubs",
    "srAllowedMods",
    "srAllowedTopFan",
    "srAllowedTopGifters",
  ];
  for (const id of allowedIds) {
    el(id)?.addEventListener("change", (e) => {
      if (e.target.checked) return;
      const anyOn = allowedIds.some((oid) => el(oid)?.checked);
      if (!anyOn) {
        e.target.checked = true;
        showStatus(T("لازم يفضل خيار واحد متفعل على الأقل"), false);
      }
    });
  }

  // ✅ إصلاح "الخيار لا يُحفظ": عند تعليم أي صندوق نقاط والقيمة 0 تُملأ
  // تلقائياً بقيمة بداية — كان التعليم مع 0 يحفظ 0 فيرجع الخيار مطفياً
  const pointsStartDefaults = [
    ["srPointsMsgOn", "srPointsPerMessage", 1],
    ["srPointsLikeOn", "srPointsPerLike", 1],
    ["srPointsCoinsOn", "srPointsPerCoins", 1],
  ];
  for (const [cbId, numId, def] of pointsStartDefaults) {
    el(cbId)?.addEventListener("change", (e) => {
      const n = el(numId);
      if (e.target.checked && n && (parseInt(n.value, 10) || 0) <= 0)
        n.value = def;
    });
  }

  // ✅ المفتاح الرئيسي لخيارات النقاط — نفس مكوّن قسم TTS
  initPointsMasterSwitch("srPointsMaster", "srPointsOptions");

  // ✅ حفظ تلقائي: أي تغيير في أي إعداد داخل القسم يحفظ فوراً بعد تهدئة
  // (حقل البحث مستثنى — له سلوكه الخاص)
  const section = document.getElementById("startSectionSongs");
  if (section)
    section.addEventListener("change", (e) => {
      if (e.target.closest(".sr-search-row")) return;
      scheduleAutoSave();
    });
  // شرائح التمرير — عرض القيمة الحية
  el("srVolume")?.addEventListener("input", (e) => {
    el("srVolumeVal").textContent = e.target.value;
  });
  el("srOverlayScale")?.addEventListener("input", (e) => {
    el("srOverlayScaleVal").textContent = e.target.value;
  });
  el("srCopyOverlayBtn")?.addEventListener("click", copyOverlayLink);  // التحديث اللحظي عبر Socket.IO
  const bind = () => {
    if (!__S.frontendSocket) {
      setTimeout(bind, 500);
      return;
    }
    __S.frontendSocket.on("sr-queue", (data) => applyState(data));
    __S.frontendSocket.on("sr-history", (data) =>
      renderHistory(data?.history || []),
    );
    // نتيجة أوامر المشاهدين (!play/!skip/...) — توست فوري بنفس نمط رسائل البرنامج
    __S.frontendSocket.on("song-feed", (data) => {
      if (!data?.text) return;
      showMessage(
        "<i class='fas fa-music'></i> " +
          (window.AppI18n ? AppI18n.t(data.text) : data.text),
      );
    });
    __S.frontendSocket.on("sr-settings", (data) => {
      // حدثت من جهاز آخر — حدّث النموذج إن كان القسم محمّلاً
      if (data?.settings && loadedOnce) fillSettingsForm(data.settings);
    });
    // ✅ تحديث لحظي لجدول النقاط — يأتي مُقيَّداً من الخادم (كل 5 ث عند تغيير)
    // ✅ تحديث لحظي منفصل لكل قسم — يأتي مُقيَّداً من الخادم (كل 5 ث)
    // نقاط الأغاني (sr-points-board) ونقاط TTS (tts-points-board) مستقلة
    const applyBoard = (tbodyId, payload) => {
      if (!payload || !Array.isArray(payload.rows)) return;
      pointsBoardRows.set(tbodyId, payload.rows);
      // لا نمسح محرر نقاط مفتوح
      if (document.querySelector(".pb-points-input")) return;
      renderPointsBoard(tbodyId);
    };
    __S.frontendSocket.on("sr-points-board", (p) =>
      applyBoard("srPointsBoardBody", p),
    );
    __S.frontendSocket.on("tts-points-board", (p) =>
      applyBoard("ttsPointsBoardBody", p),
    );
  };
  bind();
}

init();
