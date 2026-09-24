// ============================================================
// js/viewerstats.js — قسم نقاط المشاهدين (Users Points)
// سجل دائم لكل مشاهد: العملات المتراكمة + عدد متابعيه + أول وآخر نشاط
// مع بحث وفلتر Min/Max وفلتر "حتى تاريخ معين بالوقت" وتعديل/حذف/بروفايل
//
// ✅ التحديث اللحظي بلا إعادة رسم الجدول: كل تفاعل (هدية/تعليق/متابعة)
// يُحدّث صف المشاهد نفسه فقط عبر viewer-stats-row / viewer-info، والمشاهد
// الجديد يُضاف فوراً في مكانه حسب النقاط — بدون مسح الجدول كله
// ============================================================
import __S from "./state.js";
import { escapeHtml, fetchWithAuth, showConfirm, showMessage } from "./utils-core.js";
import { avatarHtml, ensureAvatarToken } from "./overlay-links.js";
import { showAddonSection, registerAddonLoader } from "./addons-nav.js";
import { displayName } from "./user-context.js";

const T = (s) => (window.AppI18n ? AppI18n.t(s) : s);

let loadedOnce = false;
let rows = []; // البيانات الخام من الخادم
let dateFilterActive = false;
let asOfInfo = null; // { asOf, ledgerStart } — بيانات وضع "حتى تاريخ"
const rowEls = new Map(); // username → <tr> (التحديث الموضعي للصفوف)

function el(id) {
  return document.getElementById(id);
}

function fmtCount(n) {
  // ✅ الأرقام تُعرض كاملة بفواصل الآلاف (109,304) — بدون اختصار K/M
  if (n == null) return "—";
  return (parseInt(n, 10) || 0).toLocaleString("en-US");
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(
    window.AppI18n && AppI18n.lang === "en" ? "en-US" : "ar-EG",
    { dateStyle: "short", timeStyle: "short" },
  );
}

function showMessageSafe(text) {
  if (typeof showMessage === "function")
    showMessage("<i class='fas fa-triangle-exclamation'></i> " + text);
}

