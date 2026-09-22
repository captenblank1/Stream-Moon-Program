// ============================================================
// js/tts.js — قسم قراءة التعليقات صوتياً (TTS)
// 1) واجهة الإعدادات: صوت/سرعة/نبرة/صلاحيات/فلاتر — حفظها على السيرفر
// 2) المشغل الوحيد للقراءة على جهاز البث: طابور بسقف 2 + إيقاف فوري
//    عند فصل البث (منع التضاعف والتراكم — دروس أعطال حقيقية)
// ============================================================
import __S from "./state.js";
import { fetchWithAuth, showMessage, showConfirm, getDeviceId } from "./utils-core.js";
import { showAddonSection } from "./addons-nav.js";
import { tryUnlockAudio } from "./socket.js";
import { getAuthToken } from "./pairing.js";
// ✅ لوحة أعلى المشاهدين نقاطاً وجدول الأشخاص المميزين — مشتركان مع الأغاني
import { loadPointsBoard, loadVipBoard, bindVipBoardControls } from "./songs.js";

const T = (s) => (window.AppI18n ? AppI18n.t(s) : s);

let loadedOnce = false;
let settingsReady = false; // ✅ لا حفظ قبل تحميل الإعدادات الفعلية من السيرفر
let voicesCache = [];
let userVoices = []; // جدول المستخدمين بصوت مخصص [{user, voiceURI, pitch, volume}]

function el(id) {
  return document.getElementById(id);
}

// ✅ قراءة سلايدر NaN-safe — نمط `parseInt(...) || fallback` كان يقلب
// 0 (كتم الصوت) للقيمة القصوى لأن 0 falsy
function sliderInt(id, fallback) {
  const v = parseInt(el(id)?.value, 10);
  return Number.isFinite(v) ? v : fallback;
}

// ============================================================
// جدول المستخدمين بصوت مخصص — إضافة/تعديل/حذف
// ============================================================
function fillUVVoiceSelect(select, current) {
  if (!select) return;
  const isEn = window.AppI18n && AppI18n.lang === "en";
  select.innerHTML = "";
  const groups = [
    ["tt", T("أصوات تيك توك")],
    ["ar", T("أصوات عربية")],
    ["en", T("أصوات عالمية")],
  ];
  for (const [group, label] of groups) {
    const list = voicesCache.filter((v) => v.group === group);
    if (!list.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const v of list) {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = isEn ? v.nameEn || v.name : v.name;
      optgroup.appendChild(opt);
    }
    select.appendChild(optgroup);
  }
  select.value = current || "ar-EG-SalmaNeural";
}

