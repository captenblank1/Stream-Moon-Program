// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { escapeHtml } from "./utils-core.js";
import { showMessage } from "./utils-core.js";
import { initWinsPanel } from "./wins.js";
import { overlayLinkFor, getScreenTokenCached } from "./overlay-links.js";
import { openOverlayPanel } from "./admin.js";

// ============================================================
// قسم الأوفرلايز الموحد — كل الأوفرلايز كروت متطابقة التصميم
// (OverlaysSection) في مكان واحد بدون تابات ولا تصنيفات:
// مشاهدين/آخر هدية/توب جيفت/توب 3/جرة العملات/متابعين/عداد الفوز/القائمتان
// كل معاينة = iframe لصفحة الأوفرلاي الحقيقية بنفس الحجم والشكل
// ============================================================

function bindOverlayCardsOnce() {
  if (__S.overlayCardsBound) return;
  __S.overlayCardsBound = true;

  // زر التفعيل/الإخفاء — يطابق سلوك OverlayPreview في OverlaysSection
  document.querySelectorAll("#startSection5 .opc-power").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".opc");
      if (!card) return;
      const off = !card.classList.contains("is-off");
      card.classList.toggle("is-off", off);
      const offEl = card.querySelector(".opc-off");
      if (offEl) offEl.hidden = !off;
      btn.classList.toggle("on", !off);
      btn.classList.toggle("off", off);
      const label = btn.querySelector("span");
      if (label) label.textContent = off ? "مُعطّل" : "مُفعّل";
    });
  });

  // زر الإعدادات — يفتح لوحة التحكم في نافذة عائمة في نص الشاشة
  // (تُنقل عناصرها للمودال ثم تُعاد للكارت عند الإغلاق — الارتباطات محفوظة)
  document.querySelectorAll("#startSection5 .opc-gear").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const card = btn.closest(".opc");
      const title =
        card && card.querySelector(".opc-head-names h3")
          ? card.querySelector(".opc-head-names h3").textContent
          : "";
      // لوحات إعدادات أوفرلايز اللايف — تُبنى ديناميكياً قبل الفتح
      if (btn.dataset.target.startsWith("ovl-pref-")) {
        await loadLivePrefs(true);
        buildPrefPanel(btn.dataset.target.replace("ovl-pref-", ""), target);
      }
      openOverlayPanel(btn.dataset.target, "settings", title);
    });
  });

  // نسخ الرابط — مع مؤشر "تم النسخ!" مثل المرجع
  document.querySelectorAll("#startSection5 .opc-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".opc");
      const frame = card && card.querySelector(".opc-frame");
      const kind = frame && frame.dataset.kind;
      if (!kind) return;
      const url = overlayLinkFor(kind);
      if (!url.includes("cid=") || url.endsWith("cid=")) {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> الرابط لم يجهز بعد — جاري الاتصال، جرّب بعد لحظات",
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        const label = btn.querySelector("span");
        const icon = btn.querySelector("i");
        btn.classList.add("copied");
        if (label) label.textContent = "تم النسخ!";
        if (icon) icon.className = "fas fa-check";
        setTimeout(() => {
          btn.classList.remove("copied");
          if (label) label.textContent = "نسخ الرابط";
          if (icon) icon.className = "fas fa-copy";
        }, 1800);
      } catch (e) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في النسخ");
      }
    });
  });

  // إعادة تحميل المعاينة
  document.querySelectorAll("#startSection5 .opc-reload").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".opc");
      const frame = card && card.querySelector(".opc-frame");
      if (frame && frame.dataset.src) frame.src = frame.dataset.src;
    });
  });
}

// المقاس الطبيعي لكل أوفرلاي (الصفحة تعرضها بمقاسها الحقيقي في وسط الحاوية،
// وتُصغَّر تلقائياً فقط إذا لم تتسع — فلا تُقتطع القوائم الطويلة)
const FRAME_NATURAL = {
  viewers: [460, 345],
  "last-gift": [460, 345],
  "highest-gift": [460, 345],
  leaderboard: [460, 345],
  "coin-jar": [460, 345],
  followers: [460, 345],
  wins: [460, 345],
  fireworks: [460, 345],
  "list-1": [300, 560],
  "list-2": [300, 560],
  music: [430, 470],
};

