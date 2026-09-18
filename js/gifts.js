// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { escapeHtml, safeImageUrl } from "./utils-core.js";

// ============================================================
// دوال الهدايا (Gifts)
// ============================================================
async function loadGifts() {
  try {
    const CACHE_KEY = "gifts_cache";
    const CACHE_TIME_KEY = "gifts_cache_time";
    const CACHE_DURATION = 24 * 60 * 60 * 1000;

    let giftsData = null;
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
    if (
      cached &&
      cachedTime &&
      Date.now() - parseInt(cachedTime) < CACHE_DURATION
    ) {
      giftsData = JSON.parse(cached);
    } else {
      const res = await fetchWithAuth(`${__S.API_BASE}/api/gifts`);
      if (!res.ok) throw new Error("فشل جلب الهدايا من الخادم");
      const data = await res.json();
      if (data.success && Array.isArray(data.gifts)) {
        giftsData = data.gifts;
        giftsData.sort(
          (a, b) => (a.diamond_count || 0) - (b.diamond_count || 0),
        );
        localStorage.setItem(CACHE_KEY, JSON.stringify(giftsData));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
      } else {
        throw new Error("تنسيق غير صحيح للهدايا من الخادم");
      }
    }

    __S.gifts = giftsData;
    __S.giftsLoaded = true;

    const addCard = document.getElementById("addCard");
    if (addCard && addCard.style.display === "block") {
      updateGiftDropdown();
    }
  } catch (err) {
    console.error("❌ خطأ في تحميل الهدايا:", err);
    __S.gifts = [];
    __S.giftsLoaded = false;
  }
}

async function ensureGiftsLoaded() {
  if (__S.giftsLoaded) return;
  if (__S.giftsLoadingPromise) return __S.giftsLoadingPromise;
  __S.giftsLoadingPromise = loadGifts();
  await __S.giftsLoadingPromise;
  // ✅ كان يضع giftsLoaded=true بلا شرط — فشل مؤقت في الجلب كان يقفل
  // قائمة الهدايا للأبد ("لا توجد هدايا") بدون إعادة محاولة
}

function getGiftImage(giftId) {
  if (!__S.gifts || __S.gifts.length === 0) return "";
  // قد يحمل giftId عدة هويات مفصولة بفواصل (أمر متعدد الهدايا) — نعرض صورة أول هدية
  const firstId = String(giftId || "").split(",")[0].trim();
  if (!firstId) return "";
  const gift = __S.gifts.find((g) => String(g.id) === firstId);
  return gift?.image?.url_list?.[0] || "";
}

// ✅ صور كل الهدايا في أمر متعدد الهدايا — [{id, url, name}]
function getGiftImages(giftId) {
  if (!__S.gifts || !__S.gifts.length) return [];
  return String(giftId || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const gift = __S.gifts.find((g) => String(g.id) === id);
      return {
        id,
        url: gift?.image?.url_list?.[0] || "",
        name: gift?.name || `#${id}`,
      };
    });
}

function getGiftById(giftId) {
  if (!__S.gifts || !__S.gifts.length) return null;
  const id = String(giftId || "").trim();
  if (!id) return null;
  return __S.gifts.find((g) => String(g.id) === id) || null;
}

