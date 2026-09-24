// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { fetchWithAuth } from "./utils-core.js";
import { showNotification } from "./notifications.js";
import { applyContactLinksVisibility } from "./notifications.js";
import { showMessage } from "./utils-core.js";
import { showConfirm } from "./utils-core.js";

// ============================================================
// دوال المشرف (Admin)
// ============================================================
// بناء HTML أزرار إجراءات صف المستخدم — مشترك بين الرسم الكامل والتحديث الجزئي
function buildAdminUserActionsHtml(user, now) {
  const expiryDate = user.subscriptionExpiry
    ? new Date(user.subscriptionExpiry)
    : null;
  const isPaid = user.plan === "paid";
  const isActive = isPaid && expiryDate && expiryDate > now;
  const makeAdminDisabled =
    user.role === "admin"
      ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
      : "";
  const removeAdminDisabled =
    user.role !== "admin"
      ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
      : "";
  const renewDisabled =
    isPaid && isActive ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : "";
  const downgradeDisabled =
    !isPaid || !isActive
      ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
      : "";
  return `
    <button class="admin-delete-user" data-id="${escapeHtml(user.id)}">حذف الحساب</button>
    <button class="admin-remove-admin" data-id="${escapeHtml(user.id)}" ${removeAdminDisabled}>إزالة المدير</button>
    <button class="admin-make-admin" data-id="${escapeHtml(user.id)}" ${makeAdminDisabled}>ترقية مدير</button>
    <button class="admin-downgrade" data-id="${escapeHtml(user.id)}" ${downgradeDisabled}>الغاء الاشتراك</button>
    <button class="admin-renew-yearly" data-id="${escapeHtml(user.id)}" data-plan="yearly" ${renewDisabled}>اشتراك سنه</button>
    <button class="admin-renew-monthly" data-id="${escapeHtml(user.id)}" data-plan="monthly" ${renewDisabled}>اشتراك شهر</button>
    <button class="admin-block-device" data-id="${escapeHtml(user.id)}" ${user.deviceBlocked ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ""}>${user.deviceBlocked ? "الجهاز محظور" : "<i class='fas fa-ban'></i> حظر الجهاز"}</button>
  `;
}

// بناء HTML صف مستخدم واحد في جدول الأدمن — يُستخدم في الرسم الكامل
// وفي التحديث الجزيئي (إضافة صف جديد بدون إعادة رسم اللوحة)
function buildAdminUserRowHtml(user, now) {
  const expiry = user.subscriptionExpiry
    ? new Date(user.subscriptionExpiry).toLocaleDateString("ar-EG")
    : "غير محدد";
  const planBadge =
    user.plan === "paid"
      ? '<span class="badge-paid">مدفوع</span>'
      : '<span class="badge-free">مجاني</span>';
  const planType = user.planType
    ? user.planType === "monthly"
      ? "شهري"
      : "سنوي"
    : "—";
  const roleBadge =
    user.role === "admin"
      ? '<span class="badge-admin">مدير</span>'
      : '<span class="badge-user">مستخدم</span>';
  const liveStatusHtml = user.isLiveNow
    ? '<span class="status-live"><i class="fas fa-circle" style="color:#4caf50"></i> مباشر</span>'
    : '<span class="status-offline"><i class="fas fa-circle" style="color:#444"></i> غير متصل</span>';
  const tiktokHtml = user.tiktokUsername
    ? `<span class="tiktok-user">@${escapeHtml(user.tiktokUsername)}</span>`
    : "—";
  const expiryDate = user.subscriptionExpiry
    ? new Date(user.subscriptionExpiry)
    : null;
  const isPaid = user.plan === "paid";
  const isActive = isPaid && expiryDate && expiryDate > now;

  const actionsHtml = buildAdminUserActionsHtml(user, now);

  return `
    <td>${escapeHtml(user.email)}</td>
    <td class="cell-plan">${planBadge}</td>
    <td class="cell-plan-type">${planType}</td>
    <td class="cell-expiry">${expiry}</td>
    <td class="cell-role">${roleBadge}</td>
    <td class="cell-tiktok">${tiktokHtml}</td>
    <td class="cell-live">${liveStatusHtml}</td>
    <td class="cell-connects" style="text-align:center; color:#7fd7e8; font-weight:700;">${escapeHtml(user.connectsToday ?? 0)}</td>
    <td class="cell-gifts-today" style="text-align:center; color:#ffd54f; font-weight:700;">${escapeHtml(user.giftsToday ?? 0)}</td>
    <td class="cell-gifts-month" style="text-align:center; color:#ffd54f;">${escapeHtml(user.giftsThisMonth ?? 0)}</td>
    <td class="lux-dev cell-device" title="اضغط للنسخ" onclick="navigator.clipboard.writeText('${escapeHtml(user.deviceId || "")}').then(()=>showMessage('<i class='fas fa-clipboard'></i> تم نسخ البصمة'))">${user.deviceId ? escapeHtml(user.deviceId) : "—"}</td>
    <td class="cell-commands">${escapeHtml(user.commandCount)}</td>
    <td class="cell-created">${new Date(user.createdAt).toLocaleDateString("ar-EG")}</td>
    <td class="cell-actions">${actionsHtml}</td>
  `;
}