function sizeOverlayFrames() {
  document.querySelectorAll("#startSection5 .opc-frame").forEach((f) => {
    const nat = FRAME_NATURAL[f.dataset.kind];
    if (!nat) return;
    const box = f.parentElement;
    if (!box) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    // القسم مخفي أو لم يُقاس بعد — نتجاهل
    if (bw < 60 || bh < 60) return;
    const k = Math.min(bw / nat[0], bh / nat[1], 1);
    f.style.width = nat[0] + "px";
    f.style.height = nat[1] + "px";
    f.style.transform = `translate(-50%, -50%) scale(${k})`;
  });
}

// تحديث روابط كل الكروت + تحميل المعاينات الحقيقية
// المعاينات تفتح بـ demo=1 — نفس الشكل الثابت لمكوّنات OverlaysSection،
// بينما روابط النسخ/الفتح تظل حقيقية تعرض بيانات البث الفعلية في OBS
const LIVE_OVERLAY_KINDS = new Set([
  "viewers",
  "last-gift",
  "highest-gift",
  "leaderboard",
  "coin-jar",
  "followers",
  "fireworks",
]);

// ─── تحميل كسول للمعاينات ───
// الرابط المطلوب يُخزَّن فقط — الـObserver يحمّل iframe عندما يظهر الكارت
// على الشاشة ويعلّق الصفحة (about:blank) عندما تخرج — أداء خفيف بلا معاينات واقفة
let _frameObserver = null;
function ensureFrameObserver() {
  if (_frameObserver || typeof IntersectionObserver === "undefined") {
    return _frameObserver;
  }
  _frameObserver = new IntersectionObserver(
    function (entries) {
      for (const e of entries) {
        const frame = e.target.querySelector(".opc-frame");
        if (!frame || !frame.dataset.src) continue;
        if (e.isIntersecting) {
          sizeOverlayFrames();
          if (frame.getAttribute("src") !== frame.dataset.src) {
            frame.src = frame.dataset.src;
          }
        } else if (frame.getAttribute("src") !== "about:blank") {
          frame.setAttribute("src", "about:blank");
        }
      }
    },
    { rootMargin: "120px" },
  );
  return _frameObserver;
}

async function refreshOverlayLinks() {
  const token = await getScreenTokenCached();
  if (!token) return false;
  document.querySelectorAll("#startSection5 .opc-frame").forEach((f) => {
    if (!f.dataset.kind) return;
    f.dataset.src = overlayLinkFor(f.dataset.kind);
  });
  document.querySelectorAll("#startSection5 .opc-open").forEach((a) => {
    if (!a.dataset.kind) return;
    a.href = overlayLinkFor(a.dataset.kind);
  });
  ensureFrameObserver();
  document.querySelectorAll("#startSection5 .opc-preview").forEach((el) => {
    _frameObserver.observe(el);
  });
  sizeOverlayFrames();
  return true;
}

async function initOverlaysSection() {
  bindOverlayCardsOnce();
  // اللوحات الداخلية (عداد الفوز + القائمتان)
  initWinsPanel();
  initListsPanel();
  // إعدادات أوفرلايز اللايف (أشكال/سكينز)
  loadLivePrefs();

  const ok = await refreshOverlayLinks();
  if (!ok) {
    // إعادة محاولة تلقائية إذا فشل جلب التوكن في المرة الأولى
    clearTimeout(__S.overlaysRetryTimer);
    __S.overlaysRetryTimer = setTimeout(initOverlaysSection, 5000);
  }
}

// إعادة حساب تصغير المعاينات عند تغيير حجم النافذة
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    if (document.getElementById("startSection5")?.style.display !== "none") {
      sizeOverlayFrames();
    }
  });
}

// ============================================================
// لوحة قوائم الأوفرلاى (القائمة الأولى/الثانية) — داخل الكارت الموحد
// ============================================================

