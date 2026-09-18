// ⚠️ ملف مولّد آلياً من main.js — جزء من إعادة الهيكلة ES6. لا تحرّر النص المنقول.
import __S from "./state.js";
import { fetchWithAuth } from "./utils-core.js";
import { checkPluginStatus } from "./pairing.js";
import { showMessage } from "./utils-core.js";

// ============================================================
// دوال RCON
// ============================================================
async function loadRconConfig() {
  try {
    const res = await fetchWithAuth(`${__S.API_BASE}/api/rcon-config`);
    if (!res.ok) throw new Error("فشل تحميل إعدادات RCON");
    const config = await res.json();
    document.getElementById("player-ip").value = config.host || "";
    document.getElementById("player-port").value = config.port || "";
    document.getElementById("player-password").value = config.password || "";
    document.getElementById("player-name").value = config.player || "";
    checkPluginStatus();
  } catch (err) {
    console.warn("⚠️ لم يتم تحميل إعدادات RCON:", err.message);
  }
}

document
  .getElementById("send-minecraft-properties")
  .addEventListener("click", (event) =>
    __S.withButtonLock(event.currentTarget, async () => {
      const host = document.getElementById("player-ip").value.trim();
      const port = document.getElementById("player-port").value.trim();
      const password = document.getElementById("player-password").value.trim();
      const player = document.getElementById("player-name").value.trim();
      if (!host || !port || !password || !player) {
        showMessage(
          "<i class='fas fa-triangle-exclamation'></i> جميع حقول ماين كرافت مطلوبة",
        );
        return;
      }
      try {
        const res = await fetchWithAuth(`${__S.API_BASE}/api/rcon-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            port: parseInt(port),
            password,
            player,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage(
            "<i class='fas fa-circle-check'></i> تم حفظ الإعدادات — جارٍ محاولة الربط التلقائي بالسيرفر",
          );
          // حدّث حالة الاقتران بعد ثانية لإعطاء الباك فرصة الربط التلقائي
          setTimeout(() => checkPluginStatus(), 1000);
        } else
          showMessage(
            "<i class='fas fa-circle-xmark'></i> فشل حفظ الإعدادات: " +
              (data.message || ""),
          );
      } catch (err) {
        console.error(err);
        showMessage(
          "<i class='fas fa-circle-xmark'></i> خطأ في الاتصال بالسيرفر",
        );
      }
    }),
  );


export { loadRconConfig };
