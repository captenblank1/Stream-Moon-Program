// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { escapeHtml } from "./utils-core.js";
import { showMessage } from "./utils-core.js";

// ============================================================
// لوحة قوائم الأوفرلاى الأصلية (بدون حقن صفحات خارجية)
// ============================================================


async function initListsPanel() {
  if (__S.listsPanelInitDone) {
    // تحديث البيانات والروابط عند كل فتح للسيكشن
    if (typeof listsRefreshData === "function") listsRefreshData();
    return;
  }
  __S.listsPanelInitDone = true;

  let screenToken = null;
  let widgetCid = null;
  async function getToken() {
    if (screenToken) return screenToken;
    const res = await fetchWithAuth(`${__S.API_BASE}/api/user/screen-token`);
    const data = await res.json();
    if (data.success) {
      screenToken = data.token;
      widgetCid = data.widgetId || null;
    }
    return screenToken;
  }
  // رابط قصير للأوفرلاي عبر الدومين الرئيسي مع الرجوع للطويل عند غياب cid
  function overlayLink(token, id) {
    return `${__S.WIDGET_BASE}/widget/overlay?cid=${encodeURIComponent(widgetCid || "")}&id=${id}`;
  }
  async function getSettings(token) {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/overlay-settings?token=${encodeURIComponent(token)}`,
    );
    return res.json();
  }
  async function postSettings(token, payload) {
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/overlay-settings?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return res.json();
  }

  class ListController {
    constructor(id) {
      this.id = id;
      this.crowned = new Set();
      this.titleEl = document.getElementById(`smlTitle${id}`);
      this.namesEl = document.getElementById(`smlNames${id}`);
      this.themeEl = document.getElementById(`smlTheme${id}`);
      this.glowEl = document.getElementById(`smlGlow${id}`);
      this.badgeEl = document.getElementById(`smlBadge${id}`);
      this.crownList = document.getElementById(`smlCrowns${id}`);
      this.widthEl = document.getElementById(`smlWidth${id}`);
      this.heightEl = document.getElementById(`smlHeight${id}`);
      this.statusEl = document.getElementById(`smlStatus${id}`);
      this.saveTimer = null;
      this.bind();
      this.load();
    }
    async load() {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await getSettings(token);
        if (!data.success) return;
        const o =
          this.id === 1 ? data.settings.overlay1 : data.settings.overlay2;
        this.titleEl.value = o.title || "";
        this.namesEl.value = o.names || "";
        this.themeEl.value =
          o.theme || (this.id === 1 ? "theme-neon" : "theme-gold");
        this.glowEl.value =
          o.glowColor || (this.id === 1 ? "#00ffe1" : "#ffcc00");
        this.badgeEl.value =
          o.badgeColor || (this.id === 1 ? "#ff0055" : "#a855f7");
        this.widthEl.value = o.width || 285;
        this.heightEl.value = o.maxHeight || 500;
        this.crowned = new Set(o.crowns || []);
        this.renderCrowns();
      } catch (e) {
        console.error("فشل تحميل إعدادات القائمة:", e);
      }
    }
    save() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(async () => {
        try {
          const token = await getToken();
          if (!token) return;
          const payload = {};
          payload[this.id === 1 ? "overlay1" : "overlay2"] = {
            title: this.titleEl.value,
            names: this.namesEl.value,
            theme: this.themeEl.value,
            glowColor: this.glowEl.value,
            badgeColor: this.badgeEl.value,
            crowns: Array.from(this.crowned),
            width: parseInt(this.widthEl.value) || 285,
            maxHeight: parseInt(this.heightEl.value) || 500,
          };
          await postSettings(token, payload);
          this.statusEl.innerHTML = "<i class='fas fa-check'></i> تم الحفظ";
          setTimeout(() => (this.statusEl.textContent = ""), 1500);
        } catch (e) {
          this.statusEl.innerHTML =
            "<i class='fas fa-triangle-exclamation'></i> فشل الحفظ";
        }
      }, 400);
    }
    renderCrowns() {
      const names = this.namesEl.value
        .split("\n")
        .filter((s) => s.trim() !== "");
      this.crownList.innerHTML = "";
      if (names.length === 0) {
        this.crownList.innerHTML =
          '<span style="color:#666;font-size:0.75rem">لا توجد أسماء — أضف أسماء في الحقل أعلاه</span>';
        return;
      }
      names.forEach((name, idx) => {
        const btn = document.createElement("button");
        const isCrowned = this.crowned.has(idx);
        btn.className = "sml-crown-btn" + (isCrowned ? " active" : "");
        btn.innerHTML =
          (isCrowned
            ? '<i class="fas fa-crown"></i> '
            : '<i class="fas fa-circle" style="color:#888"></i> ') +
          escapeHtml(name.trim());
        btn.onclick = () => {
          if (this.crowned.has(idx)) this.crowned.delete(idx);
          else this.crowned.add(idx);
          this.renderCrowns();
          this.save();
        };
        this.crownList.appendChild(btn);
      });
    }
    bind() {
      [this.titleEl, this.themeEl, this.glowEl, this.badgeEl].forEach((el) => {
        el.addEventListener("input", () => this.save());
        el.addEventListener("change", () => this.save());
      });
      this.widthEl.addEventListener("input", () => this.save());
      this.heightEl.addEventListener("input", () => this.save());
      this.namesEl.addEventListener("input", () => {
        this.renderCrowns();
        this.save();
      });
    }
  }

  const ctrls = [new ListController(1), new ListController(2)];
  window._smlCtrls = ctrls;

  // دالة تحديث الروابط والإعدادات — تُستدعى عند كل فتح للسيكشن وعند إعادة المحاولة
  window.listsRefreshData = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      document.getElementById("smlLink1").textContent = overlayLink(token, 1);
      document.getElementById("smlLink2").textContent = overlayLink(token, 2);
      if (window.updateOverlayPreviews) window.updateOverlayPreviews();
      const data = await getSettings(token);
      if (data.success) ctrls.forEach((c) => c.load());
    } catch (e) {}
  };
  window.listsRefreshData();
  // إعادة محاولة تلقائية إذا فشل جلب التوكن في المرة الأولى
  clearTimeout(__S.listsRetryTimer);
  __S.listsRetryTimer = setTimeout(() => {
    const l1 = document.getElementById("smlLink1");
    if (l1 && !l1.textContent.startsWith("http")) window.listsRefreshData();
  }, 5000);

  // روابط OBS + أزرار النسخ والمسح
  try {
    const token = await getToken();
    if (token) {
      document.getElementById("smlLink1").textContent = overlayLink(token, 1);
      document.getElementById("smlLink2").textContent = overlayLink(token, 2);
    }
  } catch (e) {}
  document.querySelectorAll(".sml-copy").forEach((btn) => {
    btn.onclick = () => {
      const link = document.getElementById("smlLink" + btn.dataset.overlay);
      if (!link.textContent.startsWith("http")) {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> الرابط لم يجهز بعد — جاري الاتصال، جرّب بعد لحظات",
        );
        return;
      }
      navigator.clipboard.writeText(link.textContent);
      showMessage("<i class='fas fa-circle-check'></i> تم نسخ رابط OBS");
    };
  });
  // استعادة كل الإعدادات الافتراضية للقائمة
  document.querySelectorAll(".sml-restore").forEach((btn) => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.overlay);
      const ctrl = ctrls[id - 1];
      try {
        const token = await getToken();
        if (!token) return;
        const defaults = {
          title: id === 1 ? "قائمة الأساطير" : "كبار الداعمين",
          names: "",
          theme: id === 1 ? "theme-neon" : "theme-gold",
          glowColor: id === 1 ? "#00ffe1" : "#ffcc00",
          badgeColor: id === 1 ? "#ff0055" : "#a855f7",
          crowns: [],
          width: 285,
          maxHeight: 500,
        };
        const payload = {};
        payload[id === 1 ? "overlay1" : "overlay2"] = defaults;
        const result = await postSettings(token, payload);
        if (result.success) {
          showMessage(
            "<i class='fas fa-circle-check'></i> تمت استعادة الإعدادات الافتراضية",
          );
          ctrl.load();
        }
      } catch (e) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في الاستعادة");
      }
    };
  });
  document.querySelectorAll(".sml-reset").forEach((btn) => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.overlay);
      const ctrl = ctrls[id - 1];
      try {
        const token = await getToken();
        if (!token) return;
        const payload = {};
        payload[id === 1 ? "overlay1" : "overlay2"] = {
          title: ctrl.titleEl.value,
          names: "",
          theme: ctrl.themeEl.value,
          glowColor: ctrl.glowEl.value,
          badgeColor: ctrl.badgeEl.value,
          crowns: [],
          width: parseInt(ctrl.widthEl.value) || 285,
          maxHeight: parseInt(ctrl.heightEl.value) || 500,
        };
        const result = await postSettings(token, payload);
        if (result.success) {
          showMessage("<i class='fas fa-circle-check'></i> تم مسح الأسماء");
          ctrl.load();
        }
      } catch (e) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في المسح");
      }
    };
  });
}


export { initListsPanel };