async function initListsPanel() {
  if (__S.listsPanelInitDone) {
    // تحديث البيانات عند كل فتح للسيكشن
    if (typeof listsRefreshData === "function") listsRefreshData();
    return;
  }
  __S.listsPanelInitDone = true;

  async function getToken() {
    return getScreenTokenCached();
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

  // دالة تحديث الإعدادات — تُستدعى عند كل فتح للسيكشن
  window.listsRefreshData = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await getSettings(token);
      if (data.success) ctrls.forEach((c) => c.load());
    } catch (e) {}
  };
  window.listsRefreshData();
  // إعادة محاولة تلقائية إذا فشل جلب التوكن في المرة الأولى
  clearTimeout(__S.listsRetryTimer);
  __S.listsRetryTimer = setTimeout(() => {
    if (!window._smlCtrls) return;
    window.listsRefreshData();
  }, 5000);

  // استعادة كل الإعدادات الافتراضية للقائمة
  document.querySelectorAll("#startSection5 .sml-restore").forEach((btn) => {
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
  // مسح الأسماء
  document.querySelectorAll("#startSection5 .sml-reset").forEach((btn) => {
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
          showMessage(
            "<i class='fas fa-circle-check'></i> تم مسح الأسماء",
          );
          ctrl.load();
        }
      } catch (e) {
        showMessage("<i class='fas fa-circle-xmark'></i> خطأ في المسح");
      }
    };
  });
}

export { initOverlaysSection, initListsPanel };

// ============================================================
// إعدادات أوفرلايز اللايف — أشكال/سكينز من OverlaysSection الجديد
// تُحفظ على السيرفر (live-prefs) وتُبث فورياً لصفحات OBS
// ============================================================

const OV_SKINS = {
  viewers: [
    { id: "classic", name: "Classic Red", tag: "Original", tier: 1, sw1: "#ff2d3d", sw2: "#8b0000" },
    { id: "midnight", name: "Midnight Void", tag: "Dark Elite", tier: 3, sw1: "#b8c8e8", sw2: "#0a0d15" },
    { id: "neon", name: "Neon Pulse", tag: "Cyberpunk", tier: 3, sw1: "#ff00ff", sw2: "#00ffff" },
    { id: "shadow", name: "Shadow Phantom", tag: "Dark Mist", tier: 4, sw1: "#a855f7", sw2: "#1a0330" },
    { id: "sapphire", name: "Sapphire Blue", tag: "Cool", tier: 3, sw1: "#3b82f6", sw2: "#04101f" },
    { id: "emerald", name: "Emerald Live", tag: "Fresh", tier: 3, sw1: "#10b981", sw2: "#041c11" },
    { id: "royal", name: "Royal Crown", tag: "Luxury", tier: 4, sw1: "#ffd700", sw2: "#2a0a0a" },
    { id: "obsidian", name: "Obsidian Luxe", tag: "Dark Gold", tier: 5, sw1: "#ffd700", sw2: "#0d0d0d" },
    { id: "diamond", name: "Diamond Elite", tag: "Crystal", tier: 5, sw1: "#b8e6ff", sw2: "#0b1620" },
    { id: "aurora", name: "Aurora Storm", tag: "Cosmic", tier: 5, sw1: "#00d4ff", sw2: "#7b2ff7" },
  ],
  followers: [
    { id: "midnight", name: "Midnight Rose", tag: "Default", tier: 1 , sw1: "#c4283a", sw2: "#1a0508" },
    { id: "crimson", name: "Crimson Silk", tag: "Deep Red", tier: 1 , sw1: "#e6192d", sw2: "#1a0206" },
    { id: "bronze", name: "Bronze Age", tag: "Metallic", tier: 2 , sw1: "#cd7f32", sw2: "#1c0f05" },
    { id: "sapphire", name: "Sapphire Empire", tag: "Royal Blue", tier: 2 , sw1: "#3b82f6", sw2: "#04101f" },
    { id: "emerald", name: "Emerald Throne", tag: "Royal Green", tier: 3 , sw1: "#10b981", sw2: "#041c11" },
    { id: "amethyst", name: "Amethyst Crown", tag: "Mystic", tier: 3 , sw1: "#a855f7", sw2: "#12041c" },
    { id: "rosegold", name: "Rose Gold Luxe", tag: "Glamour", tier: 4 , sw1: "#ff8fa8", sw2: "#1e0a10" },
    { id: "golden", name: "Golden Hour", tag: "Pure Gold", tier: 4 , sw1: "#ffd700", sw2: "#1d1304" },
    { id: "diamond", name: "Diamond Elite", tag: "Crystal", tier: 5 , sw1: "#b8e6ff", sw2: "#0b1620" },
    { id: "neon", name: "Neon Dynasty", tag: "Cyberpunk", tier: 5 , sw1: "#ff00ff", sw2: "#10021a" },
    { id: "obsidian", name: "Obsidian Royale", tag: "Supreme", tier: 5 , sw1: "#ffd700", sw2: "#0d0d0d" },
  ],
  leaderboard: [
    { id: "classic", name: "Classic Rings", tag: "Original", tier: 1 , sw1: "#ffb500", sw2: "#1a1a1a" },
    { id: "midnight", name: "Midnight Void", tag: "Dark Elite", tier: 3 , sw1: "#b8c8e8", sw2: "#000000" },
    { id: "podium", name: "Champion Podium", tag: "Podium", tier: 2 , sw1: "#ffb500", sw2: "#2a2a2a" },
    { id: "neon", name: "Neon Cyber", tag: "Cyberpunk", tier: 3 , sw1: "#ff00ff", sw2: "#04010a" },
    { id: "shadow", name: "Shadow Phantom", tag: "Dark Mist", tier: 4 , sw1: "#a855f7", sw2: "#050108" },
    { id: "royal", name: "Royal Gold", tag: "Luxury", tier: 4 , sw1: "#ffd700", sw2: "#2a0a0a" },
    { id: "ember", name: "Ember Blaze", tag: "Fiery", tier: 4 , sw1: "#ff4500", sw2: "#1a0500" },
    { id: "obsidian", name: "Obsidian Luxe", tag: "Dark Gold", tier: 5 , sw1: "#ffd700", sw2: "#0a0805" },
    { id: "diamond", name: "Diamond Elite", tag: "Crystal", tier: 5 },
    { id: "aurora", name: "Aurora Storm", tag: "Cosmic", tier: 5 , sw1: "#00d4ff", sw2: "#05020d" },
  ],
};