// ================ تحميل الجدول ================
async function loadRows() {
  const tbody = el("vpsTableBody");
  if (tbody)
    tbody.innerHTML =
      '<tr><td colspan="9" class="vps-empty"><i class="fas fa-spinner fa-spin"></i> ' +
      T("جاري التحميل...") +
      "</td></tr>";
  try {
    // ✅ جهّز توكن الشاشة لبروكسي الصور (فشل الرابط الأصلي → البروكسي)
    ensureAvatarToken();
    const params = new URLSearchParams();
    if (dateFilterActive) {
      const v = el("vpsDate").value;
      if (v) params.set("date", new Date(v).toISOString());
    }
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/viewer-stats?${params.toString()}`,
    );
    const data = await res.json();
    if (data.success) {
      rows = data.rows || [];
      dateFilterActive = !!data.asOf;
      asOfInfo =
        data.asOf != null
          ? { asOf: data.asOf, ledgerStart: data.ledgerStart || null }
          : null;
      updateAsOfInfo();
      renderTable();
    }
  } catch (e) {
    showMessageSafe(T("فشل تحميل البيانات"));
  }
}

// ================ شريط توضيح وضع "حتى تاريخ" ================
// يشرح للواجهة أن الجدول يعامل القيم كنقاط مسجلة حتى اللحظة المحددة،
// ويحذر بوضوح لو التاريخ قبل بدء السجل التفصيلي (قيم تقريبية)
function updateAsOfInfo() {
  const box = el("vpsAsOfInfo");
  if (!box) return;
  if (!dateFilterActive || !asOfInfo?.asOf) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const dateStr = fmtDate(asOfInfo.asOf);
  let html =
    "<i class='fas fa-clock-rotate-left'></i> " +
    T("النقاط المعروضة هي المجموع المسجل لكل مشاهد حتى") +
    " <b>" +
    escapeHtml(dateStr) +
    "</b>";
  const ls = asOfInfo.ledgerStart ? new Date(asOfInfo.ledgerStart) : null;
  if (ls && ls.getTime() > new Date(asOfInfo.asOf).getTime()) {
    html +=
      "<br><i class='fas fa-circle-info'></i> " +
      T("السجل التفصيلي يبدأ من") +
      " <b>" +
      escapeHtml(fmtDate(asOfInfo.ledgerStart)) +
      "</b> — " +
      T("قيم المشاهدين الأقدم من ذلك تقريبية (≈ إجماليهم الحالي)");
  }
  box.innerHTML = html;
  box.style.display = "block";
}

// ================ الفلاتر (إظهار/إخفاء الصفوف بلا إعادة بناء) ================
function rowMatches(r) {
  const search = (el("vpsSearch")?.value || "").trim().toLowerCase();
  const min = parseInt(el("vpsMin")?.value, 10);
  const max = parseInt(el("vpsMax")?.value, 10);
  if (search) {
    const hay = `${r.nickname || ""} ${r.username}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  if (Number.isFinite(min) && r.coins < min) return false;
  if (Number.isFinite(max) && max > 0 && r.coins > max) return false;
  return true;
}

// ✅ الفلترة بإخفاء الصفوف المخالفة فقط — الكتابة في البحث لا تعيد رسم الجدول
function applyFilters() {
  const tbody = el("vpsTableBody");
  if (!tbody) return;
  let visible = 0;
  for (const r of rows) {
    const tr = rowEls.get(r.username);
    if (!tr) continue;
    const show = rowMatches(r);
    tr.style.display = show ? "" : "none";
    if (show) visible++;
  }
  const count = el("vpsCount");
  if (count) count.textContent = visible;
  // لو مفيش أي صف ظاهر — أظهر رسالة الفراغ
  syncEmptyRow(visible);
}

function syncEmptyRow(visible) {
  const tbody = el("vpsTableBody");
  if (!tbody) return;
  let emptyTr = tbody.querySelector("tr.vps-empty-row");
  if (!visible && rows.length) {
    if (!emptyTr) {
      emptyTr = document.createElement("tr");
      emptyTr.className = "vps-empty-row";
      emptyTr.innerHTML =
        '<td colspan="9" class="vps-empty">' +
        T("لا توجد بيانات مطابقة — تجمع تلقائياً من أحداث البث") +
        "</td>";
      tbody.appendChild(emptyTr);
    }
    emptyTr.style.display = "";
  } else if (emptyTr) {
    emptyTr.remove();
  }
}

// ================ بناء الصفوف ================
function medal(rank) {
  if (rank === 1)
    return '<span class="vps-rank r1"><i class="fas fa-crown"></i></span>';
  if (rank === 2)
    return '<span class="vps-rank r2"><i class="fas fa-award"></i></span>';
  if (rank === 3)
    return '<span class="vps-rank r3"><i class="fas fa-medal"></i></span>';
  return `<span class="vps-rank">${rank}</span>`;
}

function coinsCellHtml(r) {
  // ✅ ≈ بجوار القيمة = مشاهد قديم قبل بدء السجل التفصيلي — القيمة
  // تقريبية (الإجمالي الحالي) لا دقيقة من دفعات ذلك التاريخ
  return (
    `<span class="vps-coins"><i class="fas fa-coins"></i> ${fmtCount(r.coins)}` +
    (r.approx
      ? ` <i class="fas fa-circle-info vps-approx" title="${T(
          "قيمة تقريبية — قبل بدء السجل التفصيلي",
        )}"></i>`
      : "") +
    "</span>"
  );
}

function rowHtml(r) {
  const u = escapeHtml(r.username);
  return (
    '<td class="vps-rank-cell">' + medal(0) + "</td>" +
    '<td class="vps-avatar-cell">' +
    // ✅ الصورة من المصدر الموحد (رابط أصلي → بروكسي → أيقونة)
    avatarHtml(r.username, r.avatar) +
    "</td>" +
    '<td class="vps-user">' +
    '<span class="vps-names"><b>' +
    escapeHtml(displayName(r.nickname, r.username)) +
    "</b><i>@" + u + "</i></span>" +
    "</td>" +
    `<td>${coinsCellHtml(r)}</td>` +
    `<td class="vps-followers">${r.followersCount != null ? '<i class="fas fa-users"></i> ' + fmtCount(r.followersCount) : "—"}</td>` +
    // ✅ خليتا أول/آخر نشاط لعرض التاريخ فقط — الاختيار من فلتر البحث
    // الزمني الموحد «اعرض العملات حتى تاريخ معين»
    `<td class="vps-date"><i class="fas fa-calendar-days"></i> ${r.firstActivity ? fmtDate(r.firstActivity) : "—"}</td>` +
    `<td class="vps-date"><i class="fas fa-calendar-days"></i> ${r.lastActivity ? fmtDate(r.lastActivity) : "—"}</td>` +
    '<td class="vps-link">' +
    `<a class="vps-open" href="https://www.tiktok.com/@${u}" target="_blank" rel="noopener noreferrer" title="${T("فتح البروفايل")}"><i class="fas fa-up-right-from-square"></i></a>` +
    "</td>" +
    // ✅ عمود الخيارات أخيراً — في آخر الصف (يسار الجدول RTL) متسقاً مع
    // باقي جداول الموقع بدل أول عمود ملاصق لحد الطاولة
    '<td class="vps-options" style="min-width: 140px;">' +
    // ✅ توسيط مضمون بتضمينه inline — يتغلب على أي CSS قديم/ناقص في أي نسخة
    '<div class="row-actions" style="display: flex; align-items: center; justify-content: center; width: 100%;">' +
    `<button class="vps-act edit" data-act="edit" data-u="${u}" title="${T("تعديل العملات")}"><i class="fas fa-pen-to-square"></i></button>` +
    `<button class="vps-act del" data-act="del" data-u="${u}" title="${T("حذف من القائمة")}"><i class="fas fa-trash"></i></button>` +
    "</div>" +
    "</td>"
  );
}

// ✅ تحديث أوسمة الترتيب (1-3) حسب الترتيب الحالي — بعد إضافة/إعادة ترتيب صف
function refreshRankBadges() {
  const tbody = el("vpsTableBody");
  if (!tbody) return;
  let rank = 0;
  for (const tr of tbody.children) {
    if (tr.style.display === "none" || tr.classList.contains("vps-empty-row"))
      continue;
    rank++;
    const cell = tr.querySelector(".vps-rank-cell");
    if (cell) cell.innerHTML = medal(rank);
  }
}

// ✅ إعادة تموضع صف واحد حسب النقاط (ترتيب تنازلي) — يلمس صفه فقط
function repositionRow(tr, r) {
  const tbody = el("vpsTableBody");
  if (!tbody || !tr) return;
  tr.dataset.coins = r.coins || 0;
  const others = [...tbody.children].filter(
    (x) => x !== tr && !x.classList.contains("vps-empty-row"),
  );
  let before = null;
  for (const other of others) {
    const c = parseInt(other.dataset.coins || "0", 10) || 0;
    if ((r.coins || 0) >= c) {
      before = other;
      break;
    }
  }
  if (before) tbody.insertBefore(tr, before);
  else {
    const emptyTr = tbody.querySelector("tr.vps-empty-row");
    if (emptyTr) tbody.insertBefore(tr, emptyTr);
    else tbody.appendChild(tr);
  }
  refreshRankBadges();
}

// ================ الرسم الكامل (أول تحميل/تغيير فلتر التاريخ فقط) ================
function renderTable() {
  const tbody = el("vpsTableBody");
  if (!tbody) return;
  const list = filteredRowsAll();
  const count = el("vpsCount");
  if (count) count.textContent = list.length;

  rowEls.clear();
  if (!list.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="vps-empty">' +
      T("لا توجد بيانات مطابقة — تجمع تلقائياً من أحداث البث") +
      "</td></tr>";
    return;
  }

  tbody.innerHTML = "";
  for (const r of list) {
    const tr = document.createElement("tr");
    tr.dataset.coins = r.coins || 0;
    tr.innerHTML = rowHtml(r);
    rowEls.set(r.username, tr);
    tbody.appendChild(tr);
  }
  // ✅ طبّق فلاتر البحث/المدى المخزنة بعد أي إعادة بناء ثم أوسمة الترتيب
  // (الترتيب يُحسب للصفوف الظاهرة فقط — بعد الإخفاء لا قبله)
  applyFilters();
  refreshRankBadges();
}

// كل الصفوف (بلا فلتر بحث — الفلترة الآن بالإخفاء في applyFilters)
function filteredRowsAll() {
  return rows;
}

// ================ التعديل داخل الصف ================
// ✅ تمرير زر البدء نفسه بدل بناء selector من اليوزر الخام — اليوزرات
// التي تحوي " أو \ كانت تكسر querySelector فلا يفتح المحرر إطلاقاً
function beginEdit(editBtn) {
  const row = editBtn?.closest("tr");
  if (!row) return;
  const coinsCell = row.querySelector(".vps-coins");
  const username = editBtn.dataset.u;
  const current = rows.find((r) => r.username === username)?.coins ?? 0;
  coinsCell.innerHTML =
    `<input type="number" class="vps-coins-edit" value="${current}" min="0" style="width:100px"> ` +
    // ✅ data-act على زرّي الحفظ/الإلغاء إلزامي — معالج النقر يفرّع على
    // dataset.act وغيابه كان يترك الزرين ميتين (سبب عطل التعديل الفعلي)
    `<button class="vps-act save" data-act="save" data-u="${escapeHtml(username)}" title="${T("حفظ")}"><i class="fas fa-check"></i></button>` +
    `<button class="vps-act cancel" data-act="cancel" title="${T("إلغاء")}"><i class="fas fa-xmark"></i></button>`;
  coinsCell.querySelector(".vps-coins-edit").focus();
}

async function saveEdit(saveBtn) {
  const input = saveBtn?.parentNode?.querySelector(".vps-coins-edit");
  const username = saveBtn?.dataset.u || "";
  const coins = parseInt(input?.value, 10);
  if (!username || !Number.isFinite(coins) || coins < 0) return;
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/viewer-stats/set-coins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, coins }),
    });
    const data = await res.json();
    if (data.success) {
      showMessageSafe("<i class='fas fa-check'></i> " + T("تم الحفظ"));
      // ✅ حدّث صف هذا المشاهد فقط محلياً بدل إعادة تحميل الجدول كله
      upsertRow({ username, coins, lastActivity: new Date().toISOString() });
    } else showMessageSafe(data.message || T("فشل الحفظ"));
  } catch (e) {
    showMessageSafe(T("فشل الحفظ"));
  }
}

