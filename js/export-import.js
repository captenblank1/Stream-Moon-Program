// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { escapeHtml } from "./utils-core.js";
import { getSelectedProfileId } from "./pairing.js";
import { fetchWithAuth } from "./utils-core.js";
import { getGiftImage, getGiftImages } from "./gifts.js";
import { safeImageUrl } from "./utils-core.js";

// خلية الصورة: صور كل الهدايا المختارة بشكل مصغر لأوامر الهدايا (من قائمة
// الهدايا المتراكمة محلياً) وأيقونة التفاعل المناسبة لباقي الأنواع
function buildCommandImageCell(cmd) {
  const coins = `<i class="fas fa-coins" style="color:#ffd54f; font-size:15px;" title="أمر نطاق العملات"></i>`;
  const isGift =
    cmd.__type === "gift" || (cmd.giftId != null && cmd.giftId !== "");
  if (isGift) {
    if (cmd.giftId) {
      // ✅ هدية واحدة: حجمها الطبيعي — عدة هدايا: مصغرة متفرقة
      const imgs = getGiftImages(cmd.giftId);
      if (imgs.length === 1) {
        return `<img src="${safeImageUrl(imgs[0].url)}" style="${imgStyle}" onerror="this.style.display='none'" title="${escapeHtml(imgs[0].name)}">`;
      }
      if (imgs.length > 1) {
        const html = imgs
          .map(
            (g) =>
              `<img src="${safeImageUrl(g.url)}" style="width:22px;height:22px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" title="${escapeHtml(g.name)}">`,
          )
          .join("");
        return `<span style="display:inline-flex; align-items:center; gap:5px; flex-wrap:wrap; justify-content:center; max-width:130px;">${html}</span>`;
      }
      return `<i class="fas fa-gift" style="color:#ffd54f; font-size:15px;"></i>`;
    }
    return coins; // أمر نطاق عملات بدون هدية محددة
  }
  if (cmd.type === "gift_range") return coins;
  const imgStyle =
    "width:30px;height:30px;object-fit:cover;border-radius:4px;display:block;margin:0 auto;";
  const iconMap = {
    like: "like.png",
    follow: "follow.png",
    share: "share.png",
    comment: "comment.png",
    join: "join.png",
    first_activity: "firstactive.png",
    nothing: "nothing.png",
  };
  // ✅ الديفولت عند عدم اختيار تفاعل: nothing.png
  const iconFile = iconMap[cmd.type] || "nothing.png";
  return `<img src="images/${iconFile}" style="${imgStyle}" onerror="this.style.display='none'" title="${escapeHtml(cmd.type || "")}">`;
}

// ============================================================
// دوال التصدير والاستيراد
// ============================================================
function buildCommandSelectionTable(commands, defaultChecked = true) {
  window.currentCommandsList = commands;
  const tbody = document.getElementById("commandSelectionTableBody");
  tbody.innerHTML = "";
  const selectAll = document.getElementById("select-all-commands");
  selectAll.checked = defaultChecked;

  commands.forEach((cmd, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const tdSelect = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "command-checkbox";
    checkbox.dataset.index = index;
    checkbox.checked = defaultChecked;
    tdSelect.appendChild(checkbox);
    tr.appendChild(tdSelect);

    const tdName = document.createElement("td");
    tdName.textContent = cmd.name || cmd.giftName || "بدون اسم";
    if (cmd.combo) {
      const span = document.createElement("span");
      span.style.color = "#ff9800";
      span.style.fontSize = "12px";
      span.innerHTML = ` <i class="fas fa-keyboard"></i> ${escapeHtml(String(cmd.combo))}`;
      tdName.appendChild(span);
    }
    tr.appendChild(tdName);

    const tdCommand = document.createElement("td");
    const div = document.createElement("div");
    div.style.maxWidth = "250px";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.textContent = cmd.command || "";
    tdCommand.appendChild(div);
    if (cmd.webhookUrl) {
      const small = document.createElement("small");
      small.style.color = "#1dd9e6e1";
      small.innerHTML = ` <i class="fas fa-link"></i> ${escapeHtml(cmd.webhookUrl)}`;
      tdCommand.appendChild(small);
    }
    tr.appendChild(tdCommand);

    const tdScreen = document.createElement("td");
    tdScreen.textContent = cmd.screen || 1;
    tr.appendChild(tdScreen);

    const tdRepeat = document.createElement("td");
    tdRepeat.textContent = cmd.repeat || 1;
    tr.appendChild(tdRepeat);

    const tdInterval = document.createElement("td");
    tdInterval.textContent = cmd.interval || 500;
    tr.appendChild(tdInterval);

    const tdDelay = document.createElement("td");
    tdDelay.textContent = cmd.delayBefore || 0;
    tr.appendChild(tdDelay);

    const tdSound = document.createElement("td");
    tdSound.innerHTML = cmd.audio ? "<i class='fas fa-music'></i>" : "";
    tr.appendChild(tdSound);

    const tdVideo = document.createElement("td");
    tdVideo.innerHTML = cmd.video ? "<i class='fas fa-film'></i>" : "";
    tr.appendChild(tdVideo);

    // ✅ عمود التفاعل أخيراً — مكان عمود صوت الفيديو المحذوف
    const tdImage = document.createElement("td");
    tdImage.className = "interaction-cell";
    tdImage.innerHTML = buildCommandImageCell(cmd);
    tr.appendChild(tdImage);

    tbody.appendChild(tr);
  });
}