const CJ_SHAPES = [
  { id: "jar", name: "Classic Jar" },
  { id: "heart", name: "Heart Vault" },
  { id: "potion", name: "Potion Flask" },
  { id: "orb", name: "Crystal Orb" },
  { id: "chest", name: "Treasure Chest" },
  { id: "star", name: "Star Vault" },
  { id: "gem", name: "Gem Crown" },
  { id: "shield", name: "Hero Shield" },
  { id: "hex", name: "Hex Chamber" },
  { id: "tiktok", name: "TikTok Box" },
];

const CJ_SKINS = [
  { id: "tiktok", name: "TikTok", p: "37,244,238", s: "254,44,85" },
  { id: "holo", name: "Holographic", p: "255,140,240", s: "120,240,255" },
  { id: "galaxy", name: "Galaxy", p: "120,60,220", s: "255,120,200" },
  { id: "storm", name: "Storm", p: "250,204,21", s: "99,102,241" },
  { id: "aurora", name: "Aurora", p: "52,211,153", s: "232,121,249" },
  { id: "toxic", name: "Toxic", p: "163,230,53", s: "126,34,206" },
  { id: "diamond", name: "Diamond", p: "184,230,255", s: "126,200,227" },
  { id: "ruby", name: "Ruby", p: "255,45,85", s: "139,0,0" },
  { id: "emerald", name: "Emerald", p: "16,185,129", s: "6,95,70" },
  { id: "sapphire", name: "Sapphire", p: "59,130,246", s: "30,58,138" },
  { id: "amethyst", name: "Amethyst", p: "168,85,247", s: "107,33,168" },
  { id: "rose", name: "Rose Gold", p: "255,179,186", s: "183,110,121" },
  { id: "obsidian", name: "Obsidian", p: "156,163,175", s: "31,41,55" },
  { id: "neon", name: "Neon Cyber", p: "255,0,255", s: "0,255,255" },
  { id: "cosmic", name: "Cosmic", p: "124,58,237", s: "236,72,153" },
  { id: "lava", name: "Molten", p: "255,85,0", s: "124,45,18" },
  { id: "frost", name: "Frost", p: "224,242,254", s: "14,165,233" },
  { id: "silver", name: "Silver", p: "220,228,238", s: "100,116,139" },
  { id: "bronze", name: "Bronze", p: "205,127,50", s: "92,58,25" },
  { id: "pearl", name: "Pearl", p: "245,240,250", s: "180,170,200" },
  { id: "jade", name: "Jade", p: "80,200,160", s: "20,80,60" },
  { id: "coral", name: "Coral", p: "255,145,140", s: "200,70,90" },
  { id: "royal", name: "Royal", p: "147,51,234", s: "250,204,21" },
  { id: "ocean", name: "Ocean", p: "56,189,248", s: "12,74,110" },
  { id: "cherry", name: "Cherry", p: "244,63,94", s: "136,19,55" },
  { id: "midnight", name: "Midnight", p: "99,102,241", s: "15,23,42" },
  { id: "honey", name: "Honey", p: "250,204,21", s: "161,98,7" },
];