function renderUserVoices() {
  const tbody = el("ttsUserVoicesBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!userVoices.length) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="6" class="vps-empty">' +
      T("لا يوجد مستخدمون مخصصون بعد") +
      "</td>";
    tbody.appendChild(tr);
    return;
  }
  const isEn = window.AppI18n && AppI18n.lang === "en";
  userVoices.forEach((uv, idx) => {
    const voiceDef = voicesCache.find((v) => v.value === uv.voiceURI);
    const voiceName = voiceDef
      ? isEn
        ? voiceDef.nameEn || voiceDef.name
        : voiceDef.name
      : uv.voiceURI;
    const active = uv.active !== false;
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="checkbox" class="tts-uv-active" data-i="' +
      idx +
      '" ' +
      (active ? "checked" : "") +
      ' title="' +
      T("مفعّل = يُقرأ دائماً بصوته المخصص") +
      '" style="cursor:pointer; accent-color: var(--primary-color); width:17px; height:17px;" /></td>' +
      "<td>" +
      escapeHtml(uv.user) +
      "</td>" +
      "<td>" +
      escapeHtml(voiceName) +
      "</td>" +
      "<td>" +
      Number(uv.pitch ?? 1).toFixed(2) +
      "</td>" +
      "<td>" +
      Math.round((uv.volume ?? 1) * 100) +
      "%</td>" +
      '<td><button class="btn btn-secondary tts-uv-act" data-act="edit" data-i="' +
      idx +
      '"><i class="fas fa-pen"></i></button> ' +
      '<button class="btn btn-secondary tts-uv-act" data-act="del" data-i="' +
      idx +
      '"><i class="fas fa-trash"></i></button></td>';
    if (!active) tr.style.opacity = "0.5";
    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function beginEditUserVoice(idx) {
  const uv = userVoices[idx];
  if (!uv) return;
  el("ttsUVUser").value = uv.user;
  fillUVVoiceSelect(el("ttsUVVoice"), uv.voiceURI);
  el("ttsUVPitch").value = uv.pitch ?? 1;
  el("ttsUVPitchVal").textContent = Number(uv.pitch ?? 1).toFixed(2);
  el("ttsUVVolume").value = Math.round((uv.volume ?? 1) * 100);
  el("ttsUVVolumeVal").textContent = Math.round((uv.volume ?? 1) * 100);
  const addBtn = el("ttsUVAdd");
  if (addBtn) {
    addBtn.dataset.editing = String(idx);
    addBtn.innerHTML = '<i class="fas fa-save"></i> ' + T("تحديث");
  }
}

function resetUserVoiceForm() {
  el("ttsUVUser").value = "";
  fillUVVoiceSelect(el("ttsUVVoice"), el("ttsVoiceSelect")?.value);
  el("ttsUVPitch").value = 1;
  el("ttsUVPitchVal").textContent = "1.00";
  el("ttsUVVolume").value = 100;
  el("ttsUVVolumeVal").textContent = "100";
  const addBtn = el("ttsUVAdd");
  if (addBtn) {
    delete addBtn.dataset.editing;
    addBtn.innerHTML = '<i class="fas fa-plus"></i> ' + T("إضافة");
  }
}

async function addOrUpdateUserVoice() {
  const user = (el("ttsUVUser").value || "").trim();
  if (!user) {
    showMessage("<i class='fas fa-triangle-exclamation'></i> " + T("اكتب اسم المستخدم أولاً"));
    return;
  }
  const entry = {
    user,
    voiceURI: el("ttsUVVoice").value || "ar-EG-SalmaNeural",
    pitch: parseFloat(el("ttsUVPitch").value) || 1,
    volume: sliderInt("ttsUVVolume", 100) / 100,
    active: true,
  };
  const editing = el("ttsUVAdd")?.dataset.editing;
  if (editing !== undefined && editing !== "") {
    const idx = parseInt(editing, 10);
    if (userVoices[idx]) userVoices[idx] = { ...entry, active: userVoices[idx].active !== false };
    resetUserVoiceForm();
  } else {
    // نفس الاسم يستبدل الصف القديم (مقارنة غير حساسة لحالة الأحرف)
    const existing = userVoices.findIndex(
      (v) => String(v.user || "").toLowerCase() === user.toLowerCase(),
    );
    if (existing >= 0) userVoices[existing] = entry;
    else userVoices.push(entry);
    resetUserVoiceForm();
  }
  renderUserVoices();
  scheduleAutoSave();
}

// ============================================================
// المشغل الوحيد (طابور + إيقاف) — مشغّل واحد فقط على الحدث،
// أي مشغل ثانٍ يعني تضاعف الصوت فوق بعضه
// ============================================================
const localTtsQueue = [];
let localTtsSpeaking = false;
let localTtsCurrent = null;

function stopLocalTTS() {
  localTtsQueue.length = 0;
  try {
    if (localTtsCurrent) {
      localTtsCurrent.onended = null;
      localTtsCurrent.onerror = null;
      localTtsCurrent.pause();
      localTtsCurrent.removeAttribute("src");
    }
  } catch (err) {}
  localTtsCurrent = null;
  localTtsSpeaking = false;
}

function processLocalTTSQueue() {
  if (localTtsSpeaking || localTtsQueue.length === 0) return;
  localTtsSpeaking = true;
  const item = localTtsQueue.shift();
  const done = () => {
    localTtsSpeaking = false;
    setTimeout(processLocalTTSQueue, 400);
  };
  if (item.audioBase64) {
    try {
      const audio = new Audio("data:audio/mp3;base64," + item.audioBase64);
      localTtsCurrent = audio;
      let vol = 1;
      if (item.config && item.config.volume !== undefined)
        vol = Number(item.config.volume) || 1;
      else if (item.volume !== undefined) vol = Number(item.volume) || 1;
      audio.volume = Math.min(1, Math.max(0, vol));
      audio.onended = done;
      audio.onerror = done;
      // ✅ فتح سياسة التشغيل التلقائي أولاً — نفس آلية أصوات الأوامر،
      // حتى تعمل القراءة من لحظة فتح البرنامج بدون زيارة القسم
      tryUnlockAudio()
        .then(() => audio.play())
        .catch(done);
    } catch (err) {
      done();
    }
  } else if (item.text && window.speechSynthesis) {
    // فشل التوليد على السيرفر — بديل محلي حتى لا تختفي القراءة
    try {
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = /[\u0600-\u06FF]/.test(item.text) ? "ar-SA" : "en-US";
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    } catch (err) {
      done();
    }
  } else done();
}

// ============================================================
// واجهة الإعدادات
// ============================================================
function fillVoiceSelect(settings) {
  const select = el("ttsVoiceSelect");
  if (!select) return;
  const isEn = window.AppI18n && AppI18n.lang === "en";
  const current = settings?.voiceURI || "tt:en_us_002";
  select.innerHTML = "";
  const groups = [
    ["tt", T("أصوات تيك توك")],
    ["ar", T("أصوات عربية")],
    ["en", T("أصوات عالمية")],
  ];
  for (const [group, label] of groups) {
    const list = voicesCache.filter((v) => v.group === group);
    if (!list.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const v of list) {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = isEn ? v.nameEn || v.name : v.name;
      optgroup.appendChild(opt);
    }
    select.appendChild(optgroup);
  }
  select.value = current;
  if (!select.value) select.value = "tt:en_us_002";
}

function setToggle(id, on) {
  const c = el(id);
  if (c) c.checked = !!on;
}

function setRange(id, outId, value, fmt) {
  const r = el(id);
  const out = el(outId);
  if (!r) return;
  r.value = value;
  if (out) out.textContent = fmt ? fmt(value) : value;
}

function fillForm(settings) {
  const s = settings || {};
  setToggle("ttsEnabled", s.enabled ?? false);
  fillVoiceSelect(s);
  setToggle("ttsRandomVoice", s.randomVoice ?? false);
  setRange("ttsSpeed", "ttsSpeedVal", s.speed ?? 1, (v) => Number(v).toFixed(2));
  setRange("ttsPitch", "ttsPitchVal", s.pitch ?? 1, (v) => Number(v).toFixed(2));
  setRange(
    "ttsVolume",
    "ttsVolumeVal",
    Math.round((s.volume ?? 1) * 100),
    (v) => v,
  );
  // ✅ تحميل الأوضاع كما حُفظت — اختيار حر متعدد بلا حصرية قسرية
  setToggle("ttsPermAll", s.permAll ?? true);
  setToggle("ttsPermFollowers", s.permFollowers ?? false);
  setToggle("ttsPermSubscribers", s.permSubscribers ?? false);
  const subsLevelEl = el("ttsSubsLevel");
  if (subsLevelEl) subsLevelEl.value = s.subsLevel ?? 1;
  setToggle("ttsPermModerators", s.permModerators ?? false);
  setToggle("ttsPermTopFan", s.permTopFan ?? false);
  setToggle("ttsPermTopGifters", s.permTopGifters ?? false);
  setToggle("ttsPermVip", s.permVip ?? false);
  el("ttsTopGiftersCount").value = s.topGiftersCount ?? 3;
  userVoices = Array.isArray(s.userVoices) ? [...s.userVoices] : [];
  renderUserVoices();
  el("ttsMaxLen").value = s.maxLen ?? 150;
  // ✅ ثلاثية النقاط — نفس واجهة قسم الأغاني: الشيك بوكس مفعّل = القيمة تعد،
  // ومطفى = معطل (0). الافتراضي مطفي حتى لا تتضاعف نقاط رسائل الشات
  el("ttsPointsPerMessage").value = s.pointsPerMessage ?? 0;
  el("ttsPointsPerLike").value = s.pointsPerLike ?? 0;
  el("ttsPointsPerCoins").value = s.pointsPerCoins ?? 0;
  setToggle("ttsPointsMsgOn", (s.pointsPerMessage ?? 0) > 0);
  setToggle("ttsPointsLikeOn", (s.pointsPerLike ?? 0) > 0);
  setToggle("ttsPointsCoinsOn", (s.pointsPerCoins ?? 0) > 0);
  el("ttsReadCost").value = s.readCost ?? 0;
  setToggle("ttsReadCostOn", (s.readCost ?? 0) > 0);
  setToggle("ttsFilterCmds", s.filterCmds ?? true);
  setToggle("ttsFilterLetter", s.filterLetter ?? true);
  setToggle("ttsFilterMentions", s.filterMentions ?? false);
  el("ttsBlacklist").value = s.blacklist ?? "";
  setToggle("ttsBlacklistBlockAll", s.blacklistBlockAll ?? false);
}

function collectForm() {
  const form = {
    enabled: el("ttsEnabled").checked,
    voiceURI: el("ttsVoiceSelect").value,
    randomVoice: el("ttsRandomVoice").checked,
    speed: parseFloat(el("ttsSpeed").value) || 1,
    pitch: parseFloat(el("ttsPitch").value) || 1,
    volume: sliderInt("ttsVolume", 100) / 100,
    permAll: el("ttsPermAll").checked,
    permFollowers: el("ttsPermFollowers").checked,
    permSubscribers: el("ttsPermSubscribers").checked,
    subsLevel: parseInt(el("ttsSubsLevel")?.value, 10) || 1,
    permModerators: el("ttsPermModerators").checked,
    permTopFan: el("ttsPermTopFan").checked,
    permTopGifters: el("ttsPermTopGifters").checked,
    permVip: el("ttsPermVip").checked,
    topGiftersCount: parseInt(el("ttsTopGiftersCount").value, 10) || 3,
    userVoices: userVoices.map((v) => ({
      user: v.user,
      voiceURI: v.voiceURI,
      pitch: Number(v.pitch) || 1,
      volume: Number(v.volume) || 1,
      active: v.active !== false,
    })),
    // ✅ ثلاثية النقاط: التشيك بوكس مطفي = القيمة تصفر (0 = معطل بالباكند)
    pointsPerMessage: el("ttsPointsMsgOn")?.checked
      ? parseInt(el("ttsPointsPerMessage").value, 10) || 0
      : 0,
    pointsPerLike: el("ttsPointsLikeOn")?.checked
      ? parseInt(el("ttsPointsPerLike").value, 10) || 0
      : 0,
    pointsPerCoins: el("ttsPointsCoinsOn")?.checked
      ? parseInt(el("ttsPointsPerCoins").value, 10) || 0
      : 0,
    readCost: el("ttsReadCostOn")?.checked
      ? parseInt(el("ttsReadCost").value, 10) || 0
      : 0,
    cooldown: 0, // ✅ الكولداون ملغي من الواجهة — بدون تأخير بين القراءات
    maxLen: parseInt(el("ttsMaxLen").value, 10) || 150,
    blacklist: el("ttsBlacklist").value,
    blacklistBlockAll: el("ttsBlacklistBlockAll").checked,
    filterCmds: el("ttsFilterCmds").checked,
    filterLetter: el("ttsFilterLetter").checked,
    filterMentions: el("ttsFilterMentions").checked,
  };
  // ✅ حماية "لا أحد": لو كل أوضاع الصلاحيات طلعت مطفأة (لخبطة توگل —
  // كانت تحفظ إعدادات تمنع قراءة أي حد وتظهر كأن "الجميع" مش شغال)
  // الجميع يُفعّل تلقائياً قبل الحفظ
  if (
    !form.permAll && !form.permFollowers && !form.permSubscribers &&
    !form.permModerators && !form.permTopFan && !form.permTopGifters && !form.permVip
  ) {
    form.permAll = true;
    const allBox = el("ttsPermAll");
    if (allBox) allBox.checked = true;
  }
  return form;
}

function showStatus(text, ok) {
  const status = el("ttsStatus");
  if (!status) return;
  status.textContent = text;
  status.style.color = ok ? "#4caf50" : "var(--danger-color)";
}

async function loadSettings() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tts/settings`);
    const data = await res.json();
    if (data.success) {
      voicesCache = data.voices || [];
      fillForm(data.settings);
      fillUVVoiceSelect(el("ttsUVVoice"), el("ttsVoiceSelect")?.value);
      // ✅ الإعدادات الفعلية على الشاشة الآن — يُسمح بالحفظ التلقائي بعدها فقط
      settingsReady = true;
    } else {
      // فشل من الخادم — حفظ الآن سيكتب الإعدادات الافتراضية فوق المحفوظة
      showStatus(T("فشل تحميل الإعدادات — التعديل معطل حتى إعادة فتح القسم"), false);
    }
  } catch (e) {
    showMessage(
      "<i class='fas fa-triangle-exclamation'></i> " + T("فشل تحميل الإعدادات"),
    );
  }
}

// ============================================================
// الحفظ التلقائي — أي تغيير في أي إعداد يُحفظ بعد تهدئة قصيرة،
// بلا زر حفظ. تعطيل القراءة يوقف الصوت فوراً.
// ============================================================
let autoSaveTimer = null;
let autoSaving = false;
let pendingSave = false;

function scheduleAutoSave() {
  // ✅ حماية من المسح: قبل تحميل الإعدادات الفعلية أي حفظ يكتب
  // الإعدادات الافتراضية (والتفعيل مطفأ) فوق إعدادات المستخدم المحفوظة
  // — كان يطفئ القراءة الصوتية بالكامل لو فشل التحميل وأُجري أي تعديل
  if (!settingsReady) {
    showStatus(T("الإعدادات لم تُحمّل بعد — أعد فتح القسم"), false);
    return;
  }
  clearTimeout(autoSaveTimer);
  showStatus(T("جاري الحفظ..."), true);
  autoSaveTimer = setTimeout(doAutoSave, 300);
}

// ✅ إن أُغلقت النافذة خلال مهلة الحفظ المؤجل — أرسل الحفظ فوراً
window.addEventListener("beforeunload", () => {
  if (!autoSaveTimer || !settingsReady) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  try {
    fetch(`${__S.API_BASE}/api/tts/settings`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
        "x-device-id": getDeviceId(),
      },
      body: JSON.stringify({ settings: collectForm() }),
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
    const form = collectForm();
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tts/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: form }),
    });
    const data = await res.json();
    if (data.success) {
      showStatus(T("تم الحفظ تلقائياً"), true);
      // ✅ تعطيل القراءة يوقف القارئ فوراً — لا انتظار للتعليقات الجارية
      if (!form.enabled) stopLocalTTS();
    } else {
      showStatus(data.message || T("فشل الحفظ"), false);
    }
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

async function testVoice() {
  const btn = el("ttsTestBtn");
  const text = (el("ttsTestText").value || "").trim() || T("هذا صوت تجريبي من برنامج Stream Moon");
  try {
    if (btn) btn.disabled = true;
    const res = await fetchWithAuth(`${__S.API_BASE}/api/tts/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, settings: collectForm() }),
    });
    const data = await res.json();
    if (data.success && data.audioBase64) {
      const audio = new Audio("data:audio/mp3;base64," + data.audioBase64);
      audio.volume = sliderInt("ttsVolume", 100) / 100;
      await audio.play();
    } else {
      showStatus(data.message || T("فشل توليد الصوت"), false);
    }
  } catch (e) {
    showStatus(T("فشل توليد الصوت"), false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openTtsSection() {
  showAddonSection("startSectionTts", ".tts", () => {
    if (!loadedOnce) {
      loadedOnce = true;
      loadSettings();
    } else if (!settingsReady) {
      // ✅ تحميل سابق فشل (الخادم كان يعيد التشغيل مثلاً) — أعد المحاولة
      loadSettings();
    }
    const st = el("ttsStatus");
    if (st && !st.textContent) {
      st.textContent = T("الحفظ تلقائي — أي تعديل يُحفظ مباشرة");
      st.style.color = "var(--text-muted)";
    }
    // ✅ جدول نقاط TTS (مخزن مستقل) + جدول الأشخاص المميزين الخاص به
    loadPointsBoard("ttsPointsBoardBody", "/api/tts");
    loadVipBoard("ttsVipBody", "/api/tts");
  });
}

// ============================================================
// الربط
// ============================================================
function init() {
  const nav = document.querySelector(".tts");
  if (nav) nav.addEventListener("click", openTtsSection);

  // ✅ تحديث جدول أعلى المشاهدين نقاطاً
  el("ttsPointsRefresh")?.addEventListener("click", () =>
    loadPointsBoard("ttsPointsBoardBody"),
  );
  // ✅ جدول الأشخاص المميزين — إضافة/تعديل/حذف (قائمة TTS المستقلة)
  bindVipBoardControls("ttsVipUser", "ttsVipAdd", "ttsVipBody", "/api/tts");

  const section = document.getElementById("startSectionTts");

  // ✅ إصلاح "الخيار لا يُحفظ": عند تعليم أي صندوق نقاط والقيمة 0 تُملأ
  // تلقائياً بقيمة بداية — كان التعليم مع 0 يحفظ 0 فيبدو أنه لا يُحفظ
  const pointsStartDefaults = [
    ["ttsPointsMsgOn", "ttsPointsPerMessage", 1],
    ["ttsPointsLikeOn", "ttsPointsPerLike", 1],
    ["ttsPointsCoinsOn", "ttsPointsPerCoins", 1],
    ["ttsReadCostOn", "ttsReadCost", 1],
  ];
  for (const [cbId, numId, def] of pointsStartDefaults) {
    el(cbId)?.addEventListener("change", (e) => {
      const n = el(numId);
      if (e.target.checked && n && (parseInt(n.value, 10) || 0) <= 0)
        n.value = def;
    });
  }

  // شرائح التمرير — عرض القيمة الحية
  el("ttsSpeed")?.addEventListener("input", (e) => {
    el("ttsSpeedVal").textContent = Number(e.target.value).toFixed(2);
  });
  el("ttsPitch")?.addEventListener("input", (e) => {
    el("ttsPitchVal").textContent = Number(e.target.value).toFixed(2);
  });

  // ✅ نمط تيك توك: ضغطة واحدة تظبط السرعة (أسرع) والنبرة (أخف) —
  // نفس إحساس صوت تيك توك السريع على صوت سلمى العربي
  el("ttsTikTokStyle")?.addEventListener("click", () => {
    if (el("ttsSpeed")) {
      el("ttsSpeed").value = "1.2";
      el("ttsSpeedVal").textContent = "1.20";
    }
    if (el("ttsPitch")) {
      el("ttsPitch").value = "1.1";
      el("ttsPitchVal").textContent = "1.10";
    }
    scheduleAutoSave();
    showStatus(T("تم تطبيق نمط تيك توك — حفظ تلقائي"), true);
  });
  el("ttsVolume")?.addEventListener("input", (e) => {
    el("ttsVolumeVal").textContent = e.target.value;
  });

  // ✅ حفظ تلقائي: أي تغيير في أي إعداد داخل القسم يحفظ فوراً بعد تهدئة
  if (section)
    section.addEventListener("change", (e) => {
      // زر التجربة والعناصر الداخلية غير الإعدادية مستثناة
      if (e.target.closest(".tts-test-row")) return;
      scheduleAutoSave();
    });
  el("ttsTestBtn")?.addEventListener("click", testVoice);

  // ✅ اختيار حر متعدد — كل الأوضاع تُشتغل مع بعض (OR بالباكند) —
  // مع منع إطفاء كل الأوضاع: آخر وضع يظل مفعولاً لا يمكن إلغاؤه
  const permIds = [
    "ttsPermAll",
    "ttsPermFollowers",
    "ttsPermSubscribers",
    "ttsPermModerators",
    "ttsPermTopFan",
    "ttsPermTopGifters",
    "ttsPermVip",
  ];
  for (const id of permIds) {
    el(id)?.addEventListener("change", (e) => {
      if (e.target.checked) return;
      const anyOn = permIds.some((oid) => el(oid)?.checked);
      if (!anyOn) {
        e.target.checked = true;
        showStatus(T("لازم يفضل خيار واحد متفعل على الأقل"), false);
      }
    });
  }

  // جدول المستخدمين بصوت مخصص
  el("ttsUVAdd")?.addEventListener("click", addOrUpdateUserVoice);
  el("ttsUserVoicesBody")?.addEventListener("click", async (e) => {
    // ✅ عمود الاكتيف: مفعّل = يُقرأ دائماً / غير مفعّل = لا يُقرأ
    const activeBox = e.target.closest(".tts-uv-active");
    if (activeBox) {
      const i = parseInt(activeBox.dataset.i, 10);
      if (userVoices[i]) {
        userVoices[i].active = activeBox.checked;
        renderUserVoices();
        scheduleAutoSave();
      }
      return;
    }
    const btn = e.target.closest(".tts-uv-act");
    if (!btn) return;
    const idx = parseInt(btn.dataset.i, 10);
    if (btn.dataset.act === "del") {
      const victim = userVoices[idx];
      if (!victim) return;
      // ✅ تأكيد قبل الحذف
      const ok = await showConfirm(
        T("حذف المستخدم") + ' "' + victim.user + '" ' + T("من القائمة؟"),
      );
      if (!ok) return;
      const editingIdx = parseInt(el("ttsUVAdd")?.dataset.editing, 10);
      userVoices.splice(idx, 1);
      // ✅ تصحيح حالة "تحديث" المعلقة بعد الحذف — كان المؤشر يشيح بعد الـsplice
      // فيكتب زر "تحديث" بيانات النموذج فوق صف مستخدم آخر
      const addBtn = el("ttsUVAdd");
      if (addBtn && Number.isFinite(editingIdx)) {
        if (editingIdx === idx) resetUserVoiceForm();
        else if (editingIdx > idx)
          addBtn.dataset.editing = String(editingIdx - 1);
      }
      renderUserVoices();
      scheduleAutoSave();
    } else if (btn.dataset.act === "edit") {
      beginEditUserVoice(idx);
    }
  });

  // عرض القيم الحية لسلايدرات المستخدم المخصص
  el("ttsUVPitch")?.addEventListener("input", (e) => {
    el("ttsUVPitchVal").textContent = Number(e.target.value).toFixed(2);
  });
  el("ttsUVVolume")?.addEventListener("input", (e) => {
    el("ttsUVVolumeVal").textContent = e.target.value;
  });

  const bind = () => {
    if (!__S.frontendSocket) {
      setTimeout(bind, 500);
      return;
    }
    __S.frontendSocket.on("play-local-tts", (payload) => {
      if (!payload || !payload.text) return;
      // سقف الطابور: الزحمة → الأحدث تتقرى (مرفوع من 2 لـ 3 لتغطية تعليقات أكثر)
      while (localTtsQueue.length >= 3) localTtsQueue.shift();
      localTtsQueue.push(payload);
      processLocalTTSQueue();
    });
    __S.frontendSocket.on("stop-local-tts", () => stopLocalTTS());
    // فصل البث → إيقاف فوري لأي قراءة جادّة
    __S.frontendSocket.on("live-status-updated", (data) => {
      if (!data?.isLive && !data?.reconnecting) stopLocalTTS();
    });
  };
  bind();
}

init();