async function deleteRow(username) {
  const ok = window.confirm
    ? window.confirm(T("حذف المشاهد من القائمة نهائياً؟"))
    : true;
  if (!ok) return;
  try {
    await fetchWithAuth(`${__S.API_BASE}/api/viewer-stats/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    // ✅ إزالة الصف من الذاكرة ومن الجدول مباشرة
    rows = rows.filter((r) => r.username !== username);
    rowEls.get(username)?.remove();
    rowEls.delete(username);
    refreshRankBadges();
    applyFilters();
  } catch (e) {}
}

// ============================================================
// ✅ التحديث الموضعي لصف واحد — من أحداث السوكيت (هدية/تعليق/متابعة)
// يُحدّث خلايا الصف نفسه، ويضيف المشاهد الجديد فوراً في مكانه حسب النقاط
// ============================================================
function upsertRow(data, { keepCoins = false } = {}) {
  if (!data?.username) return;
  // وضع "حتى تاريخ" يمثل لقطة تاريخية — التحديثات الحية لا تنطبق عليه
  if (dateFilterActive) return;

  let r = rows.find((x) => x.username === data.username);
  if (!r) {
    r = {
      username: data.username,
      nickname: data.nickname || data.username,
      avatar: data.avatar || "",
      followersCount: data.followersCount ?? null,
      coins: keepCoins ? 0 : data.coins || 0,
      firstActivity: data.firstActivity || null,
      lastActivity: data.lastActivity || null,
      approx: false,
    };
    rows.push(r);
  } else {
    if (data.nickname) r.nickname = data.nickname;
    if (data.avatar) r.avatar = data.avatar;
    if (data.followersCount != null) r.followersCount = data.followersCount;
    if (!keepCoins && data.coins != null) r.coins = data.coins;
    if (data.firstActivity) r.firstActivity = data.firstActivity;
    if (data.lastActivity) r.lastActivity = data.lastActivity;
  }

  const tbody = el("vpsTableBody");
  if (!tbody) return;
  // لا نلمس الصف أثناء تحرير النقاط فيه
  const editing = tbody.querySelector(".vps-coins-edit");
  const editingRow = editing?.closest("tr");

  let tr = rowEls.get(r.username);
  if (!tr) {
    // مشاهد جديد — أضف صفه فوراً
    tbody.querySelector("tr.vps-empty-row")?.remove();
    tr = document.createElement("tr");
    tr.dataset.coins = r.coins || 0;
    tr.innerHTML = rowHtml(r);
    rowEls.set(r.username, tr);
    repositionRow(tr, r);
  } else if (tr !== editingRow) {
    // حدّث خلايا الصف الموجود في مكانه (بدون إعادة بناء الجدول)
    tr.innerHTML = rowHtml(r);
    repositionRow(tr, r);
  }
  applyFilters();
}

// ✅ من أحداث viewer-info اللحظية: اسم/صورة/متابعون فقط — بلا مساس بالنقاط
// مع خفض التردد (ثانية لكل مشاهد) — الأحداث تتوالى بسرعة خلال اللايف
const _livePending = new Map(); // username → آخر حالة
const _liveTimers = new Map(); // username → مؤقت
export function applyLiveProfile(profile) {
  if (!profile?.username) return;
  const key = String(profile.username).toLowerCase();
  _livePending.set(key, profile);
  if (_liveTimers.has(key)) return;
  _liveTimers.set(
    key,
    setTimeout(() => {
      _liveTimers.delete(key);
      const p = _livePending.get(key);
      if (p) {
        _livePending.delete(key);
        applyLiveProfileNow(p);
      }
    }, 1000),
  );
}

function applyLiveProfileNow(profile) {
  upsertRow(
    {
      username: profile.username,
      nickname: profile.nickname,
      avatar: profile.avatar,
      followersCount: profile.followersCount,
      lastActivity: profile.lastSeen ? new Date(profile.lastSeen) : null,
    },
    { keepCoins: true },
  );
}

// ================ الفتح والربط ================
// ✅ ضمان التحميل مرة واحدة — من فتح القسم ومن تاب "الكل"
export function ensureViewerStatsLoaded() {
  if (!loadedOnce) {
    loadedOnce = true;
    loadRows();
  }
}

function openSection() {
  showAddonSection("startSectionViewerpoints", ".viewerpoints", ensureViewerStatsLoaded);
}

function init() {
  const nav = document.querySelector(".viewerpoints");
  if (nav) nav.addEventListener("click", openSection);

  // ✅ تاب "الكل" يعرض القسم ويحمّل بياناته (نفس محمّل الفتح)
  registerAddonLoader("startSectionViewerpoints", ensureViewerStatsLoaded);

  // ✅ الفلاتر تخفي/تظهر الصفوف فقط — لا إعادة بناء للجدول أثناء الكتابة
  el("vpsSearch")?.addEventListener("input", applyFilters);
  el("vpsMin")?.addEventListener("input", applyFilters);
  el("vpsMax")?.addEventListener("input", applyFilters);
  el("vpsDateApply")?.addEventListener("click", () => {
    dateFilterActive = !!el("vpsDate").value;
    loadRows();
  });
  el("vpsDateClear")?.addEventListener("click", () => {
    dateFilterActive = false;
    el("vpsDate").value = "";
    loadRows();
  });

  // ✅ حذف الكل — تأكيد ثم مسح كل سجلات النقاط
  el("vpsDeleteAll")?.addEventListener("click", async () => {
    const ok = await showConfirm(T("هل أنت متأكد من حذف جميع سجلات النقاط؟"));
    if (!ok) return;
    try {
      await fetchWithAuth(`${__S.API_BASE}/api/viewer-stats/delete-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      rows = [];
      rowEls.clear();
      renderTable();
      showMessageSafe(T("تم حذف جميع السجلات"));
    } catch (e) {
      showMessageSafe(T("فشل الحذف"));
    }
  });

  el("vpsTableBody")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".vps-act");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "edit") beginEdit(btn);
    else if (act === "save") saveEdit(btn);
    else if (act === "cancel") {
      // استعادة خلايا الصف كما كانت — من بيانات الذاكرة
      const tr = btn.closest("tr");
      const username = btn.parentNode?.querySelector(".vps-act.save")?.dataset.u;
      const r = rows.find((x) => x.username === username);
      if (tr && r) tr.innerHTML = rowHtml(r);
    } else if (act === "del") deleteRow(btn.dataset.u);
  });
}

// ✅ بث السيرفر صفوفاً محدثة (بعد كل دفعة حفظ) — يُستدعى من socket.js
export function applyStatsRow(row) {
  upsertRow(row);
}

// ✅ تحديث فوري عند بث السيرفر حدث تغيّر النقاط — بقيت كنقطة أمان:
// مع تحديث الصف الواحد (viewer-stats-row) لا حاجة لإعادة تحميل الجدول كله
export function refreshFromSocket() {
  if (!loadedOnce) return;
  // وضع "حتى تاريخ": اللقطة التاريخية لا تتحدث صفياً — أعد الجلب كاملاً
  if (dateFilterActive) loadRows();
}

init();