let _livePrefs = {};
let _livePrefsLoaded = false;

async function loadLivePrefs(force) {
  try {
    if (_livePrefsLoaded && !force) return;
    const token = await getScreenTokenCached();
    if (!token) return;
    const res = await fetchWithAuth(
      `${__S.API_BASE}/api/live-overlay-prefs?token=${encodeURIComponent(token)}`,
    );
    const data = await res.json();
    if (data.success) {
      _livePrefs = data.prefs || {};
      _livePrefsLoaded = true;
    }
  } catch (e) {
    console.error("فشل تحميل إعدادات أوفرلايز اللايف:", e);
  }
}

async function saveLivePrefs(kind, patch) {
  try {
    _livePrefs[kind] = Object.assign({}, _livePrefs[kind] || {}, patch);
    const token = await getScreenTokenCached();
    if (!token) return;
    await fetchWithAuth(
      `${__S.API_BASE}/api/live-overlay-prefs?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { [kind]: _livePrefs[kind] } }),
      },
    );
    // تحديث المعاينة فوراً — الصفحة تجلب الإعدادات من السيرفر عند التحميل
    const frame = document.querySelector(`#startSection5 .opc-frame[data-kind="${kind}"]`);
    if (frame && frame.dataset.src) frame.src = frame.dataset.src;
  } catch (e) {
    showMessage("<i class='fas fa-circle-xmark'></i> فشل حفظ الإعدادات");
  }
}

function skinBtnsHtml(list, activeId, kind) {
  return list
    .map(
      (s) => `
      <button class="ovl-skin-btn ${s.id === activeId ? "is-active" : ""}" data-skin="${s.id}" data-kind="${kind}">
        <span class="ovl-skin-swatch" style="background: linear-gradient(135deg, var(--sw1), var(--sw2)); --sw1:${s.sw1 || "#555"}; --sw2:${s.sw2 || "#222"}"></span>
        <span class="ovl-skin-name">${s.name}</span>
        <span class="ovl-skin-tag">${s.tag}</span>
      </button>`,
    )
    .join("");
}

function buildPrefPanel(kind, container) {
  if (!_livePrefsLoaded) loadLivePrefs();
  const cur = _livePrefs[kind] || {};
  let html = "";

  if (kind === "viewers" || kind === "followers" || kind === "leaderboard") {
    const list = OV_SKINS[kind];
    const active = cur.skin || (kind === "followers" ? "midnight" : "classic");
    html = `
      <div class="ovl-pref-title"><i class="fas fa-wand-magic-sparkles"></i> أشكال ${list.length}</div>
      <div class="ovl-pref-sub">اختر شكل الأوفرلاي — يُطبَّق فوراً على الصفحة في OBS</div>
      <div class="ovl-pref-section">الشكل</div>
      <div class="ovl-skin-grid">${skinBtnsHtml(list, active, kind)}</div>`;
  } else if (kind === "coinjar") {
    const activeShape = cur.shape || "jar";
    const activeSkin = cur.skin || "tiktok";
    const showTotal = cur.showTotal !== false;
    html = `
      <div class="ovl-pref-title"><i class="fas fa-wand-magic-sparkles"></i> Jar Studio</div>
      <div class="ovl-pref-sub">شكل الجرة والسكن وعرض الإجمالي — يُطبَّق فوراً</div>
      <div class="ovl-pref-section">العرض</div>
      <div class="ovl-toggle-row">
        <span class="ovl-toggle-label">إظهار عداد إجمالي العملات</span>
        <button class="ovl-switch ${showTotal ? "is-on" : ""}" data-cj-toggle="showTotal" type="button"><span class="ovl-switch-thumb"></span></button>
      </div>
      <div class="ovl-pref-section">الشكل · ${CJ_SHAPES.length}</div>
      <div class="ovl-shape-grid">${skinBtnsHtml(
        CJ_SHAPES.map((s) => ({ id: s.id, name: s.name, tag: "", sw1: "#8b5cf6", sw2: "#312e81" })),
        activeShape,
        kind,
      )}</div>
      <div class="ovl-pref-section">السكن · ${CJ_SKINS.length}</div>
      <div class="ovl-skin-grid">${skinBtnsHtml(
        CJ_SKINS.map((s) => ({ id: s.id, name: s.name, tag: "", sw1: `rgb(${s.p})`, sw2: `rgb(${s.s})` })),
        activeSkin,
        kind,
      )}</div>`;
  } else if (kind === "fireworks") {
    const minCoins = cur.minCoins != null ? cur.minCoins : 1;
    const volume = cur.volume != null ? cur.volume : 50;
    const soundEnabled = !!cur.soundEnabled;
    html = `
      <div class="ovl-pref-title"><i class="fas fa-wand-magic-sparkles"></i> إعدادات الألعاب النارية</div>
      <div class="ovl-pref-sub">تُطبَّق فوراً على صفحة OBS</div>
      <div class="ovl-toggle-row">
        <span class="ovl-toggle-label">تشغيل صوت الانفجار</span>
        <button class="ovl-switch ${soundEnabled ? "is-on" : ""}" data-fw-toggle="soundEnabled" type="button"><span class="ovl-switch-thumb"></span></button>
      </div>
      <div class="ovl-pref-section">الصوت والحجم</div>
      <div class="ovl-num-row">
        <label>حجم الصوت (0 - 100)</label>
        <input type="number" data-fw-num="volume" min="0" max="100" value="${volume}" />
      </div>
      <div class="ovl-num-row">
        <label>أقل عدد عملات لإطلاق انفجار</label>
        <input type="number" data-fw-num="minCoins" min="0" max="100000" value="${minCoins}" />
      </div>`;
  }

  container.innerHTML = html;

  // ── الربط ──
  container.querySelectorAll(".ovl-skin-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isShape = kind === "coinjar" && btn.closest(".ovl-shape-grid");
      const activeId = btn.dataset.skin;
      container
        .querySelectorAll(btn.closest(".ovl-shape-grid") ? ".ovl-shape-grid .ovl-skin-btn" : ".ovl-skin-grid .ovl-skin-btn")
        .forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      if (kind === "coinjar") {
        if (isShape) saveLivePrefs("coinjar", { shape: activeId });
        else saveLivePrefs("coinjar", { skin: activeId });
      } else {
        saveLivePrefs(kind, { skin: activeId });
      }
    });
  });
  container.querySelectorAll(".ovl-switch").forEach((sw) => {
    sw.addEventListener("click", () => {
      sw.classList.toggle("is-on");
      const on = sw.classList.contains("is-on");
      if (sw.dataset.cjToggle === "showTotal") saveLivePrefs("coinjar", { showTotal: on });
      if (sw.dataset.fwToggle === "soundEnabled") saveLivePrefs("fireworks", { soundEnabled: on });
    });
  });
  container.querySelectorAll("[data-fw-num]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const patch = {};
      patch[inp.dataset.fwNum] = parseInt(inp.value, 10) || 0;
      saveLivePrefs("fireworks", patch);
    });
  });
}
