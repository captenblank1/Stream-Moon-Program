// ============================================================
// js/viewerstats.js — قسم نقاط المشاهدين (Users Points)
// سجل دائم لكل مشاهد: العملات المتراكمة + عدد متابعيه + أول وآخر نشاط
// مع بحث وفلتر Min/Max وفلتر "حتى تاريخ معين بالوقت" وتعديل/حذف/بروفايل
// ============================================================
import __S from "./state.js";
import { escapeHtml, fetchWithAuth, showConfirm, showMessage } from "./utils-core.js";
import { avatarHtml, ensureAvatarToken } from "./overlay-links.js";
import { showAddonSection } from "./addons-nav.js";

const T = (s) => (window.AppI18n ? AppI18n.t(s) : s);

let loadedOnce = false;
let rows = []; // البيانات الخام من الخادم
let dateFilterActive = false;

function el(id) {
  return document.getElementById(id);
}

function fmtCount(n) {
  if (n == null) return "—";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(
    window.AppI18n && AppI18n.lang === "en" ? "en-US" : "ar-EG",
    { dateStyle: "short", timeStyle: "short" },
  );
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
      renderTable();
    }
  } catch (e) {
    showMessageSafe(T("فشل تحميل البيانات"));
  }
}

function showMessageSafe(text) {
  if (typeof showMessage === "function")
    showMessage("<i class='fas fa-triangle-exclamation'></i> " + text);
}

// ================ الفلاتر ================
function filteredRows() {
  const search = (el("vpsSearch")?.value || "").trim().toLowerCase();
  const min = parseInt(el("vpsMin")?.value, 10);
  const max = parseInt(el("vpsMax")?.value, 10);
  return rows.filter((r) => {
    if (search) {
      const hay = `${r.nickname || ""} ${r.username}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (Number.isFinite(min) && r.coins < min) return false;
    if (Number.isFinite(max) && max > 0 && r.coins > max) return false;
    return true;
  });
}

function renderTable() {
  const tbody = el("vpsTableBody");
  if (!tbody) return;
  const list = filteredRows();
  const count = el("vpsCount");
  if (count) count.textContent = list.length;

  if (!list.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="vps-empty">' +
      T("لا توجد بيانات مطابقة — تجمع تلقائياً من أحداث البث") +
      "</td></tr>";
    return;
  }

  const medal = (rank) => {
    if (rank === 1)
      return '<span class="vps-rank r1"><i class="fas fa-crown"></i></span>';
    if (rank === 2)
      return '<span class="vps-rank r2"><i class="fas fa-award"></i></span>';
    if (rank === 3)
      return '<span class="vps-rank r3"><i class="fas fa-medal"></i></span>';
    return `<span class="vps-rank">${rank}</span>`;
  };

  tbody.innerHTML = list
    .map((r, i) => {
      const u = escapeHtml(r.username);
      return (
        "<tr>" +
        '<td class="vps-options">' +
        `<button class="vps-act edit" data-act="edit" data-u="${u}" title="${T("تعديل العملات")}"><i class="fas fa-pen-to-square"></i></button>` +
        `<button class="vps-act del" data-act="del" data-u="${u}" title="${T("حذف من القائمة")}"><i class="fas fa-trash"></i></button>` +
        "</td>" +
        '<td class="vps-rank-cell">' + medal(i + 1) + "</td>" +
        '<td class="vps-avatar-cell">' +
        // ✅ الصورة من المصدر الموحد (رابط أصلي → بروكسي → أيقونة)
        avatarHtml(r.username, r.avatar) +
        "</td>" +
        '<td class="vps-user">' +
        '<span class="vps-names"><b>' +
        escapeHtml(r.nickname || r.username) +
        "</b><i>@" + u + "</i></span>" +
        "</td>" +
        `<td><span class="vps-coins"><i class="fas fa-coins"></i> ${fmtCount(r.coins)}</span></td>` +
        `<td class="vps-followers">${r.followersCount != null ? "👥 " + fmtCount(r.followersCount) : "—"}</td>` +
        `<td class="vps-date">📅 ${fmtDate(r.firstActivity)}</td>` +
        `<td class="vps-date">📅 ${fmtDate(r.lastActivity)}</td>` +
        '<td class="vps-link">' +
        `<a class="vps-open" href="https://www.tiktok.com/@${u}" target="_blank" rel="noopener noreferrer" title="${T("فتح البروفايل")}"><i class="fas fa-up-right-from-square"></i></a>` +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

// ================ تعديل العملات ================
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
      showMessageSafe(
        "<i class='fas fa-check'></i> " + T("تم الحفظ"),
      );
      await loadRows();
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
    await loadRows();
  } catch (e) {}
}

// ================ الفتح والربط ================
function openSection() {
  showAddonSection("startSectionViewerpoints", ".viewerpoints", () => {
    if (!loadedOnce) {
      loadedOnce = true;
      loadRows();
    }
  });
}

function init() {
  const nav = document.querySelector(".viewerpoints");
  if (nav) nav.addEventListener("click", openSection);

  // ✅ التحديث الفوري انتقل إلى socket.js (refreshFromSocket) — المستمع
  // القديم هنا كان ميتاً لأن __S.frontendSocket يُنشأ بعد تحميل الموديول

  // ✅ الفلاتر لا تعيد البناء أثناء تعديل عملات مفتوح — نفس حماية
  // refreshFromSocket (كان الكتابة في البحث تمسح المحرر وقيمته غير المحفوظة)
  const rerenderIfIdle = () => {
    if (document.querySelector(".vps-coins-edit")) return;
    renderTable();
  };
  el("vpsSearch")?.addEventListener("input", rerenderIfIdle);
  el("vpsMin")?.addEventListener("input", rerenderIfIdle);
  el("vpsMax")?.addEventListener("input", rerenderIfIdle);
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
    else if (act === "cancel") renderTable();
    else if (act === "del") deleteRow(btn.dataset.u);
  });
}

// ✅ تحديث فوري عند بث السيرفر حدث تغيّر النقاط (يُستدعى من socket.js —
// يعيش ويتجدد مع السوكيت بدل مستمع مربوط بموديول قبل وجود سوكيت)
// تخفيف 2 ثانية + تجاهل أثناء تعديل صف حتى لا تُهدب المدخلات المفتوحة
let refreshTimer = null;
export function refreshFromSocket() {
  if (!loadedOnce) return;
  if (document.querySelector(".vps-coins-edit")) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    loadRows();
  }, 2000);
}

init();