// هل يطابق المستخدم فلتر البحث الحالي في لوحة الأدمن؟
function adminUserMatchesCurrentFilter(user) {
  const emailQuery = (document.getElementById("adminSearchEmail")?.value || "")
    .trim()
    .toLowerCase();
  const tiktokQuery = (
    document.getElementById("adminSearchTiktok")?.value || ""
  )
    .trim()
    .toLowerCase();
  const deviceQuery = (document.getElementById("adminSearchDevice")?.value || "")
    .trim()
    .toLowerCase();
  if (emailQuery && !(user.email || "").toLowerCase().includes(emailQuery))
    return false;
  if (
    tiktokQuery &&
    !(user.tiktokUsername || "").toLowerCase().includes(tiktokQuery)
  )
    return false;
  if (deviceQuery && !(user.deviceId || "").toLowerCase().includes(deviceQuery))
    return false;
  return true;
}

async function loadAdminDashboard() {
  const adminContainer = document.getElementById("adminDashboardContainer");
  if (!adminContainer) return;

  // سكيلتون لوحة الأدمن يظهر فور بدء التحميل ويُزال عند جهوز البيانات
  const removeAdminSkeleton =
    window.Skeleton && window.Skeleton.overlay
      ? window.Skeleton.overlay(adminContainer, {
          build: () => window.Skeleton.adminPage(),
        })
      : null;

  try {
    const [statsRes, usersRes] = await Promise.all([
      fetchWithAuth(`${__S.API_BASE}/api/admin/stats`),
      fetchWithAuth(`${__S.API_BASE}/api/admin/users`),
    ]);
    const stats = await statsRes.json();
    const usersData = await usersRes.json();
    if (!stats.success || !usersData.success)
      throw new Error("فشل تحميل البيانات");

    window.allAdminUsers = usersData.users;

    // ===== حقن ستايل لوحة التحكم الفخمة (مرة واحدة) =====
    if (!document.getElementById("luxAdminStyle")) {
      const style = document.createElement("style");
      style.id = "luxAdminStyle";
      style.textContent = `
        #adminDashboardContainer { direction: rtl; font-family: 'Segoe UI', Tahoma, sans-serif; }
        .lux-header { display:flex; align-items:center; gap:14px; margin-bottom:22px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
          border: 1px solid rgba(29,217,230,.25); border-radius: 18px; padding: 22px 26px;
          box-shadow: 0 10px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06); }
        .lux-header .lux-icon { font-size: 34px; filter: drop-shadow(0 0 10px rgba(29,217,230,.7)); }
        .lux-header h2 { margin:0; color:#eaf6ff; font-size:22px; font-weight:800; letter-spacing:.5px; }
        .lux-header .lux-sub { color:#8fa3bf; font-size:13px; margin-top:4px; }
        .lux-live-dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:#00e676;
          margin-inline-start:8px; box-shadow:0 0 8px #00e676; animation: luxPulse 1.6s infinite; }
        @keyframes luxPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        .lux-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px,1fr)); gap:16px; margin-top:6px; }
        .lux-card { position:relative; overflow:hidden; border-radius:16px; padding:20px 18px; color:#fff;
          background: linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.015));
          border:1px solid rgba(255,255,255,.09); backdrop-filter: blur(6px);
          transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
        .lux-card:hover { transform: translateY(-4px); border-color: rgba(29,217,230,.45);
          box-shadow: 0 14px 34px rgba(0,0,0,.5), 0 0 22px rgba(29,217,230,.14); }
        .lux-card .lux-v { font-size:30px; font-weight:800; line-height:1.1;
          background: linear-gradient(90deg,#fff,#bfe9ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
        .lux-card .lux-l { color:#9fb4cc; font-size:13px; margin-top:6px; }
        .lux-card .lux-ico { position:absolute; top:14px; left:16px; font-size:22px; opacity:.85; }
        .lux-card::after { content:""; position:absolute; inset-inline-start:-40%; top:-120%; width:60%; height:340%;
          background: radial-gradient(closest-side, rgba(29,217,230,.16), transparent); transform: rotate(18deg); }
        .lux-card.cyan::after { background: radial-gradient(closest-side, rgba(29,217,230,.22), transparent); }
        .lux-card.gold::after { background: radial-gradient(closest-side, rgba(255,193,7,.20), transparent); }
        .lux-card.green::after { background: radial-gradient(closest-side, rgba(0,230,118,.18), transparent); }
        .lux-card.red::after { background: radial-gradient(closest-side, rgba(255,83,112,.18), transparent); }
        .lux-card.purple::after { background: radial-gradient(closest-side, rgba(171,71,188,.20), transparent); }
        .lux-section { margin-top:26px; background: linear-gradient(160deg, #191927, #14141f);
          border:1px solid rgba(255,255,255,.07); border-radius:18px; padding:22px;
          box-shadow: 0 10px 34px rgba(0,0,0,.4); }
        .lux-section h3 { margin:0 0 6px; color:#eaf6ff; font-size:17px; font-weight:700; }
        .lux-section .lux-note { color:#8fa3bf; font-size:12.5px; margin:0 0 14px; }
        .dashboard-users-table-container { border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,.08); }
        .dashboard-users-table { width:100%; border-collapse:collapse; font-size:13px; }
        .dashboard-users-table thead tr { background:linear-gradient(90deg,#20263b,#1a1f30); }
        .dashboard-users-table th { padding:12px 10px; color:#9fd8e8; font-weight:700; white-space:nowrap; }
        .dashboard-users-table tbody tr { border-top:1px solid rgba(255,255,255,.05); transition:background .18s; }
        .dashboard-users-table tbody tr:hover { background:rgba(29,217,230,.05); }
        .dashboard-users-table td { padding:10px; }
        .lux-dev { font-family:monospace; font-size:11px; color:#7fd7e8; direction:ltr; word-break:break-all; cursor:pointer; }
        .lux-dev:hover { color:#bfe9ff; text-decoration:underline; }
      `;
      document.head.appendChild(style);
    }

    const card = (ico, val, label, cls = "", key = "") =>
      `<div class="lux-card ${cls}"><div class="lux-ico">${ico}</div><div class="lux-v" id="stat-${key}">${val}</div><div class="lux-l">${label}</div></div>`;

    const statsHtml = `
      <div class="lux-header">
        <div class="lux-icon"><i class="fas fa-crown"></i></div>
        <div>
          <h2>لوحة تحكم Stream Moon<span class="lux-live-dot"></span></h2>
          <div class="lux-sub">إدارة شاملة — تتحدث تلقائياً بدون إعادة تشغيل</div>
        </div>
      </div>
      <div class="lux-grid">
        ${card("<i class='fas fa-users'></i>", stats.stats.totalUsers, "إجمالي المستخدمين", "cyan", "totalUsers")}
        ${card("<i class='fas fa-gem'></i>", stats.stats.paidUsers, "مشتركين مدفوعين", "gold", "paidUsers")}
        ${card("<i class='fas fa-user'></i>", stats.stats.freeUsers, "مستخدمين مجانيين", "", "freeUsers")}
        ${card("<i class='fas fa-bolt'></i>", stats.stats.totalCommands, "إجمالي الأوامر", "purple", "totalCommands")}
        ${card("<i class='fas fa-circle' style='color:#f44336'></i>", stats.stats.activeLiveUsers, "بثوث حية الآن", "red", "activeLiveUsers")}
        ${card("<i class='fas fa-link'></i>", stats.stats.connectsToday, "كونكت اليوم", "green", "connectsToday")}
        ${card("<i class='fas fa-gift'></i>", stats.stats.giftsToday, "هدايا اليوم", "gold", "giftsToday")}
        ${card("<i class='fas fa-trophy'></i>", stats.stats.giftsThisMonth, "هدايا الشهر", "cyan", "giftsThisMonth")}
      </div>
    `;

    // ===== قسم إدارة الإشعارات =====
    const notificationsHtml = `
    <div class="lux-section">
      <h3><i class="fas fa-bell"></i> إدارة الإشعارات العاجلة</h3>

      <!-- نموذج الإضافة — الوقت وزر الإرسال تحت الـtextarea وليس على نفس الصف -->
      <div style="background: #2a2a2a; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <textarea id="adminNotificationText" placeholder="نص الإشعار..." style="width: 100%; height: 200px; resize: vertical; padding: 10px; background: #333; border: 1px solid #555; color: white; border-radius: 6px; font-family: inherit; line-height: 1.6; box-sizing: border-box;"></textarea>
        <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: center; margin-top: 12px;">
          <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#ccc;">
            ساعة
            <input type="number" id="adminNotificationHours" min="0" max="72" value="1" style="width:64px; padding:10px; background:#333; border:1px solid #555; color:white; border-radius:6px;">
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#ccc;">
            دقيقة
            <input type="number" id="adminNotificationMinutes" min="0" max="59" value="0" style="width:64px; padding:10px; background:#333; border:1px solid #555; color:white; border-radius:6px;">
          </label>
          <button id="adminSendNotificationBtn" class="btn btn-danger" style="background: #dc3545;">إرسال الإشعار</button>
        </div>
      </div>

      <!-- قائمة الإشعارات -->
      <div id="adminNotificationList" style="max-height: 300px; overflow-y: auto; margin-top: 10px;">
        <table style="width:100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background:#333;">
              <th style="padding:8px; text-align:right;">النص</th>
              <th style="padding:8px; text-align:center;">المدة</th>
              <th style="padding:8px; text-align:center;">الوحدة</th>
              <th style="padding:8px; text-align:center;">تنتهي في</th>
              <th style="padding:8px; text-align:center;">الحالة</th>
              <th style="padding:8px; text-align:center;">إجراءات</th>
            </tr>
          </thead>
          <tbody id="adminNotificationsTbody"></tbody>
        </table>
      </div>
      <div id="adminNotificationResult" style="margin-top: 10px; color: #aaa;"></div>
    </div>
    `;

    // ===== قسم التحكم بروابط التواصل (أيقونات أسفل يسار البرنامج) =====
    const contactLinksHtml = `
    <div class="lux-section">
      <h3><i class="fas fa-comments"></i> روابط التواصل — أسفل يسار البرنامج</h3>
      <p class="lux-note">أيقونات صغيرة غير مزعجة تظهر لكل المستخدمين. فعّل واحدة فقط، أو الاثنين معاً، أو أخفِهما تماماً — التغيير يصل للبرامج المفتوحة فوراً.</p>
      <div style="display:flex; gap:22px; flex-wrap:wrap; align-items:center; background:#2a2a2a; padding:14px 16px; border-radius:8px;">
        <label style="display:flex; gap:8px; align-items:center; cursor:pointer; font-size:14px;">
          <input type="checkbox" id="adminContactDiscord" style="width:18px; height:18px; cursor:pointer;">
          <i class="fa-brands fa-discord" style="color:#7289da; font-size:18px;"></i> ديسكورد
        </label>
        <label style="display:flex; gap:8px; align-items:center; font-size:14px;">
          معرف الديسكورد
          <input type="text" id="adminContactDiscordId" placeholder="مثال: 1162740483609608224" style="width:210px; padding:7px 10px; border:1px solid #444; border-radius:6px; background:#1e1e1e; color:#eee; outline:none; direction:ltr;">
        </label>
        <label style="display:flex; gap:8px; align-items:center; cursor:pointer; font-size:14px;">
          <input type="checkbox" id="adminContactTiktok" style="width:18px; height:18px; cursor:pointer;">
          <i class="fa-brands fa-tiktok" style="color:#fff; font-size:18px;"></i> تيك توك
        </label>
        <label style="display:flex; gap:8px; align-items:center; font-size:14px;">
          يوزر التيك توك
          <input type="text" id="adminContactTiktokUser" placeholder="مثال: @username" style="width:170px; padding:7px 10px; border:1px solid #444; border-radius:6px; background:#1e1e1e; color:#eee; outline:none; direction:ltr;">
        </label>
        <span id="adminContactResult" style="color:#aaa; font-size:13px;"></span>
      </div>
    </div>
    `;

    const searchHtml = `
      <div class="admin-search-bar" style="display:flex; gap:10px; align-items:center; margin:15px 0; flex-wrap:wrap; background:#1e1e1e; padding:12px; border-radius:8px; direction:rtl;">
        <input type="text" id="adminSearchEmail" placeholder="بحث بالبريد الإلكتروني..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid #333; border-radius:4px; background:#2a2a2a; color:white; outline:none;">
        <input type="text" id="adminSearchTiktok" placeholder="بحث بـ TikTok Username..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid #333; border-radius:4px; background:#2a2a2a; color:white; outline:none;">
        <input type="text" id="adminSearchDevice" placeholder="بحث ببصمة الجهاز..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid #333; border-radius:4px; background:#2a2a2a; color:white; outline:none; direction:ltr;">
        <button id="adminSearchClear" style="padding:8px 16px; background:#555; border:none; border-radius:4px; color:white; cursor:pointer;"><i class="fas fa-xmark"></i> مسح</button>
      </div>
    `;

    // ===== قسم الأجهزة المحظورة =====
    const blockedHtml = `
    <div class="lux-section" style="border-color: rgba(255,83,112,.25);">
      <h3><i class="fas fa-ban"></i> الأجهزة المحظورة</h3>
      <p class="lux-note">الجهاز المحظور لا يستطيع استخدام الموقع نهائياً — حتى بحساب جديد أو بعد تغيير الـ IP المعروف.</p>
      <div style="max-height: 250px; overflow-y: auto;">
        <table style="width:100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background:#333;">
              <th style="padding:8px; text-align:right;">البريد</th>
              <th style="padding:8px; text-align:right;">الشبكات (IP)</th>
              <th style="padding:8px; text-align:center;">تاريخ الحظر</th>
              <th style="padding:8px; text-align:center;">إجراءات</th>
            </tr>
          </thead>
          <tbody id="adminBlockedTbody"></tbody>
        </table>
      </div>
    </div>
    `;

    let usersHtml = `<div class="dashboard-users-table-container"><table class="dashboard-users-table"><thead><tr>
      <th>البريد الإلكتروني</th>
      <th>الخطة</th>
      <th>النوع</th>
      <th>تاريخ الانتهاء</th>
      <th>الدور</th>
      <th>TikTok</th>
      <th>الحالة</th>
      <th>كونكت اليوم</th>
      <th>هدايا اليوم</th>
      <th>هدايا الشهر</th>
      <th>بصمة الجهاز</th>
      <th>عدد الأوامر</th>
      <th>تاريخ التسجيل</th>
      <th>إجراءات</th>
    </tr></thead><tbody id="adminTableBody">`;
    usersHtml += `</tbody></table></div>`;

    adminContainer.innerHTML =
      statsHtml + notificationsHtml + contactLinksHtml + searchHtml + blockedHtml + usersHtml;

    // ===== تحميل قائمة الأجهزة المحظورة =====
    try {
      const blockedRes = await fetchWithAuth(
        `${__S.API_BASE}/api/admin/blocked-devices`,
      );
      const blockedData = await blockedRes.json();
      const blockedTbody = document.getElementById("adminBlockedTbody");
      if (blockedData.success && blockedTbody) {
        if (blockedData.devices.length === 0) {
          blockedTbody.innerHTML = `<tr><td colspan="4" style="padding:12px; color:#777; text-align:center;">لا توجد أجهزة محظورة</td></tr>`;
        } else {
          blockedData.devices.forEach((device) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td style="padding:8px;">${escapeHtml(device.email || "—")}</td>
              <td style="padding:8px; direction:ltr; text-align:right;">${(device.ips || []).map(escapeHtml).join("<br>") || "—"}</td>
              <td style="padding:8px; text-align:center;">${new Date(device.createdAt).toLocaleDateString("ar-EG")}</td>
              <td style="padding:8px; text-align:center;"><button class="admin-unblock-device" data-id="${escapeHtml(device._id)}" style="padding:6px 14px; background:#4caf50; border:none; border-radius:4px; color:white; cursor:pointer;"><i class="fas fa-circle-check"></i> فك الحظر</button></td>
            `;
            blockedTbody.appendChild(tr);
          });
        }
      }
    } catch (err) {
      console.warn("فشل تحميل الأجهزة المحظورة:", err);
    }

    // ===== ربط زر إرسال الإشعار =====
    document
      .getElementById("adminSendNotificationBtn")
      ?.addEventListener("click", async function () {
        const text = document
          .getElementById("adminNotificationText")
          .value.trim();
        const combined = notifCombinedDuration(
          document.getElementById("adminNotificationHours")?.value,
          document.getElementById("adminNotificationMinutes")?.value,
        );
        if (!text) {
          document.getElementById("adminNotificationResult").innerHTML =
            "<i class='fas fa-triangle-exclamation'></i> أدخل نص الإشعار";
          return;
        }
        if (!combined) {
          document.getElementById("adminNotificationResult").innerHTML =
            "<i class='fas fa-triangle-exclamation'></i> أدخل مدة صحيحة (ساعة أو دقيقة على الأقل)";
          return;
        }
        const duration = combined.durationValue;
        const unit = combined.durationUnit;
        try {
          const res = await fetchWithAuth(
            `${__S.API_BASE}/api/admin/notification`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                durationValue: duration,
                durationUnit: unit,
              }),
            },
          );
          const data = await res.json();
          if (data.success) {
            document.getElementById("adminNotificationResult").innerHTML =
              "<i class='fas fa-circle-check'></i> تم إرسال الإشعار بنجاح";
            document.getElementById("adminNotificationText").value = "";
            loadAdminNotifications();
            // عرضه فوراً في شريط الإشعارات هنا كذلك
            if (data.notification) showNotification(data.notification);
          } else {
            document.getElementById("adminNotificationResult").innerHTML =
              "<i class='fas fa-circle-xmark'></i> فشل الإرسال: " +
              (escapeHtml(data.message || ""));
          }
        } catch (err) {
          document.getElementById("adminNotificationResult").innerHTML =
            "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال";
        }
      });

    function renderFilteredUsers(filteredUsers) {
      const tbody = document.getElementById("adminTableBody");
      if (!tbody) return;
      tbody.innerHTML = "";
      if (!filteredUsers || filteredUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#888;"><i class="fas fa-circle-xmark"></i> لا توجد نتائج مطابقة</td></tr>`;
        return;
      }
      const now = new Date();
      filteredUsers.forEach((user) => {
        const tr = document.createElement("tr");
        tr.dataset.uid = user.id;
        tr.innerHTML = buildAdminUserRowHtml(user, now);
        tbody.appendChild(tr);
      });
      attachAdminButtonEvents();
    }

    function filterUsers() {
      const emailInput = document.getElementById("adminSearchEmail");
      const tiktokInput = document.getElementById("adminSearchTiktok");
      const deviceInput = document.getElementById("adminSearchDevice");
      const emailQuery = emailInput
        ? emailInput.value.trim().toLowerCase()
        : "";
      const tiktokQuery = tiktokInput
        ? tiktokInput.value.trim().toLowerCase()
        : "";
      const deviceQuery = deviceInput
        ? deviceInput.value.trim().toLowerCase()
        : "";
      if (!window.allAdminUsers) return;
      let filtered = window.allAdminUsers;
      if (emailQuery)
        filtered = filtered.filter((user) =>
          user.email.toLowerCase().includes(emailQuery),
        );
      if (tiktokQuery)
        filtered = filtered.filter((user) =>
          (user.tiktokUsername || "").toLowerCase().includes(tiktokQuery),
        );
      if (deviceQuery)
        filtered = filtered.filter((user) =>
          (user.deviceId || "").toLowerCase().includes(deviceQuery),
        );
      renderFilteredUsers(filtered);
    }

    renderFilteredUsers(window.allAdminUsers);

    document
      .querySelectorAll(
        "#adminSearchEmail, #adminSearchTiktok, #adminSearchDevice",
      )
      .forEach((input) => {
        input.addEventListener("input", () => {
          clearTimeout(__S.searchTimeout);
          __S.searchTimeout = setTimeout(filterUsers, 300);
        });
      });

    document
      .getElementById("adminSearchClear")
      ?.addEventListener("click", () => {
        document.getElementById("adminSearchEmail").value = "";
        document.getElementById("adminSearchTiktok").value = "";
        const devInput = document.getElementById("adminSearchDevice");
        if (devInput) devInput.value = "";
        filterUsers();
      });
    loadAdminNotifications();
    attachAdminButtonEvents();

    // ===== تحميل وحفظ إعدادات روابط التواصل =====
    // ✅ الحفظ يتم في السيرفر مباشرة وبشكل تلقائي: Enter، الخروج من الحقل،
    // أو التوقف عن الكتابة — واختيار ظهور أي أيقونة يحفظ فوراً (لا يوجد زر حفظ)
    let contactLinksLastSaved = null;
    let contactLinksSaveTimer = null;
    let contactLinksSaving = false;
    const showContactResult = (html) => {
      const result = document.getElementById("adminContactResult");
      if (result) result.innerHTML = html;
    };
    const collectContactLinksPayload = () => ({
      discord: !!document.getElementById("adminContactDiscord")?.checked,
      tiktok: !!document.getElementById("adminContactTiktok")?.checked,
      discordId:
        document.getElementById("adminContactDiscordId")?.value.trim() || "",
      tiktokUser:
        document.getElementById("adminContactTiktokUser")?.value.trim() || "",
    });
    const saveContactLinks = async function () {
      const payload = collectContactLinksPayload();
      const sig = JSON.stringify(payload);
      // لا حفظ مكرر إن لم يتغير شيء
      if (sig === contactLinksLastSaved || contactLinksSaving) return;
      contactLinksSaving = true;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/contact-links`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const data = await res.json();
        if (data.success) {
          contactLinksLastSaved = sig;
          showContactResult(
            "<i class='fas fa-circle-check' style='color:#4caf50'></i> تم الحفظ وتطبيقه فوراً",
          );
          applyContactLinksVisibility(data.links);
          setTimeout(() => {
            const r = document.getElementById("adminContactResult");
            if (r && r.innerHTML.includes("تم الحفظ")) r.innerHTML = "";
          }, 2500);
        } else {
          showContactResult(
            "<i class='fas fa-circle-xmark' style='color:#f44336'></i> " +
              (escapeHtml(data.message || "فشل الحفظ")),
          );
        }
      } catch (err) {
        showContactResult(
          "<i class='fas fa-circle-xmark' style='color:#f44336'></i> خطأ في الاتصال",
        );
      } finally {
        contactLinksSaving = false;
        // ✅ لو تعديل جديد دخل أثناء الحفظ كان يُسقط بصمت — أعد الجدولة
        if (
          JSON.stringify(collectContactLinksPayload()) !== contactLinksLastSaved
        ) {
          scheduleContactLinksSave();
        }
      }
    };
    const scheduleContactLinksSave = () => {
      clearTimeout(contactLinksSaveTimer);
      contactLinksSaveTimer = setTimeout(saveContactLinks, 800);
    };
    try {
      const clRes = await fetchWithAuth(`${__S.API_BASE}/api/admin/contact-links`);
      const clData = await clRes.json();
      if (clData.success) {
        const dcb = document.getElementById("adminContactDiscord");
        const tcb = document.getElementById("adminContactTiktok");
        const did = document.getElementById("adminContactDiscordId");
        const tuser = document.getElementById("adminContactTiktokUser");
        if (dcb) dcb.checked = !!clData.links.discord;
        if (tcb) tcb.checked = !!clData.links.tiktok;
        if (did) did.value = clData.links.discordId || "";
        if (tuser) tuser.value = clData.links.tiktokUser || "";
        contactLinksLastSaved = JSON.stringify(collectContactLinksPayload());
      }
    } catch (err) {
      console.warn("فشل تحميل روابط التواصل:", err);
    }
    // أيقونات الظهور — حفظ فوري عند التغيير
    ["adminContactDiscord", "adminContactTiktok"].forEach((id) => {
      document
        .getElementById(id)
        ?.addEventListener("change", saveContactLinks);
    });
    // حقول النص — حفظ عند Enter أو الخروج من الحقل أو التوقف عن الكتابة
    ["adminContactDiscordId", "adminContactTiktokUser"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(contactLinksSaveTimer);
          saveContactLinks();
        }
      });
      input.addEventListener("blur", () => {
        clearTimeout(contactLinksSaveTimer);
        saveContactLinks();
      });
      input.addEventListener("input", scheduleContactLinksSave);
    });

    if (window.AppI18n) AppI18n.applyDOM();
  } catch (err) {
    adminContainer.innerHTML = `<div class="error-message"><i class="fas fa-circle-xmark"></i> فشل تحميل لوحة التحكم: ${escapeHtml(err.message)}</div>`;
  } finally {
    if (removeAdminSkeleton) removeAdminSkeleton();
  }
}

// تحميل قائمة الإشعارات (للوحة الأدمن)
async function loadAdminNotifications() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/admin/notifications`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    window.adminNotificationsCache = data.notifications;
    const tbody = document.getElementById("adminNotificationsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (data.notifications.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888;">لا توجد إشعارات</td></tr>`;
      return;
    }
    data.notifications.forEach((n) => {
      const tr = document.createElement("tr");
      tr.dataset.id = n._id;
      const now = new Date();
      const isExpired = new Date(n.expiresAt) < now;
      const isActive = n.isActive && !isExpired;
      tr.innerHTML = `
        <td style="padding:8px; text-align:right; white-space:pre-line;">${escapeHtml(n.text)}</td>
        <td style="text-align:center;">${n.durationValue || "?"}</td>
        <td style="text-align:center;">${n.durationUnit === "hour" ? "ساعة" : n.durationUnit === "minute" ? "دقيقة" : "ثانية"}</td>
        <td style="text-align:center;">${new Date(n.expiresAt).toLocaleString("ar-EG")}</td>
        <td style="text-align:center;">${isActive ? "<i class='fas fa-circle' style='color:#4caf50'></i> نشط" : "<i class='fas fa-circle' style='color:#f44336'></i> منتهي/غير نشط"}</td>
        <td style="text-align:center; min-width: 140px;">
          <div class="row-actions" style="display: flex; align-items: center; justify-content: center; width: 100%;">
            <button class="row-act admin-edit-notification" data-id="${n._id}" title="تعديل"><i class="fas fa-pen-to-square"></i></button>
            <button class="row-act del admin-delete-notification" data-id="${n._id}" title="حذف"><i class="fas fa-trash-can"></i></button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    attachNotificationAdminEvents();
  } catch (err) {
    console.error("فشل تحميل الإشعارات:", err);
  }
}


// ===== مدة الإشعار: اختيار الساعة والدقيقة معاً ثم التحويل لوحدة واحدة للسيرفر =====
// تحويل قيمة محفوظة (durationValue + durationUnit) إلى حقلين ساعة/دقيقة
function notifDurationParts(durationValue, durationUnit) {
  const v = Math.max(0, parseInt(durationValue, 10) || 0);
  if (durationUnit === "hour") return { hours: v, minutes: 0 };
  if (durationUnit === "minute") return { hours: 0, minutes: v };
  return { hours: 0, minutes: Math.max(1, Math.ceil(v / 60)) }; // ثوانٍ → دقائق
}
// دمج الساعة والدقيقة في قيمة واحدة: كلاهما > 0 → دقائق إجمالية
function notifCombinedDuration(hours, minutes) {
  const h = Math.max(0, parseInt(hours, 10) || 0);
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  if (h > 0 && m > 0) return { durationValue: h * 60 + m, durationUnit: "minute" };
  if (h > 0) return { durationValue: h, durationUnit: "hour" };
  if (m > 0) return { durationValue: m, durationUnit: "minute" };
  return null;
}

// ربط أحداث التعديل والحذف
function attachNotificationAdminEvents() {
  document.querySelectorAll(".admin-edit-notification").forEach((btn) => {
    btn.removeEventListener("click", handleEditNotification);
    btn.addEventListener("click", handleEditNotification);
  });
  document.querySelectorAll(".admin-delete-notification").forEach((btn) => {
    btn.removeEventListener("click", handleDeleteNotification);
    btn.addEventListener("click", handleDeleteNotification);
  });
}

// مودال تعديل الإشعار (prompt معطل في Electron)
function showNotificationEditModal(current) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:99999; display:flex; align-items:center; justify-content:center;";
    const box = document.createElement("div");
    box.dir = "rtl";
    box.style.cssText =
      "background:#1e1e2e; border:1px solid rgba(29,217,230,.3); border-radius:14px; padding:24px; width:min(420px, 90vw); color:#fff; font-family:inherit; box-shadow:0 20px 60px rgba(0,0,0,.6);";
    box.innerHTML = `
      <h3 style="margin:0 0 16px; color:#9fd8e8;"><i class="fas fa-pen-to-square"></i> تعديل الإشعار</h3>
      <label style="display:block; font-size:13px; color:#9fb4cc; margin-bottom:6px;">النص</label>
      <textarea id="notifEditText" style="width:100%; box-sizing:border-box; height:200px; resize:vertical; padding:10px; background:#15151f; border:1px solid #333; color:#fff; border-radius:8px; margin-bottom:14px; font-family:inherit; line-height:1.6;">${escapeHtml(current.text || "")}</textarea>
      <div style="display:flex; gap:10px; margin-bottom:14px;">
        <div style="flex:1;">
          <label style="display:block; font-size:13px; color:#9fb4cc; margin-bottom:6px;">ساعة</label>
          <input id="notifEditHours" type="number" min="0" max="72" value="${notifDurationParts(current.durationValue, current.durationUnit).hours}" style="width:100%; box-sizing:border-box; padding:10px; background:#15151f; border:1px solid #333; color:#fff; border-radius:8px;">
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:13px; color:#9fb4cc; margin-bottom:6px;">دقيقة</label>
          <input id="notifEditMinutes" type="number" min="0" max="59" value="${notifDurationParts(current.durationValue, current.durationUnit).minutes}" style="width:100%; box-sizing:border-box; padding:10px; background:#15151f; border:1px solid #333; color:#fff; border-radius:8px;">
        </div>
      </div>
      <div style="display:flex; gap:10px; justify-content:flex-start;">
        <button id="notifEditSave" style="padding:10px 26px; background:linear-gradient(90deg,#1dd9e6,#0f9bb0); border:none; border-radius:8px; color:#00232a; font-weight:700; cursor:pointer;">حفظ</button>
        <button id="notifEditCancel" style="padding:10px 26px; background:#333; border:none; border-radius:8px; color:#ccc; cursor:pointer;">إلغاء</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    box.querySelector("#notifEditCancel").onclick = () => close(null);
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
    box.querySelector("#notifEditSave").onclick = () => {
      const text = box.querySelector("#notifEditText").value.trim();
      if (!text) {
        showMessage("<i class='fas fa-triangle-exclamation'></i> النص مطلوب");
        return;
      }
      const combined = notifCombinedDuration(
        box.querySelector("#notifEditHours")?.value,
        box.querySelector("#notifEditMinutes")?.value,
      );
      if (!combined) {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> أدخل مدة صحيحة (ساعة أو دقيقة على الأقل)",
        );
        return;
      }
      close({ text, ...combined, isActive: true });
    };
  });
}

// معالج تعديل الإشعار
async function handleEditNotification(e) {
  const id = e.currentTarget.dataset.id;
  const tbody = document.getElementById("adminNotificationsTbody");
  const tr = tbody?.querySelector(`tr[data-id="${id}"]`);
  // نجلب الإشعار الحالي من قائمة الإشعارات المحملة آخر مرة
  const current = (window.adminNotificationsCache || []).find(
    (n) => n._id === id,
  );
  if (!current) {
    showMessage(
      "<i class='fas fa-circle-xmark'></i> تعذر العثور على الإشعار — أعد تحميل اللوحة",
    );
    return;
  }
  const result = await showNotificationEditModal(current);
  if (!result) return;
  try {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/admin/notification/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      },
    );
    const data = await res.json();
    if (data.success) {
      showMessage("<i class='fas fa-circle-check'></i> تم تعديل الإشعار");
      loadAdminNotifications();
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل التعديل: " + data.message,
      );
    }
  } catch (err) {
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
  }
}

// معالج حذف الإشعار
async function handleDeleteNotification(e) {
  const id = e.currentTarget.dataset.id;
  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا الإشعار نهائياً؟",
    "تأكيد الحذف",
  );
  if (!confirmed) return;
  try {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/admin/notification/${id}`,
      {
        method: "DELETE",
      },
    );
    const data = await res.json();
    if (data.success) {
      showMessage("<i class='fas fa-circle-check'></i> تم حذف الإشعار");
      loadAdminNotifications();
    } else {
      showMessage(
        "<i class='fas fa-circle-xmark'></i> فشل الحذف: " + data.message,
      );
    }
  } catch (err) {
    showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
  }
}

function attachAdminButtonEvents() {
  const container = document.getElementById("adminDashboardContainer");
  if (!container) return;

  if (container._adminClickHandler) {
    container.removeEventListener("click", container._adminClickHandler);
  }

  const handler = async function (event) {
    const target = event.target.closest("button");
    if (!target) return;

    if (
      target.classList.contains("admin-renew-monthly") ||
      target.classList.contains("admin-renew-yearly")
    ) {
      const id = target.dataset.id;
      const plan =
        target.dataset.plan ||
        (target.classList.contains("admin-renew-monthly")
          ? "monthly"
          : "yearly");
      const planName = plan === "monthly" ? "شهري" : "سنوي";
      const confirmed = await showConfirm(
        `تجديد الاشتراك (${planName}) للمستخدم؟`,
        "تأكيد التجديد",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/user/${id}/renew`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planType: plan }),
          },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> تم التجديد بنجاح"
            : "<i class='fas fa-circle-xmark'></i> فشل التجديد",
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-block-device")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "سيتم حظر جهاز هذا المستخدم بالكامل (شبكته وبصمة جهازه) — لن يستطيع دخول الموقع نهائياً حتى بحساب جديد. هل تريد المتابعة؟",
        "تأكيد حظر الجهاز",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/user/${id}/block-device`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> " +
                (escapeHtml(data.message || "تم حظر الجهاز"))
            : "<i class='fas fa-circle-xmark'></i> " +
                (escapeHtml(data.message || "فشل حظر الجهاز")) +
                (data.error
                  ? ` <small style='opacity:0.7;'>(${data.error})</small>`
                  : ""),
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-unblock-device")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "سيتم فك الحظر عن هذا الجهاز وسيتمكن من دخول الموقع مرة أخرى. هل تريد المتابعة؟",
        "تأكيد فك الحظر",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/blocked-device/${id}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> " +
                (escapeHtml(data.message || "تم فك الحظر"))
            : "<i class='fas fa-circle-xmark'></i> " +
                (escapeHtml(data.message || "فشل فك الحظر")),
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-downgrade")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "إزالة الترقية وجعل المستخدم مجانياً؟",
        "تأكيد إلغاء الاشتراك",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/user/${id}/downgrade`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> تمت إزالة الترقية"
            : "<i class='fas fa-circle-xmark'></i> فشلت العملية",
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-make-admin")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "ترقية المستخدم إلى مدير؟",
        "تأكيد الترقية",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/user/${id}/make-admin`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> تمت الترقية"
            : "<i class='fas fa-circle-xmark'></i> فشلت الترقية",
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-remove-admin")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "هل أنت متأكد من إزالة صلاحية المدير عن هذا المستخدم؟",
        "تأكيد إزالة المدير",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(
          `${__S.API_BASE}/api/admin/user/${id}/remove-admin`,
          { method: "POST" },
        );
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> تمت إزالة صلاحية المدير"
            : "<i class='fas fa-circle-xmark'></i> فشلت العملية: " +
                (escapeHtml(data.message || "")),
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }

    if (target.classList.contains("admin-delete-user")) {
      const id = target.dataset.id;
      const confirmed = await showConfirm(
        "حذف المستخدم وجميع أوامره؟ هذا الإجراء لا يمكن التراجع عنه.",
        "تأكيد الحذف",
      );
      if (!confirmed) return;
      try {
        const res = await fetchWithAuth(`${__S.API_BASE}/api/admin/user/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        showMessage(
          data.success
            ? "<i class='fas fa-circle-check'></i> تم الحذف"
            : "<i class='fas fa-circle-xmark'></i> فشل الحذف",
        );
        if (data.success) setTimeout(() => window.refreshAdminDataInPlace?.(), 500);
      } catch (err) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاتصال");
      }
      return;
    }
  };

  container.addEventListener("click", handler);
  container._adminClickHandler = handler;
}

// ============================================================
// نافذة لوحة تحكم الأوفرلاي العائمة — تُفتح من زر "لوحة التحكم"
// وتُغلق بالضغط خارجها. Save يجبر الحفظ وCancel يرجع الإعدادات من الخادم.
// ============================================================
 // موضع اللوحة الأصلي في الصفحة


window.updateOverlayPreviews = function () {
  // القسم الموحد — المعاينات كلها iframes لصفحات الأوفرلايز الحقيقية،
  // فلا حاجة لاستنساخ المعاينات داخل الـDOM (دوال القوائم القديمة أُزيلت).
};
// (لا حلقة تحديث كل ثانية — المعاينات iframes حية من السيرفر)

function openOverlayPanel(panelId, kind, title) {
  const panel = document.getElementById(panelId);
  const modal = document.getElementById("overlayFloatModal");
  if (!panel || !modal) return;
  __S.overlayFloatHome = panel.parentNode;
  __S.overlayFloatKind = kind;
  document.getElementById("overlayFloatTitle").textContent =
    (window.AppI18n ? AppI18n.t(title) : title) || "";
  const body = document.getElementById("overlayFloatBody");
  body.innerHTML = "";
  body.appendChild(panel); // نقل اللوحة القائمة بكل ارتباطاتها
  modal.style.display = "block";
}

function closeOverlayPanel() {
  const modal = document.getElementById("overlayFloatModal");
  if (!modal || modal.style.display === "none") return;
  const body = document.getElementById("overlayFloatBody");
  const panel = body.firstElementChild;
  // الحفظ تلقائي مع كل تعديل — الإغلاق لا يلمس الإعدادات
  if (panel && __S.overlayFloatHome) __S.overlayFloatHome.appendChild(panel);
  __S.overlayFloatHome = null;
  __S.overlayFloatKind = null;
  modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("overlayFloatModal");
  if (!modal) return;
  // الضغط خارج الكارت = إغلاق (إرجاع بدون تغيير — الحفظ تلقائي داخلياً)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeOverlayPanel();
  });
  document
    .getElementById("overlayFloatX")
    ?.addEventListener("click", () => closeOverlayPanel());
});


export { buildAdminUserActionsHtml, buildAdminUserRowHtml, adminUserMatchesCurrentFilter, loadAdminDashboard, loadAdminNotifications, attachNotificationAdminEvents, showNotificationEditModal, handleEditNotification, handleDeleteNotification, attachAdminButtonEvents, openOverlayPanel, closeOverlayPanel };