// قراءة الهدايا المختارة حالياً من الحقل المخفي (هويات مفصولة بفواصل)
function readSelectedGiftIds() {
  const hiddenInput = document.getElementById("giftSelect");
  return (hiddenInput?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeSelectedGifts(ids) {
  const hiddenInput = document.getElementById("giftSelect");
  const giftNameInput = document.getElementById("giftName");
  const names = ids
    .map((id) => getGiftById(id)?.name || "")
    .filter(Boolean);
  if (hiddenInput) hiddenInput.value = ids.join(",");
  if (giftNameInput) giftNameInput.value = names.join(",");
  return names;
}

// تحديث شكل الترويسة — ✅ يعرض أسماء كل الهدايا المختارة
function refreshGiftSelectedLabel(ids) {
  const selected = document.querySelector("#giftDropdown .selected");
  if (!selected) return;
  if (!ids || !ids.length) {
    selected.textContent = window.AppI18n
      ? AppI18n.t("Choose a gift...")
      : "Choose a gift...";
    return;
  }
  const names = ids
    .map((id) => getGiftById(id)?.name || `#${id}`)
    .filter(Boolean);
  selected.textContent = names.join(" ، ");
  selected.title = names.join(" ، ");
}

function updateGiftDropdown() {
  const dropdown = document.querySelector("#giftDropdown .options");
  if (!dropdown) return;
  const hiddenInput = document.getElementById("giftSelect");

  if (!__S.gifts || !__S.gifts.length) {
    const selected = document.querySelector("#giftDropdown .selected");
    if (selected)
      selected.innerHTML =
        "<i class='fas fa-triangle-exclamation'></i> لا توجد هدايا";
    return;
  }

  dropdown.innerHTML = "";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "بحث عن هدية...";
  searchInput.id = "giftSearchInput";
  searchInput.style.cssText =
    "width:100%; padding:8px; margin:0 0 8px 0; background:#333; color:white; border:none; border-radius:4px; position: sticky; top: 0; z-index: 2;";

  searchInput.oninput = (e) => {
    const term = e.target.value.trim().toLowerCase();
    let firstVisible = null;
    Array.from(dropdown.children).forEach((child) => {
      if (child === searchInput) return;
      // نستخدم dataset المخزّن مسبقاً بدل innerText لأن innerText
      // يجبر المتصفح على إعادة حساب الـ layout لكل عنصر مع كل ضغطة حرف
      const text = child.dataset.search || "";
      const visible = !term || text.includes(term);
      child.style.display = visible ? "flex" : "none";
      if (visible && !firstVisible) firstVisible = child;
    });
    // ✅ البحث ينقل السكرول لأول هدية مطابقة بدل بقاء السكرول في مكانه القديم
    if (firstVisible) {
      dropdown.scrollTop = firstVisible.offsetTop - searchInput.offsetHeight - 8;
    } else {
      dropdown.scrollTop = 0;
    }
  };
  dropdown.appendChild(searchInput);

  const selectedIds = readSelectedGiftIds();
  const selectedSet = new Set(selectedIds.map(String));

  const sortedGifts = [...__S.gifts].sort(
    (a, b) => (a.diamond_count || 0) - (b.diamond_count || 0),
  );

  sortedGifts.forEach((gift) => {
    const option = document.createElement("div");
    option.className = "option";
    option.style.cssText =
      "display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-bottom: 1px solid #444;";
    option.dataset.search =
      `${gift.name || ""} ${gift.diamond_count || 0}`.toLowerCase();

    if (selectedSet.has(String(gift.id))) {
      option.classList.add("active");
      option.style.backgroundColor = "#2a4a2a";
      option.style.borderLeft = "3px solid #1dd9e6e1";
    }

    const img = document.createElement("img");
    // ✅ فحص الرابط قبل الاستخدام (منع javascript: وأي مخطط غير آمن)
    img.src = safeImageUrl(gift.image?.url_list?.[0] || "");
    img.style.cssText =
      "width: 35px; height: 35px; object-fit: cover; border-radius: 4px;";
    img.onerror = function () {
      this.style.display = "none";
    };
    const span = document.createElement("span");
    span.innerHTML = `${escapeHtml(gift.name)} - ${gift.diamond_count || 0} <i class="fas fa-gem"></i>`;

    option.appendChild(img);
    option.appendChild(span);

    // ✅ اختيار متعدد: النقر يحدد/يلغي الهدية ويبقي القائمة مفتوحة
    option.onclick = () => {
      const ids = readSelectedGiftIds();
      const idx = ids.findIndex((id) => String(id) === String(gift.id));
      if (idx >= 0) {
        ids.splice(idx, 1);
        option.classList.remove("active");
        option.style.backgroundColor = "";
        option.style.borderLeft = "";
      } else {
        ids.push(String(gift.id));
        option.classList.add("active");
        option.style.backgroundColor = "#2a4a2a";
        option.style.borderLeft = "3px solid #1dd9e6e1";
      }
      const names = writeSelectedGifts(ids);
      refreshGiftSelectedLabel(ids);
      // اسم الأمر يتعبأ تلقائياً إذا كان فارغاً (كما كان مع الهدية المفردة)
      const actionName = document.getElementById("actionName");
      if (actionName && !actionName.value.trim() && names.length) {
        actionName.value = names[0];
      }
    };

    dropdown.appendChild(option);
  });

  refreshGiftSelectedLabel(readSelectedGiftIds());

  const giftDD = document.querySelector("#giftDropdown");
  if (giftDD) {
    const selectedDiv = giftDD.querySelector(".selected");
    const optionsDiv = giftDD.querySelector(".options");
    if (selectedDiv && optionsDiv) {
      selectedDiv.onclick = null;
      selectedDiv.onclick = (e) => {
        // ✅ بدون stopPropagation: النقر على قائمة الهدايا يغلق فوراً أي
        // قائمة أخرى مفتوحة (أنواع التفاعل/البروفايل) عبر مستمع المستند الموحد
        const isVisible = optionsDiv.style.display === "block";
        if (isVisible) {
          optionsDiv.style.display = "none";
        } else {
          optionsDiv.style.display = "block";
          setTimeout(() => {
            const inp = document.getElementById("giftSearchInput");
            if (inp) inp.focus();
          }, 100);
        }
      };
      optionsDiv.style.display = "none";
    }
  }
  // ✅ الإغلاق الخارجي لقائمة الهدايا يديره مستمع المستند الموحد
  // closeCustomSelects/closeAllDropdowns — لا نضيف مستمعاً جديداً في كل
  // تحديث للقائمة (كان يتراكم ويتسرب بالذاكرة)
}


export {
  loadGifts,
  ensureGiftsLoaded,
  getGiftImage,
  getGiftImages,
  getGiftById,
  updateGiftDropdown,
};