function buildDuplicateTable(commands) {
  const tbody = document.getElementById("duplicateTableBody");
  tbody.innerHTML = "";

  commands.forEach((cmd, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const tdReplace = document.createElement("td");
    const replaceCheck = document.createElement("input");
    replaceCheck.type = "checkbox";
    replaceCheck.className = "duplicate-replace-checkbox";
    replaceCheck.dataset.index = index;
    replaceCheck.checked = true;
    tdReplace.appendChild(replaceCheck);
    tr.appendChild(tdReplace);

    const tdName = document.createElement("td");
    tdName.textContent = cmd.name || cmd.giftName || "بدون اسم";
    tr.appendChild(tdName);

    const tdCommand = document.createElement("td");
    const div = document.createElement("div");
    div.style.maxWidth = "250px";
    div.style.whiteSpace = "nowrap";
    div.style.overflow = "hidden";
    div.style.textOverflow = "ellipsis";
    div.textContent = cmd.command || "";
    tdCommand.appendChild(div);
    if (cmd.webhookUrl) {
      const small = document.createElement("small");
      small.style.color = "#1dd9e6e1";
      small.innerHTML = ` <i class="fas fa-link"></i> ${escapeHtml(cmd.webhookUrl)}`;
      tdCommand.appendChild(small);
    }
    tr.appendChild(tdCommand);

    const tdScreen = document.createElement("td");
    tdScreen.textContent = cmd.screen || 1;
    tr.appendChild(tdScreen);

    const tdRepeat = document.createElement("td");
    tdRepeat.textContent = cmd.repeat || 1;
    tr.appendChild(tdRepeat);

    const tdInterval = document.createElement("td");
    tdInterval.textContent = cmd.interval || 500;
    tr.appendChild(tdInterval);

    const tdDelay = document.createElement("td");
    tdDelay.textContent = cmd.delayBefore || 0;
    tr.appendChild(tdDelay);

    const tdSound = document.createElement("td");
    tdSound.innerHTML = cmd.audio ? "<i class='fas fa-music'></i>" : "";
    tr.appendChild(tdSound);

    const tdVideo = document.createElement("td");
    tdVideo.innerHTML = cmd.video ? "<i class='fas fa-film'></i>" : "";
    tr.appendChild(tdVideo);

    // ✅ عمود التفاعل أخيراً — مكان عمود صوت الفيديو المحذوف
    const tdImage = document.createElement("td");
    tdImage.className = "interaction-cell";
    tdImage.innerHTML = buildCommandImageCell(cmd);
    tr.appendChild(tdImage);

    tbody.appendChild(tr);
  });
}

async function refreshExistingCommands() {
  const profileId = getSelectedProfileId();
  if (!profileId) return;
  try {
    const [giftsRes, interactRes] = await Promise.all([
      fetchWithAuth(`${__S.GIFT_API}?profile=${profileId}`),
      fetchWithAuth(`${__S.INTERACT_API}?profile=${profileId}`),
    ]);
    const giftsData = await giftsRes.json();
    const interactData = await interactRes.json();
    const giftList = giftsData.gifts || [];
    const interactList = interactData.list || [];

    const newMap = new Map();
    giftList.forEach((g) => {
      // ✅ أمر متعدد الهدايا: giftId قائمة هويات مفصولة بفواصل — نسجّل كل هدية على حدة
      String(g.giftId || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => newMap.set(`gift_${id}`, true));
    });
    interactList.forEach((cmd) => {
      let key = `interact_${cmd.type}`;
      if (cmd.type === "comment") key += `_${cmd.keyword || ""}`;
      else if (cmd.type === "like") key += `_${cmd.threshold || 0}`;
      else key += `_${cmd.keyword || ""}`;
      newMap.set(key, true);
    });
    __S.existingCommandsMap = newMap;
  } catch (err) {
    console.warn("فشل تحميل قائمة الأوامر الموجودة", err);
  }
}


export { buildCommandSelectionTable, buildDuplicateTable, refreshExistingCommands };
