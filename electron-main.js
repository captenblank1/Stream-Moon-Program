// electron-main.js - Agent مدمج بالكامل (مع robotjs + autoUpdater + Hotkey + تشفير البلوجن)
// ============================================================

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  protocol,
  session,
  shell,
  safeStorage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { exec } = require("child_process");
const axios = require("axios");
const io = require("socket.io-client");
const robot = require("robotjs");
const { autoUpdater } = require("electron-updater");
const { uIOhook, UiohookKey } = require("uiohook-napi");

Menu.setApplicationMenu(null);

// ============================================================
// 1. إعدادات التخزين المحلي
// ============================================================
let CONFIG_DIR,
  CONFIG_FILE,
  KEY_FILE,
  LOG_FILE,
  ERROR_LOG_FILE,
  MACHINE_ID_FILE,
  PLUGIN_KEY_FILE; // ← جديد

// الرابط الافتراضي للسيرفر — يُغيَّر من هنا فقط في البرنامج

// روابط الخادم مشفرة XOR — لا تظهر كنصوص صريحة في الملفات المترجمة
const _URL_KEY = [90, 165, 60, 126, 17, 155];
function _decodeUrl(arr) {
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i] ^ _URL_KEY[i % _URL_KEY.length]);
  return s;
}
const _ENC_DEFAULT_URL = [50, 209, 72, 14, 98, 161, 117, 138, 94, 31, 114, 240, 63, 203, 88, 83, 38, 243, 48, 157, 18, 17, 127, 233, 63, 203, 88, 27, 99, 181, 57, 202, 81];
const _ENC_LEGACY_URLS = [[56, 196, 95, 21, 116, 245, 62, 136, 76, 12, 126, 255, 47, 198, 72, 23, 126, 245, 119, 145, 4, 74, 117, 181, 47, 213, 18, 12, 112, 242, 54, 210, 93, 7, 63, 250, 42, 213], [41, 209, 78, 27, 112, 246, 55, 202, 83, 16, 63, 244, 52, 215, 89, 16, 117, 254, 40, 139, 95, 17, 124]];
const DEFAULT_SERVER_URL = _decodeUrl(_ENC_DEFAULT_URL);
const LEGACY_SERVER_URLS = _ENC_LEGACY_URLS.map(_decodeUrl);

// ================ بروتوكول app:// المشفر ================
let RESOURCE_KEY = null;
try {
  RESOURCE_KEY = Buffer.from(require("./res-key.jsc"), "hex");
} catch {
  try {
    RESOURCE_KEY = Buffer.from(require("./res-key.js"), "hex");
  } catch {}
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

function decryptAsset(encPath) {
  const raw = fs.readFileSync(encPath);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", RESOURCE_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}

function registerAppProtocol() {
  protocol.handle("app", (req) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (!p || p === "/") p = "/index.html";
    p = p.replace(/^\/+/, "").split("?")[0];
    if (p.includes("..")) return new Response("Forbidden", { status: 403 });

    let buffer = null;
    const encPath = path.join(__dirname, "enc", p + ".enc");
    if (RESOURCE_KEY && fs.existsSync(encPath)) {
      try {
        buffer = decryptAsset(encPath);
      } catch {
        return new Response("Decrypt Error", { status: 500 });
      }
    } else {
      const plainPath = path.join(__dirname, p);
      if (fs.existsSync(plainPath) && fs.statSync(plainPath).isFile()) {
        buffer = fs.readFileSync(plainPath);
      }
    }
    if (!buffer) return new Response("Not Found", { status: 404 });
    const ext = path.extname(p).toLowerCase();
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": MIME[ext] || "application/octet-stream" },
    });
  });
}

const HEARTBEAT_INTERVAL = 15000;
const MAX_KEY_REPEAT = 100;
const MAX_WEBHOOK_REPEAT = 100;
const MAX_INTERVAL_MS = 5000;
const MAX_LOG_SIZE = 2 * 1024 * 1024;

function initPaths() {
  CONFIG_DIR = path.join(app.getPath("userData"), "SteamMoon");
  CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
  KEY_FILE = path.join(CONFIG_DIR, ".encryption_key");
  LOG_FILE = path.join(CONFIG_DIR, "agent.log");
  ERROR_LOG_FILE = path.join(CONFIG_DIR, "agent-error.log");
  MACHINE_ID_FILE = path.join(CONFIG_DIR, "machine_id");
  PLUGIN_KEY_FILE = path.join(CONFIG_DIR, "plugin_master_key.enc"); // ← جديد

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ============================================================
// 2. التشفير وإدارة الجلسات
// ============================================================
// 🔒 حماية البيانات المحلية بطبقتين:
//   1) safeStorage من نظام التشغيل (DPAPI على Windows — مفتاح مربوط
//      بحساب المستخدم ويُدار من النظام، لا يُكتب مفتاح خام على القرص)
//   2) بديل AES-256-GCM بمفتاح مشتق من بصمة الجهاز إن لم يتوفر safeStorage
// المفتاح يعيش في الذاكرة (RAM) فقط أثناء التشغيل، والملف القديم
// (.encryption_key بنص صريح) يُحذف نهائياً بعد الترحيل
let config = {
  serverUrl: DEFAULT_SERVER_URL,
  sessionToken: null,
};

// ===== متغيرات المفتاح الرئيسي للبلوجن =====
let pluginMasterKey = null;

// مفتاح قديم للترحيل فقط (إن وُجد ملف .encryption_key)
let legacyEncryptionKey = null;

function loadLegacyKeyForMigration() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      legacyEncryptionKey = Buffer.from(
        fs.readFileSync(KEY_FILE, "utf8"),
        "hex",
      );
    }
  } catch (_) {}
}

// فك صيغة CBC القديمة (iv:hex) — للترحيل فقط
function legacyDecrypt(encryptedData) {
  if (!encryptedData || !legacyEncryptionKey) return null;
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      legacyEncryptionKey,
      iv,
    );
    let decrypted = decipher.update(parts[1], "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

// لفّ سر نصي للتخزين الآمن على القرص
function sealSecret(plain) {
  if (plain == null) return null;
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return (
      "SS1:" + safeStorage.encryptString(String(plain)).toString("base64")
    );
  }
  const key = generateKeyFromMachineId();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  return (
    "GCM:" +
    iv.toString("base64") +
    ":" +
    ct.toString("base64") +
    ":" +
    cipher.getAuthTag().toString("base64")
  );
}

// فكّ سر ملفوف (الصيغ الجديدة فقط)
function unsealSecret(sealed) {
  if (!sealed || typeof sealed !== "string") return null;
  if (sealed.startsWith("SS1:")) {
    try {
      return safeStorage.decryptString(
        Buffer.from(sealed.slice(4), "base64"),
      );
    } catch {
      return null;
    }
  }
  if (sealed.startsWith("GCM:")) {
    try {
      const parts = sealed.split(":");
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        generateKeyFromMachineId(),
        Buffer.from(parts[1], "base64"),
      );
      d.setAuthTag(Buffer.from(parts[3], "base64"));
      return Buffer.concat([
        d.update(Buffer.from(parts[2], "base64")),
        d.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

// معرّف قديم (توافقي) — نفس الحساب السابق ليظل مطابقاً لأي حظر سابق
function getLegacyMachineId() {
  const raw = [
    os.hostname(),
    (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || "unknown",
    os.platform(),
    os.arch(),
    os.totalmem(),
    process.env.COMPUTERNAME || "",
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").substring(0, 32);
}

// طبقات عتاد قوية: MachineGuid من الريجستري + رقم اللوحة الأم
function getHardwareAnchors() {
  const parts = [];
  try {
    const out = require("child_process")
      .execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { timeout: 5000, windowsHide: true },
      )
      .toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    if (m) parts.push(m[1]);
  } catch (_) {}
  try {
    const out = require("child_process")
      .execSync(
        "powershell -NoProfile -Command \"(Get-CimInstance Win32_BaseBoard).SerialNumber\"",
        { timeout: 8000, windowsHide: true },
      )
      .toString()
      .trim();
    if (out && out !== "" && out.toLowerCase() !== "none") parts.push(out);
  } catch (_) {}
  return parts;
}

let _machineIdCache = null;
function getMachineId() {
  if (_machineIdCache) return _machineIdCache;
  // المعرّف القديم مكوّن أساسي — يضمن الثبات مع التثبيتات القائمة
  const legacy = (() => {
    try {
      if (fs.existsSync(MACHINE_ID_FILE)) {
        return fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
      }
    } catch (_) {}
    return getLegacyMachineId();
  })();
  const raw = [legacy, ...getHardwareAnchors()].join("|");
  const id = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .substring(0, 32);
  try {
    fs.writeFileSync(MACHINE_ID_FILE, id);
  } catch (_) {}
  return id;
}

function normalizeServerUrl(url) {
  if (!url) return DEFAULT_SERVER_URL;
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    if (!url.startsWith("http")) url = "http://" + url;
    return url;
  }
  if (url.startsWith("http://")) url = url.replace("http://", "https://");
  else if (!url.startsWith("https://")) url = "https://" + url;
  return url;
}


function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf8");
      const data = JSON.parse(raw);
      // الصيغة الجديدة (SS1/GCM) أولاً، ثم ترحيل الصيغة القديمة CBC
      if (data.sessionToken) {
        config.sessionToken =
          unsealSecret(data.sessionToken) || legacyDecrypt(data.sessionToken);
        if (config.sessionToken && legacyEncryptionKey) {
          saveConfig(); // إعادة لفّ فوراً بالحماية الجديدة
        }
      } else {
        config.sessionToken = null;
      }
      // رابط الخادم مخزَّناً مختوماً (safeStorage) — لا يظهر كنص صريح
      if (data.serverUrlSealed) {
        config.serverUrl = normalizeServerUrl(
          unsealSecret(data.serverUrlSealed) || DEFAULT_SERVER_URL,
        );
      } else if (data.serverUrl) {
        // صيغة قديمة صريحة — تُرحَّل إلى المختوم عند أول حفظ
        config.serverUrl = normalizeServerUrl(data.serverUrl);
      } else {
        config.serverUrl = DEFAULT_SERVER_URL;
      }
      // بورت الوسيط المحلي — ثابت بين الجلسات حتى لا تتغير روابط OBS
      config.localProxyPort = Number.isInteger(data.localProxyPort)
        ? data.localProxyPort
        : null;
      // توكن الدخول مختوماً (safeStorage) — لا يُخزن في المتصفح أبداً
      config.authToken = data.authToken
        ? unsealSecret(data.authToken) || null
        : null;
      // ترحيل تلقائي: استبدال أي سيرفر قديم
      if (LEGACY_SERVER_URLS.some((old) => config.serverUrl.includes(old))) {
        logMessage(
          `🔄 تم استبدال السيرفر القديم (${config.serverUrl}) بالسيرفر الحالي (${DEFAULT_SERVER_URL})`,
        );
        config.serverUrl = normalizeServerUrl(DEFAULT_SERVER_URL);
      }
      logMessage("✅ تم تحميل الإعدادات");
    } else {
      config.serverUrl = DEFAULT_SERVER_URL;
      logMessage("⚠️ ملف الإعدادات غير موجود، سيتم إنشاؤه.");
    }
    saveConfig();
  } catch (e) {
    logError("❌ فشل تحميل الإعدادات:", e.message);
  }
}

function saveConfig() {
  try {
    const toSave = {};
    // الرابط يُختم (safeStorage) — الملف لا يحتوي أي رابط صريح
    try {
      toSave.serverUrlSealed = sealSecret(config.serverUrl);
    } catch (e) {
      // safeStorage غير متاح؟ نكتب مشفراً XOR كحل أخير بدل نص صريح
      toSave.serverUrlXor = Buffer.from(
        [...config.serverUrl].map((c, i) =>
          c.charCodeAt(0) ^ [0x5a, 0xa5, 0x3c, 0x7e, 0x11][i % 5],
        ),
      ).toString("base64");
    }
    // بورت الوسيط المحلي ثابت بين الجلسات حتى لا تتغير روابط OBS
    if (config.localProxyPort) toSave.localProxyPort = config.localProxyPort;
    toSave.sessionToken = config.sessionToken
      ? sealSecret(config.sessionToken)
      : null;
    toSave.authToken = config.authToken ? sealSecret(config.authToken) : null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    logError("❌ فشل حفظ الإعدادات:", e.message);
  }
}

// مزامنة التوكن المختوم من كوكي الخادم (httpOnly — تقرأه العملية الرئيسية
// فقط) بعد الدخول/التجديد، حتى يظل التوكن المحقون طازجاً دائماً
async function syncTokenFromCookie() {
  try {
    const serverBase = normalizeServerUrl(
      config.serverUrl || DEFAULT_SERVER_URL,
    ).replace(/\/+$/, "");
    const cookies = await session.defaultSession.cookies.get({
      url: serverBase,
      name: "token",
    });
    const fresh = cookies && cookies[0] ? cookies[0].value : null;
    if (fresh && fresh !== config.authToken) {
      config.authToken = fresh;
      saveConfig();
      logMessage("🔁 تم تحديث التوكن المختوم من كوكي الخادم");
    }
    return { success: true, token: config.authToken || null };
  } catch (e) {
    return { success: false, token: null };
  }
}

// توليد مفتاح مشتق من بصمة الجهاز (لصيغة GCM الاحتياطية فقط)
function generateKeyFromMachineId() {
  const machineId = getMachineId();
  const seed = machineId + "StreamMoon2024SecureKey";
  return crypto.createHash("sha256").update(seed).digest();
}

// ============================================================
// المفتاح الرئيسي للبلوجن — تخزين ملفوف بـ safeStorage/GCM.
// توليد عشوائي (لا اشتقاق من بصمة الجهاز) حتى لا يمكن إعادة بنائه
// من معلومات الجهاز لو سرق الملف. الصيغة الثنائية القديمة تُرحَّل تلقائياً.
// ============================================================
function loadOrCreatePluginMasterKey() {
  // 1) الصيغة الجديدة (نص ملفوف)
  try {
    if (fs.existsSync(PLUGIN_KEY_FILE)) {
      const sealed = fs.readFileSync(PLUGIN_KEY_FILE, "utf8").trim();
      if (sealed.startsWith("SS1:") || sealed.startsWith("GCM:")) {
        const hex = unsealSecret(sealed);
        if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
          pluginMasterKey = Buffer.from(hex, "hex");
          logMessage("🔑 تم تحميل المفتاح الرئيسي للبلوجن (تخزين محمي)");
          return;
        }
      }
    }
  } catch (error) {
    logError("⚠️ فشل تحميل المفتاح الرئيسي:", error.message);
  }

  // 2) الصيغة القديمة (ثنائي CBC بمفتاح بصمة الجهاز) — ترحيل
  try {
    if (fs.existsSync(PLUGIN_KEY_FILE)) {
      const encryptedData = fs.readFileSync(PLUGIN_KEY_FILE);
      if (!encryptedData.subarray) throw new Error("bad file");
      const iv = encryptedData.subarray(0, 16);
      const ciphertext = encryptedData.subarray(16);
      const key = generateKeyFromMachineId();
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      if (
        decrypted.length === 32 &&
        crypto
          .createHash("sha256")
          .update(getMachineId() + "StreamMoon2024SecureKey")
          .digest()
          .equals(decrypted)
      ) {
        // كان مفتاحاً مشتقاً قديماً → نستبدله بعشوائي أقوى
        pluginMasterKey = crypto.randomBytes(32);
        logMessage("🔑 ترقية المفتاح: مشتق قديم → عشوائي فريد");
      } else {
        pluginMasterKey = decrypted;
        logMessage("🔑 تم تحميل المفتاح الرئيسي القديم وسيُعاد لفّه محمياً");
      }
      savePluginMasterKeyEncrypted();
      return;
    }
  } catch (error) {
    // ملف تالف أو غير قابل للفك → توليد جديد
  }

  // 3) توليد عشوائي فريد لهذا التثبيت
  pluginMasterKey = crypto.randomBytes(32);
  savePluginMasterKeyEncrypted();
  logMessage("🔑 تم إنشاء مفتاح رئيسي جديد عشوائي");
}

// حفظ المفتاح الرئيسي ملفوفاً (safeStorage أو GCM)
function savePluginMasterKeyEncrypted() {
  try {
    if (!pluginMasterKey) return;
    fs.writeFileSync(
      PLUGIN_KEY_FILE,
      sealSecret(pluginMasterKey.toString("hex")),
      "utf8",
    );
  } catch (error) {
    logError("❌ فشل حفظ المفتاح الرئيسي:", error.message);
  }
}

// الحصول على المفتاح الرئيسي (لإرساله للبلوجن عبر القناة الموثقة)
function getPluginMasterKeyHex() {
  if (!pluginMasterKey) {
    loadOrCreatePluginMasterKey();
  }
  return pluginMasterKey ? pluginMasterKey.toString("hex") : null;
}

// ============================================================
// 2.2 تشفير ملفات البلوجن (جديد)
// ============================================================

// تشفير ملف للبلوجن
function encryptFileForPlugin(inputPath, outputPath) {
  try {
    if (!pluginMasterKey) {
      loadOrCreatePluginMasterKey();
    }

    const data = fs.readFileSync(inputPath);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", pluginMasterKey, iv);
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const finalBuffer = Buffer.concat([iv, encrypted]);
    fs.writeFileSync(outputPath, finalBuffer);

    logMessage(`✅ تم تشفير ${path.basename(inputPath)} للبلوجن`);
    return true;
  } catch (error) {
    logError(`❌ فشل تشفير ${path.basename(inputPath)}:`, error.message);
    return false;
  }
}

// فك تشفير ملف من البلوجن
function decryptFileFromPlugin(inputPath) {
  try {
    if (!pluginMasterKey) {
      loadOrCreatePluginMasterKey();
    }

    const encryptedData = fs.readFileSync(inputPath);
    const iv = encryptedData.subarray(0, 16);
    const ciphertext = encryptedData.subarray(16);

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      pluginMasterKey,
      iv,
    );
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  } catch (error) {
    logError(`❌ فشل فك تشفير ${path.basename(inputPath)}:`, error.message);
    return null;
  }
}

// ============================================================
// 3. السجلات (Logs)
// ============================================================
function rotateLog(filePath, maxSize = MAX_LOG_SIZE) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > maxSize) {
      const newName = filePath + "." + Date.now() + ".old";
      fs.renameSync(filePath, newName);
    }
  } catch (_) {}
}

process.stdout?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") return;
  throw err;
});
process.stderr?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") return;
  throw err;
});

function safeConsoleLog(line) {
  try {
    console.log(line);
  } catch {}
}

function safeConsoleError(line) {
  try {
    console.error(line);
  } catch {}
}

// تعقيم الأسطر قبل كتابتها في أي سجل: يخفي التوكنات/المفاتيح السداسية
// الطويلة وعبارات Bearer والبريد — وعنوان الخادم الحقيقي (يُرمز إلى [SERVER])
// لا بيانات حساسة في لوجات العميل
function redactLogArg(arg) {
  if (typeof arg !== "string") return arg;
  let out = arg;
  // إخفاء أي عنوان للخادم الحالي أو القديم أو أي رابط خارجي غير محلي
  try {
    const serverHosts = [
      DEFAULT_SERVER_URL,
      ...LEGACY_SERVER_URLS,
      config?.serverUrl || "",
    ]
      .map((u) => {
        try {
          return new URL(normalizeServerUrl(u)).host;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    for (const host of new Set(serverHosts)) {
      out = out.split(host).join("[SERVER]");
    }
    // إخفاء البروتوكول أيضاً — لا بقايا تكشف نوع الاتصال بالخادم
    out = out
      .split("wss://[SERVER]")
      .join("[SERVER]")
      .split("https://[SERVER]")
      .join("[SERVER]")
      .split("http://[SERVER]")
      .join("[SERVER]");
    // أي رابط http(s) متبقٍ غير محلي يُخفى أيضاً (روابط وسيطة/قديمة)
    out = out.replace(
      /https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[a-zA-Z0-9._%:-]+(\/[^\s"')]*)?/g,
      "[SERVER]",
    );
  } catch {}
  return out
    .replace(
      /([a-f0-9]{32,})/gi,
      (m) => `${m.slice(0, 6)}…[REDACTED:${m.length}]`,
    )
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._-]+/gi,
      (m) => `${m.split(/\s+/)[0]} [REDACTED]`,
    )
    .replace(
      /\b([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-z]{2,})\b/g,
      (m, first, domain) => `${first}***@${domain}`,
    );
}

function logMessage(...msg) {
  const line = `[${new Date().toISOString()}] ${msg
    .map(redactLogArg)
    .join(" ")}`;
  rotateLog(LOG_FILE);
  fs.appendFileSync(LOG_FILE, line + "\n");
  safeConsoleLog(line);
}

function logError(...msg) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg
    .map(redactLogArg)
    .join(" ")}`;
  rotateLog(LOG_FILE);
  rotateLog(ERROR_LOG_FILE);
  fs.appendFileSync(LOG_FILE, line + "\n");
  fs.appendFileSync(ERROR_LOG_FILE, line + "\n");
  safeConsoleError(line);
}

// ============================================================
// 3.5 الخادم الوسيط المحلي (إخفاء الخادم الحقيقي عن المستخدم/OBS)
// ============================================================
// يعرض البرنامج صفحات الشاشات/الأوفرلاي عبر http://127.0.0.1:<port>
// ويمرر كل الطلبات (صفحات HTML / socket.io / وسائط) إلى الخادم الحقيقي،
// فلا يظهر عنوان الخادم في أي رابط ينسخه المستخدم أو أي صفحة يفتحها.
let localProxyPort = null;

const OVERLAY_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function overlayStaticDirs() {
  return [
    path.join(__dirname, "overlay"),
    path.join(__dirname, "..", "back" + "end", "public", "overlay"),
  ];
}

function tryServeLocalOverlay(req, res) {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (!u.pathname.startsWith("/overlay/")) return false;
    const rel = path.normalize(u.pathname.slice("/overlay/".length));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
    for (const dir of overlayStaticDirs()) {
      const file = path.resolve(dir, rel);
      const root = path.resolve(dir);
      if (!file.startsWith(root + path.sep) && file !== root) continue;
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": OVERLAY_MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      fs.createReadStream(file).pipe(res);
      return true;
    }
  } catch {}
  return false;
}

function buildProxyTarget(reqUrl) {
  const base = normalizeServerUrl(config.serverUrl || DEFAULT_SERVER_URL);
  return new URL(reqUrl, base);
}

function proxyHttpRequest(req, res) {
  if (tryServeLocalOverlay(req, res)) return;
  try {
    const target = buildProxyTarget(req.url);
    const headers = { ...req.headers };
    // طلب أصيل من الخادم نفسه: لا Origin محلي يرفضه CORS الخادم البعيد
    delete headers.origin;
    delete headers.referer;
    headers.host = target.host;
    const mod = target.protocol === "http:" ? http : https;
    const proxyReq = mod.request(target, { method: req.method, headers }, (proxyRes) => {
      try {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      } catch {}
    });
    proxyReq.setTimeout(60000, () => {
      try { proxyReq.destroy(new Error("timeout")); } catch {}
    });
    proxyReq.on("error", () => {
      try { if (!res.headersSent) res.writeHead(502); res.end(); } catch {}
    });
    req.pipe(proxyReq, { end: true });
  } catch {
    try { res.writeHead(502); res.end(); } catch {}
  }
}

function proxyUpgrade(req, socket, head) {
  try {
    const target = buildProxyTarget(req.url);
    const headers = { ...req.headers };
    delete headers.origin;
    delete headers.referer;
    headers.host = target.host;
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
    const mod = target.protocol === "http:" ? http : https;
    const proxyReq = mod.request(target, { method: "GET", headers });
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      try {
        const hdrs = Object.entries(proxyRes.headers || {})
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${hdrs}\r\n\r\n`);
        proxySocket.on("error", () => socket.destroy());
        socket.on("error", () => proxySocket.destroy());
        if (proxyHead && proxyHead.length) socket.write(proxyHead);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      } catch {
        try { socket.destroy(); } catch {}
      }
    });
    proxyReq.on("error", () => socket.destroy());
    proxyReq.end(head);
  } catch {
    try { socket.destroy(); } catch {}
  }
}

function startLocalProxy() {
  const tryListen = (port) =>
    new Promise((resolve) => {
      const server = http.createServer(proxyHttpRequest);
      server.on("upgrade", proxyUpgrade);
      server.on("clientError", () => {});
      server.once("error", () => resolve(null));
      server.listen(port, "127.0.0.1", () => resolve({ server, port }));
    });

  (async () => {
    // نحترم البورت المحفوظ أولاً (ثبات روابط OBS) ثم نجرب نطاقاً محجوزاً
    const candidates = [];
    if (Number.isInteger(config.localProxyPort)) candidates.push(config.localProxyPort);
    for (let p = 47325; p <= 47335; p++)
      if (!candidates.includes(p)) candidates.push(p);
    for (const port of candidates) {
      const res = await tryListen(port);
      if (res) {
        localProxyPort = res.port;
        if (config.localProxyPort !== res.port) {
          config.localProxyPort = res.port;
          saveConfig();
        }
        logMessage(`✅ الوسيط المحلي للأوفرلاي يعمل على المنفذ ${res.port}`);
        return;
      }
    }
    logError("⚠️ تعذر تشغيل الوسيط المحلي — ستستخدم الشاشات الرابط المباشر");
  })();
}

// ============================================================
// 4. تنفيذ المفاتيح باستخدام robotjs
// ============================================================

const ROBOT_MODIFIERS = { Ctrl: "control", Alt: "alt", Shift: "shift" };
// ⛔ Win محذوف عمداً: منع فتح قائمة ابدأ/تشغيل (Win+R) عن بُعد —
// أقوى مسار لتنفيذ أوامر نظام على جهاز المستخدم عبر ضغطات المفاتيح
// (CapsLock كذلك — تبديل حالة كيبورد المستخدم عن بُعد تخريب لا أمر)
const ROBOT_KEY_MAP = {
  Space: "space",
  Enter: "enter",
  Backspace: "backspace",
  Tab: "tab",
  Escape: "escape",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Menu: "menu",
  // أسماء منتقي الواجهة المختصرة — بدونها تسقط في typeString وتُكتب نصاً
  Esc: "escape",
  Del: "delete",
  Ins: "insert",
  PgUp: "pageup",
  PgDn: "pagedown",
  // أزرار الوظائف الإضافية في لوحة المفاتيح
  PrtSc: "printscreen",
  ScrLk: "scrolllock",
  Pause: "pause",
  Insert: "insert",
  Delete: "delete",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  // رموز لوحة المفاتيح — بأسماء robotjs الصحيحة كما يخزنها منتقي الواجهة
  "`": "backquote",
  "-": "minus",
  "=": "equal",
  "[": "leftbracket",
  "]": "rightbracket",
  "\\": "backslash",
  ";": "semicolon",
  "'": "quote",
  ",": "comma",
  ".": "period",
  "/": "slash",
  // النام باد — أسماء robotjs الصحيحة لمفاتيحه الخاصة
  "*": "numpad_multiply",
  Num: "num_lock",
  "↵": "enter",
  Num0: "numpad_0",
  Num1: "numpad_1",
  Num2: "numpad_2",
  Num3: "numpad_3",
  Num4: "numpad_4",
  Num5: "numpad_5",
  Num6: "numpad_6",
  Num7: "numpad_7",
  Num8: "numpad_8",
  Num9: "numpad_9",
  "Num.": "numpad_decimal",
  "Num-": "numpad_subtract",
  "Num/": "numpad_divide",
  NumEnter: "enter",
};

function parseCombo(str) {
  if (typeof str !== "string" || !str) return null;
  // "+" وحده أو في النهاية ("Ctrl++") = مفتاح النام باد — لا تلتقطه القسمة
  // على + فنحل هذه الحالات كاملة مباشرة بمدخلاتها
  const trimmed = str.trim();
  if (trimmed === "+") return { key: "numpad_add", modifiers: [] };
  if (trimmed.endsWith("++")) {
    const modifiers = [];
    for (const p of trimmed.slice(0, -2).split("+")) {
      const t = p.trim();
      if (!t) return null;
      const norm = t[0].toUpperCase() + t.slice(1).toLowerCase();
      const m = ROBOT_MODIFIERS[norm];
      if (!m) return null;
      modifiers.push(m);
    }
    return { key: "numpad_add", modifiers };
  }
  const parts = str.split("+").map((p) => p.trim());
  const key = parts.pop();
  const modifiers = [];
  for (const p of parts) {
    // قبول أي حالة أحرف (alt+k / ALT+K / Alt+K) — التطبيع قبل المطابقة
    const norm = p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p;
    const m = ROBOT_MODIFIERS[norm];
    if (!m) return null;
    modifiers.push(m);
  }
  let robotKey = ROBOT_KEY_MAP[key];
  if (!robotKey && /^[a-z]$/i.test(key)) robotKey = key.toLowerCase();
  else if (!robotKey && /^\d$/.test(key)) robotKey = key;
  else if (!robotKey && /^f([1-9]|1[0-2])$/i.test(key))
    robotKey = key.toLowerCase();
  if (!robotKey) return null;
  return { key: robotKey, modifiers };
}

// مهلة صغيرة بين الضغطات — تُقاس بالمللي وتحاكي إيقاع يد الإنسان
const keyDelay = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// مسار VK بديل: robotjs يترجم الحروف عبر VkKeyScan حسب تخطيط
// الكيبورد الحالي، فمع تخطيط عربي ترجع -1 ويظهر "Invalid key code
// specified". هنا نضغط بأكواد الفيرتشوال-كي الثابتة (keybd_event)
// عبر مساعد PowerShell دائم — مستقل تماماً عن لغة الكيبورد
// ============================================================
const SCAN_MODIFIERS = { control: 0x1d, alt: 0x38, shift: 0x2a };
const VK_MODIFIERS = { control: 0x11, alt: 0x12, shift: 0x10 };
// سكان-كود فيزيائي ثابت + كود VK — نرسلهما معاً في الحدث (كالضغطة
// الفيزيائية) فتقرؤه الألعاب سواء كانت تقرأ VK أو السكان-كود.
// MapVirtualKey تُرجع صفراً مع التخطيط العربي لذا الجدول ثابت يدوياً.
// 0x100+ في السكان تعني مفتاحاً موسّعاً (Extended) مثل الأسهم
const SCAN_CODES = {
  q: [0x10, 0x51],
  w: [0x11, 0x57],
  e: [0x12, 0x45],
  r: [0x13, 0x52],
  t: [0x14, 0x54],
  y: [0x15, 0x59],
  u: [0x16, 0x55],
  i: [0x17, 0x49],
  o: [0x18, 0x4f],
  p: [0x19, 0x50],
  a: [0x1e, 0x41],
  s: [0x1f, 0x53],
  d: [0x20, 0x44],
  f: [0x21, 0x46],
  g: [0x22, 0x47],
  h: [0x23, 0x48],
  j: [0x24, 0x4a],
  k: [0x25, 0x4b],
  l: [0x26, 0x4c],
  z: [0x2c, 0x5a],
  x: [0x2d, 0x58],
  c: [0x2e, 0x43],
  v: [0x2f, 0x56],
  b: [0x30, 0x42],
  n: [0x31, 0x4e],
  m: [0x32, 0x4d],
  "1": [0x02, 0x31],
  "2": [0x03, 0x32],
  "3": [0x04, 0x33],
  "4": [0x05, 0x34],
  "5": [0x06, 0x35],
  "6": [0x07, 0x36],
  "7": [0x08, 0x37],
  "8": [0x09, 0x38],
  "9": [0x0a, 0x39],
  "0": [0x0b, 0x30],
  backquote: [0x29, 0xc0],
  minus: [0x0c, 0xbd],
  equal: [0x0d, 0xbb],
  leftbracket: [0x1a, 0xdb],
  rightbracket: [0x1b, 0xdd],
  backslash: [0x2b, 0xdc],
  semicolon: [0x27, 0xba],
  quote: [0x28, 0xde],
  comma: [0x33, 0xbc],
  period: [0x34, 0xbe],
  slash: [0x35, 0xbf],
  space: [0x39, 0x20],
  enter: [0x1c, 0x0d],
  backspace: [0x0e, 0x08],
  tab: [0x0f, 0x09],
  escape: [0x01, 0x1b],
  scrolllock: [0x46, 0x91],
  pause: [0x45, 0x13],
  insert: [0x152, 0x2d],
  delete: [0x153, 0x2e],
  home: [0x147, 0x24],
  end: [0x14f, 0x23],
  pageup: [0x149, 0x21],
  pagedown: [0x151, 0x22],
  up: [0x148, 0x26],
  down: [0x150, 0x28],
  left: [0x14b, 0x25],
  right: [0x14d, 0x27],
  printscreen: [0x137, 0x2c],
  menu: [0x15d, 0x5d],
  num_lock: [0x45, 0x90],
  numpad_multiply: [0x37, 0x6a],
  numpad_add: [0x4e, 0x6b],
  numpad_0: [0x52, 0x60],
  numpad_1: [0x4f, 0x61],
  numpad_2: [0x50, 0x62],
  numpad_3: [0x51, 0x63],
  numpad_4: [0x4b, 0x64],
  numpad_5: [0x4c, 0x65],
  numpad_6: [0x4d, 0x66],
  numpad_7: [0x47, 0x67],
  numpad_8: [0x48, 0x68],
  numpad_9: [0x49, 0x69],
  numpad_decimal: [0x53, 0x6e],
  numpad_subtract: [0x4a, 0x6d],
  numpad_divide: [0x135, 0x6f],
  numpad_enter: [0x11c, 0x0d],
};
// F1..F10 متتالية ثم قفزة: F11=0x57 وF12=0x58 — ليست خطية بعد F10
for (let n = 1; n <= 10; n++) SCAN_CODES["f" + n] = [0x3b + n - 1, 0x6f + n];
SCAN_CODES.f11 = [0x57, 0x7a];
SCAN_CODES.f12 = [0x58, 0x7b];
function scanForRobotKey(name) {
  return SCAN_CODES[name] || null;
}

const PS_KBD_SCRIPT = [
  // SendInput بحدث يحمل VK والسكان-كود معاً (كالضغطة الفيزيائية):
  // الألعاب التي تقرأ VK والتي تقرأ السكان-كود كلها تراه.
  // الصيغة: "d|scan:vk" / "u|scan:vk" / "w|ms" — scan مع 0x100+ = مفتاح موسّع،
  // و":u" بدل vk = حرف يونيكود (KEYEVENTF_UNICODE) للكتابة النصية
  // بنية INPUT مسطحة بإزاحات صريحة (FieldOffset) — البنية المتداخلة عبر
  // Add-Type كانت تُmarshل بحقول صفرية فيصل حدث فارغ لا يفهمه أي تطبيق
  "$sig='[StructLayout(LayoutKind.Explicit,Size=40)]public struct KI{[FieldOffset(0)]public uint type;[FieldOffset(8)]public ushort wVk;[FieldOffset(10)]public ushort wScan;[FieldOffset(12)]public uint dwFlags;[FieldOffset(16)]public uint time;};[DllImport(\"user32.dll\",SetLastError=true)]public static extern uint SendInput(uint n,ref KI p,int size);'",
  "Add-Type -MemberDefinition $sig -Name K -Namespace N",
  "[Console]::Out.WriteLine('k')",
  "function Send([string]$pair,[bool]$up){",
  "  $hv,$vk=$pair.Split(':')",
  "  $sc=[int]([Convert]::ToInt32($hv,16))",
  "  $i=New-Object N.K+KI",
  "  $i.type=1",
  "  $f=0",
  "  if($vk -eq 'u'){",
  "    $i.wVk=0",
  "    $i.wScan=[uint16]$sc",
  "    $f=4",
  "    if($up){$f=6}",
  "  } else {",
  "    if($sc -ge 256){$f=1;$sc=$sc-256}",
  "    if($up){$f=$f -bor 2}",
  "    $i.wVk=[uint16]([Convert]::ToInt32($vk,16))",
  "    $i.wScan=[uint16]$sc",
  "  }",
  "  $i.dwFlags=$f",
  "  if([N.K]::SendInput(1,[ref]$i,40) -ne 1){[Console]::Error.WriteLine(\"sendfail\")}",
  "}",
  "while($null -ne ($l=[Console]::In.ReadLine())){",
  "  foreach($t in $l.Split(' ')){",
  "    if($t.Length -lt 3){continue}",
  "    $op=$t[0]; $v=$t.Substring(2)",
  "    switch($op){",
  "      'd' {Send $v $false}",
  "      'u' {Send $v $true}",
  "      'w' {Start-Sleep -Milliseconds ([int]$v)}",
  "    }",
  "  }",
  "  [Console]::Out.WriteLine('k')",
  "}",
].join("\n");

let psKbdProc = null;
const psKbdWaiters = [];
function psKbdFlush(ok) {
  while (psKbdWaiters.length) {
    const w = psKbdWaiters.shift();
    try {
      w(ok);
    } catch {}
  }
}
function getPsKbdHelper() {
  if (psKbdProc && psKbdProc.exitCode === null) return psKbdProc;
  try {
    psKbdProc = require("child_process").spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_KBD_SCRIPT],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    // كل سطر 'k' من المساعد يعني تنفيذ سطر أوامر كامل — نوقظ أول منتظر.
    // أول 'k' بعد الإقلاع هي علامة جاهزية لا تأكيد تنفيذ — تُبتلع
    psKbdProc._readySeen = false;
    psKbdProc.stdout.on("data", (d) => {
      const lines = String(d).split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.indexOf("k") === -1) continue;
        if (!psKbdProc._readySeen) {
          psKbdProc._readySeen = true;
          continue;
        }
        psKbdFlush(true);
      }
    });
    psKbdProc.on("exit", () => {
      psKbdProc = null;
      psKbdFlush(false);
    });
    psKbdProc.on("error", () => {
      psKbdProc = null;
      psKbdFlush(false);
    });
    return psKbdProc;
  } catch {
    return null;
  }
}

// يكتب سطر توكنات في أنبوب المساعد وينتظر رد 'k' الفعلي — النجاح
// المزعوم عند الكتابة فقط كان يخفي فشل التنفيذ الحقيقي
function psKbdSendLine(tokens) {
  const proc = getPsKbdHelper();
  if (!proc || !proc.stdin || proc.stdin.destroyed)
    return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 8000);
    psKbdWaiters.push(finish);
    try {
      proc.stdin.write(tokens.join(" ") + "\n", (err) => {
        if (err) finish(false);
      });
    } catch {
      finish(false);
    }
  });
}

// كتابة نص بأحداث Unicode (KEYEVENTF_UNICODE): تصل الأحرف بدقة بأي لغة
// كيبورد — عكس typeString الذي يتكسر مع التخطيط العربي
async function sendTextViaVk(text) {
  if (!text) return false;
  const tokens = [];
  for (const ch of text) {
    if (ch === "\n") {
      tokens.push("d|0x1c:0x0d", "w|30", "u|0x1c:0x0d", "w|30");
      continue;
    }
    const code = ch.codePointAt(0);
    if (code > 0xffff) return false; // خارج BMP — يُترك لاحتياط robotjs
    const h = "0x" + code.toString(16);
    tokens.push(`d|${h}:u`, "w|15", `u|${h}:u`, "w|15");
  }
  return psKbdSendLine(tokens);
}

async function sendVkCombo(combo) {
  const pair = scanForRobotKey(combo.key);
  if (!pair) return false;
  const [scan, vk] = pair;
  const hex = (v) => "0x" + v.toString(16);
  const pairStr = `${hex(scan)}:${hex(vk)}`;
  const mods = combo.modifiers || [];
  const modPairs = mods
    .map((m) => [SCAN_MODIFIERS[m], VK_MODIFIERS[m]])
    .filter((p) => p[0] && p[1]);
  // التوكن = عملية|قيمة — لا مسافة بينهما وإلا انفصلا عند Split
  const tokens = [];
  for (const [ms, mv] of modPairs) tokens.push(`d|${hex(ms)}:${hex(mv)}`);
  if (modPairs.length) tokens.push("w|50");
  tokens.push(`d|${pairStr}`, "w|50", `u|${pairStr}`);
  if (modPairs.length) tokens.push("w|50");
  for (const [ms, mv] of modPairs) tokens.push(`u|${hex(ms)}:${hex(mv)}`);
  return psKbdSendLine(tokens);
}

async function sendComboViaRobot(combo) {
  const label =
    combo.modifiers.join("+") + (combo.modifiers.length ? "+" : "") + combo.key;
  // مسار VK أولاً دائماً: يضغط VK+سكان-كود معاً بتوقيت بشري، مستقل عن
  // لغة الكيبورد، ومؤكد ب رد من المساعد. تجربة robotjs أولاً كانت تترك
  // وميض Alt قبل الفشل (المفاتيح النصية تفشل مع التخطيط العربي دائماً)
  if (await sendVkCombo(combo)) {
    logMessage(`⌨️ كومبو عبر مسار VK: ${label}`);
    return true;
  }
  // احتياط robotjs للمفاتيح التي لا سكان-كود لها أو إن تعذر مساعد VK
  const mods = [...combo.modifiers];
  try {
    logMessage(`⌨️ ضغط كومبو حقيقي (robotjs احتياطي): ${label}`);
    robot.setKeyboardDelay(35);
    try {
      for (const m of mods) robot.keyToggle(m, "down");
      await keyDelay(50);
      robot.keyTap(combo.key);
      await keyDelay(50);
    } finally {
      // تحرير المعدلات دائماً حتى لو فشل الضغط — حتى لا يعلق Alt/Ctrl مضغوطاً
      for (const m of mods) {
        try {
          robot.keyToggle(m, "up");
        } catch {}
      }
    }
    logMessage("✅ تم تنفيذ الكومبو بنجاح");
    return true;
  } catch (err) {
    logError("❌ فشل تنفيذ الكومبو:", err.message);
    return false;
  }
}

async function sendKeysViaRobot(text) {
  if (!text || text.length === 0) return false;

  try {
    logMessage(`⌨️ إرسال ضغطات حقيقية: "${text}" عبر robotjs`);
    robot.setKeyboardDelay(35);
    robot.typeString(text);
    logMessage("✅ تم إرسال الضغطات الحقيقية بنجاح");
    return true;
  } catch (err) {
    logError("❌ فشل إرسال الضغطات:", err.message);
    return false;
  }
}

async function executeKeys(command, repeat = 1, interval = 500) {
  const keys = command.startsWith("KEY:") ? command.slice(4) : command;

  // "+" وحده أمر مشروع (مفتاح النام باد) — ما عدا ذلك تُحظر البادئات النظامية
  if (keys !== "+" && /^[#!^+]/.test(keys)) {
    logError(`⛔ تم حظر أمر يحتوي على مفتاح نظامي: ${keys}`);
    return;
  }

  // مفاتيح لا تصلح أمراً مستقلاً (معدلات فقط / محجوبة أمنياً) — كان
  // الفشل الصامت يفسرها نصاً مكتوباً على الشاشة بدل رفض واضح
  if (/^(Win|CapsLock|Shift|Ctrl|Alt)$/i.test(keys.trim())) {
    logError(`⛔ مفتاح غير صالح كأمر مستقل: ${keys}`);
    return;
  }

  const safeRepeat = Math.min(
    MAX_KEY_REPEAT,
    Math.max(1, parseInt(repeat) || 1),
  );
  const safeInterval = Math.min(
    MAX_INTERVAL_MS,
    Math.max(0, parseInt(interval) || 0),
  );

  for (let i = 0; i < safeRepeat; i++) {
    if (i > 0 && safeInterval > 0) {
      await new Promise((r) => setTimeout(r, safeInterval));
    }
    const combo = parseCombo(keys);
    if (combo) await sendComboViaRobot(combo);
    else if (!(await sendTextViaVk(keys))) await sendKeysViaRobot(keys);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ============================================================
// 5. تنفيذ Webhook
// ============================================================
async function executeWebhook(payload) {
  const {
    url,
    method = "POST",
    headers = {},
    body = {},
    repeat = 1,
    interval = 500,
    delayBefore = 0,
    fromServer = false,
  } = payload;

  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    logError("❌ تخطي Webhook: رابط غير صالح ->", url);
    return;
  }

  // ⛔ عناوين metadata السحابية وشبكات link-local محجوبة دائماً —
  // حتى للطلبات القادمة من السيرفر (لا استخدام مشروع لها على جهاز منزلي)
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isMetadata =
      /^169\.254\./.test(hostname) ||
      hostname === "metadata.google.internal" ||
      hostname === "instance-data" ||
      // IPv6 literal فقط (يحتوي :) — link-local وULA
      (hostname.includes(":") &&
        (hostname.startsWith("fe80") ||
          hostname.startsWith("fc") ||
          hostname.startsWith("fd")));
    if (isMetadata) {
      logError("❌ تخطي Webhook: عنوان metadata/داخلي محجوب ->", url);
      return;
    }
  } catch (e) {}

  if (!fromServer) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      const isPrivate =
        ["localhost", "127.0.0.1", "::1"].includes(hostname) ||
        hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/);
      const isServerLocal =
        config.serverUrl &&
        (config.serverUrl.includes("localhost") ||
          config.serverUrl.includes("127.0.0.1"));
      if (isPrivate && !isServerLocal) {
        logError("❌ تخطي Webhook: شبكة داخلية ممنوعة ->", url);
        return;
      }
    } catch (e) {}
  }

  let urlsToTry = [];
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === "https:" ? 443 : 80);
    const path = parsed.pathname + parsed.search;
    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      urlsToTry.push({ url: `http://127.0.0.1:${port}${path}`, family: 4 });
      urlsToTry.push({ url: `http://localhost:${port}${path}`, family: 6 });
    } else {
      urlsToTry.push({ url, family: 0 });
    }
  } catch (e) {
    urlsToTry.push({ url, family: 0 });
  }

  if (delayBefore > 0) await new Promise((r) => setTimeout(r, delayBefore));

  const safeRepeat = Math.min(
    MAX_WEBHOOK_REPEAT,
    Math.max(1, parseInt(repeat) || 1),
  );
  const safeInterval = Math.min(
    MAX_INTERVAL_MS,
    Math.max(0, parseInt(interval) || 0),
  );

  let lastError = null;
  let success = false;
  const methodsToTry = ["POST", "GET"];

  for (let i = 0; i < safeRepeat && !success; i++) {
    if (i > 0 && safeInterval > 0)
      await new Promise((r) => setTimeout(r, safeInterval));
    for (const { url: tryUrl, family } of urlsToTry) {
      for (const tryMethod of methodsToTry) {
        try {
          let requestData =
            tryMethod === "POST"
              ? Object.keys(body).length > 0
                ? body
                : {}
              : undefined;
          const isHttps = tryUrl.startsWith("https:");
          const agentOptions = { family: family || 0 };
          const agent = isHttps
            ? new https.Agent(agentOptions)
            : new http.Agent(agentOptions);
          const response = await axios({
            url: tryUrl,
            method: tryMethod,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": "BlackMoon/1.0",
              ...headers,
            },
            data: requestData,
            timeout: 10000,
            httpAgent: !isHttps ? agent : undefined,
            httpsAgent: isHttps ? agent : undefined,
          });
          logMessage(
            `✅ Webhook نجح (${response.status}) - ${tryMethod} ${tryUrl}`,
          );
          success = true;
          break;
        } catch (err) {
          lastError = err;
          const status = err.response?.status;
          if (
            tryMethod === "POST" &&
            (status === 400 || status === 405 || status === 415 || !status)
          ) {
            logMessage(`⚠️ POST فشل (${status}) على ${tryUrl}، نجرب GET...`);
            continue;
          }
          logError(
            `❌ فشل webhook (${tryUrl}) مع ${tryMethod}: ${err.response?.statusText || err.message}`,
          );
          break;
        }
      }
      if (success) break;
    }
  }
  if (!success)
    logError(
      `❌ فشل Webhook بعد ${safeRepeat} محاولات:`,
      lastError?.message || "خطأ غير معروف",
    );
}

// ============================================================
// 6. الاتصال بالسيرفر كـ Agent (معدل لإرسال المفتاح للبلوجن)
// ============================================================
let currentSocket = null;
let isConnecting = false;
let heartbeatInterval = null;

// ===== دالة إرسال المفتاح للبلوجن =====
function sendPluginKeyToServer() {
  if (!currentSocket || !currentSocket.connected) {
    logMessage("⚠️ لا يوجد اتصال لإرسال المفتاح");
    return;
  }

  const keyHex = getPluginMasterKeyHex();
  if (!keyHex) {
    logError("❌ لا يوجد مفتاح لإرساله للبلوجن");
    return;
  }

  currentSocket.emit("plugin-key", { key: keyHex });
  logMessage("🔑 تم إرسال المفتاح الرئيسي للبلوجن");
}

function connectToServer() {
  if (isConnecting) {
    logMessage("⚠️ جاري الاتصال بالفعل، تخطي...");
    return;
  }
  isConnecting = true;
  logMessage("🔍 بدء محاولة الاتصال...");

  if (!config.sessionToken) {
    logMessage("⚠️ لا توجد جلسة، انتظر ربط التوكن من الواجهة.");
    isConnecting = false;
    return;
  }

  if (currentSocket && currentSocket.connected) {
    logMessage("✅ الاتصال موجود بالفعل");
    isConnecting = false;
    return;
  }

  if (currentSocket) {
    try {
      currentSocket.disconnect();
      currentSocket.removeAllListeners();
    } catch (e) {}
    currentSocket = null;
  }

  const wsUrl =
    normalizeServerUrl(config.serverUrl)
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://") + "/agent";

  logMessage(`🔄 محاولة الاتصال بـ ${wsUrl} مع auth token`);

  const socket = io(wsUrl, {
    transports: ["websocket"],
    auth: { token: config.sessionToken, machineId: getMachineId() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 10000,
    pingTimeout: 60000,
    pingInterval: 25000,
    forceNew: true,
  });

  // مراقب الحياة: نبضات السيرفر تصل كباكيتات engine كل ~25 ثانية.
  // وصلة ميتة صامتاً (خادم أعاد تدويره والوكيل لا يشعر) تجعل الأوامر
  // تضيع — نراقب آخر باكيت وصل فعلاً ونفرض إعادة الاتصال عند صمتها
  let lastEnginePacketAt = Date.now();
  try {
    socket.io.engine.on("packet", () => {
      lastEnginePacketAt = Date.now();
    });
  } catch {}

  currentSocket = socket;

  socket.on("connect", () => {
    logMessage("✅ متصل بالخادم (WebSocket) عبر /agent");
    const machineId = getMachineId();
    socket.emit("register", {
      type: "agent",
      machineId: machineId,
    });

    // ✅ إرسال المفتاح للبلوجن عند الاتصال
    setTimeout(() => sendPluginKeyToServer(), 500);

    isConnecting = false;
    lastEnginePacketAt = Date.now();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (!socket.connected) return;
      // لا باكيتات فعلية منذ 75 ثانية (3 فترات نبض) = وصلة ميتة رغم أن
      // socket.connected صادق محلياً — قطع قسري وإعادة اتصال يعيد تسجيلنا
      if (Date.now() - lastEnginePacketAt > 75000) {
        logError("⚠️ صمت تام من السيرفر — إعادة اتصال قسرية لإعادة التسجيل");
        lastEnginePacketAt = Date.now();
        try {
          socket.disconnect();
          socket.connect();
        } catch {}
        return;
      }
      socket.emit("ping", { timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL);
  });

  // ===== مستمع طلب المفتاح من البلوجن =====
  socket.on("request-plugin-key", () => {
    logMessage("📨 استلام طلب المفتاح من البلوجن");
    sendPluginKeyToServer();
  });

  socket.on("execute-keys", async (payload) => {
    logMessage("📨 استلام أمر تنفيذ مفاتيح:", JSON.stringify(payload));
    try {
      await executeKeys(payload.command, payload.repeat, payload.interval);
    } catch (err) {
      logError("❌ خطأ في execute-keys:", err.message);
    }
  });

  socket.on("webhook-request", async (payload) => {
    logMessage(`📨 استلام طلب webhook:`, JSON.stringify(payload));
    await executeWebhook({ ...payload, fromServer: true });
  });

  socket.on("disconnect", (reason) => {
    logMessage(`❌ قطع الاتصال: ${reason}`);
    isConnecting = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });

  socket.on("connect_error", (err) => {
    logError("❌ خطأ اتصال:", err.message);
    isConnecting = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (
      err.message.includes("Invalid session") ||
      err.message.includes("Unauthorized")
    ) {
      logError("❌ جلسة غير صالحة، سيتم مسح التوكن.");
      config.sessionToken = null;
      saveConfig();
      if (currentSocket) {
        currentSocket.disconnect();
        currentSocket = null;
      }
    }
  });

  socket.on("reconnect", (attempt) => {
    logMessage(`🔄 تم إعادة الاتصال (المحاولة ${attempt})`);
    isConnecting = false;
    // إعادة إرسال المفتاح عند إعادة الاتصال
    setTimeout(() => sendPluginKeyToServer(), 500);
  });

  socket.on("reconnect_failed", () => {
    logError("❌ فشل إعادة الاتصال بعد عدة محاولات");
    if (currentSocket) {
      currentSocket.disconnect();
      currentSocket = null;
    }
    setTimeout(connectToServer, 5000);
  });

  socket.on("ping_timeout", () => {
    logMessage("⚠️ مهلة ping، سيتم إعادة الاتصال");
  });

  socket.on("error", (err) => {
    logError("❌ خطأ في socket:", err.message);
  });
}

// ============================================================
// 7. IPC للتواصل مع الواجهة (معدل)
// ============================================================
// التحقق من أن المرسل هو نافذتنا الموثوقة فقط (app:// أو file://)
// يمنع أي سياق آخر (نوافذ بعيدة/iframe) من استدعاء القنوات الحساسة
function isTrustedRenderer(event) {
  try {
    const senderUrl =
      (event.senderFrame && event.senderFrame.url) ||
      (event.sender && event.sender.getURL && event.sender.getURL()) ||
      "";
    return senderUrl.startsWith("app://") || senderUrl.startsWith("file://");
  } catch {
    return false;
  }
}

ipcMain.on("get-server-url-sync", (event) => {
  event.returnValue = normalizeServerUrl(config.serverUrl);
});

// بورت الوسيط المحلي للشاشات/الأوفرلاي (null إن لم يعمل)
ipcMain.on("get-local-proxy-base-sync", (event) => {
  event.returnValue = localProxyPort || null;
});

// بصمة عتاد الجهاز للواجهة (تُرفق مع اتصال Socket.IO لفحص الحظر)
ipcMain.on("get-machine-id-sync", (event) => {
  try {
    event.returnValue = getMachineId();
  } catch {
    event.returnValue = null;
  }
});

// توكن الدخول للواجهة — مصافحة Socket.IO تفحص auth.token والكوكي فقط
// ولا ترى ترويسة Authorization المختومة هنا، فبدون التوكن الصريح تفشل
// المصافحة بـ "No token" وتعطل الأصوات والإشعارات الفورية
ipcMain.on("get-auth-token-sync", (event) => {
  try {
    event.returnValue =
      isTrustedRenderer(event) && config.authToken ? config.authToken : "";
  } catch {
    event.returnValue = "";
  }
});

ipcMain.handle("set-auth-token", (event, token) => {
  if (!isTrustedRenderer(event)) return { success: false };
  config.authToken =
    typeof token === "string" && token.trim() ? token.trim() : null;
  saveConfig();
  return { success: true };
});

// تزامن فوري للتوكن المختوم من كوكي الخادم — تستدعيه الواجهة بعد تجديد
// الجلسة للتأكد من أن إعادة المحاولة تحمل التوكن الطازج لا القديم
ipcMain.handle("sync-auth-token-from-cookie", (event) => {
  if (!isTrustedRenderer(event)) return { success: false, token: null };
  return syncTokenFromCookie();
});

ipcMain.handle("get-agent-status", (event) => {
  if (!isTrustedRenderer(event)) return { connected: false, server: "", hasSession: false };
  return {
    connected: currentSocket?.connected || false,
    server: config.serverUrl,
    hasSession: !!config.sessionToken,
  };
});

// ===== IPC جديد: تشفير ملف للبلوجن =====
ipcMain.handle("encrypt-for-plugin", (event, inputPath, outputPath) => {
  if (!isTrustedRenderer(event)) return false;
  return encryptFileForPlugin(inputPath, outputPath);
});

// ===== IPC جديد: فك تشفير ملف من البلوجن =====
ipcMain.handle("decrypt-from-plugin", (event, inputPath) => {
  if (!isTrustedRenderer(event)) return null;
  return decryptFileFromPlugin(inputPath);
});

// ===== IPC جديد: الحصول على مفتاح البلوجن =====
ipcMain.handle("get-plugin-key", (event) => {
  if (!isTrustedRenderer(event)) return null;
  return getPluginMasterKeyHex();
});

// ===== نافذة الدفع المعزولة =====
let paymentWindow = null;
ipcMain.handle("open-payment-window", (event, token) => {
  if (!isTrustedRenderer(event)) return { success: false };
  const safeToken = String(token || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (paymentWindow) {
    paymentWindow.focus();
    return { success: true };
  }
  paymentWindow = new BrowserWindow({
    width: 620,
    height: 680,
    parent: mainWindow,
    modal: true,
    title: "اشتراك - Stream Moon",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const paymentUrl = `${config.serverUrl.replace(/\/+$/, "")}/payment/index.html`;
  // التوكن في الـ hash (#) بدل الـ query — الـ hash لا يُسجَّل في سجلات السيرفرات/البروكسيات
  paymentWindow.loadURL(
    token ? `${paymentUrl}#token=${encodeURIComponent(safeToken)}` : paymentUrl,
  );
  paymentWindow.on("closed", () => {
    paymentWindow = null;
    if (mainWindow) {
      mainWindow.webContents.send("payment-closed");
    }
  });
  return { success: true };
});

ipcMain.handle("bind-agent-session", async (event, userToken) => {
  if (!isTrustedRenderer(event))
    return { success: false, message: "مصدر غير موثوق" };
  if (!userToken) return { success: false, message: "رمز الجلسة مطلوب" };

  try {
    const bindingUrl = `${config.serverUrl}/api/agent/binding-token`;
    const bindingRes = await axios.get(bindingUrl, {
      headers: { Authorization: `Bearer ${userToken}` },
      timeout: 10000,
    });
    if (!bindingRes.data.success) {
      throw new Error(
        bindingRes.data.message || "فشل الحصول على binding token",
      );
    }
    const bindingToken = bindingRes.data.token;

    const exchangeUrl = `${config.serverUrl}/api/agent/exchange-binding`;
    const exchangeRes = await axios.post(
      exchangeUrl,
      {
        bindingToken: bindingToken,
        machineId: getMachineId(),
      },
      { timeout: 10000 },
    );
    if (!exchangeRes.data.success) {
      throw new Error(exchangeRes.data.message || "فشل تبادل التوكن");
    }
    const sessionToken = exchangeRes.data.sessionToken;

    config.sessionToken = sessionToken;
    saveConfig();
    connectToServer();

    return { success: true };
  } catch (err) {
    logError(`❌ فشل ربط الـ Agent: ${err.message}`);
    return { success: false, message: err.message };
  }
});

// ============================================================
// 7.1 نظام Hotkey
// ============================================================
let hotkeyListeners = {};
let uiohookStarted = false;
const pressedModifiers = new Set();

const MODIFIER_KEYS = {
  Ctrl: ["Ctrl", "CtrlRight"],
  Alt: ["Alt", "AltRight"],
  Shift: ["Shift", "ShiftRight"],
};

function getModifierName(keyName) {
  if (!keyName) return null;
  for (const [mod, names] of Object.entries(MODIFIER_KEYS)) {
    if (names.includes(keyName)) return mod;
  }
  return null;
}

function getKeyName(keycode) {
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (code === keycode) return name;
  }
  return null;
}

// توحيد أسماء المفاتيح مع تسمية منتقي الواجهة — مع فصل كامل لمفاتيح
// النام باد عن توائمها الرئيسية: هوت كي "Num1" يستجيب لنام باد 1 فقط
// و"1" يستجيب لمفتاح 1 الرئيسي فقط (أكواد استماع مختلفة 0x4f مقابل 0x02)
const CANON_KEY_NAMES = {
  Numpad0: "Num0",
  Numpad1: "Num1",
  Numpad2: "Num2",
  Numpad3: "Num3",
  Numpad4: "Num4",
  Numpad5: "Num5",
  Numpad6: "Num6",
  Numpad7: "Num7",
  Numpad8: "Num8",
  Numpad9: "Num9",
  NumpadDecimal: "Num.",
  NumpadSubtract: "Num-",
  NumpadDivide: "Num/",
  NumpadEnter: "NumEnter",
  NumpadAdd: "+",
  NumpadMultiply: "*",
  NumpadArrowUp: "ArrowUp",
  NumpadArrowDown: "ArrowDown",
  NumpadArrowLeft: "ArrowLeft",
  NumpadArrowRight: "ArrowRight",
  NumpadHome: "Home",
  NumpadEnd: "End",
  NumpadPageUp: "PgUp",
  NumpadPageDown: "PgDn",
  NumpadInsert: "Ins",
  NumpadDelete: "Del",
  Period: ".",
  Comma: ",",
  Slash: "/",
  Minus: "-",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Escape: "Esc",
  PrintScreen: "PrtSc",
  ScrollLock: "ScrLk",
  NumLock: "Num",
  Insert: "Ins",
  Delete: "Del",
  PageUp: "PgUp",
  PageDown: "PgDn",
};
function canonKeyName(name) {
  return CANON_KEY_NAMES[name] || name;
}

function startUiohook() {
  if (uiohookStarted) return;
  uiohookStarted = true;

  const heldKeys = new Set();
  uIOhook.on("keyup", (e) => {
    const rawName = getKeyName(e.keycode);
    const keyName = canonKeyName(rawName);
    const mod = getModifierName(rawName);
    if (mod) pressedModifiers.delete(mod);
    if (keyName) heldKeys.delete(keyName);
  });

  uIOhook.on("keydown", (e) => {
    const rawName = getKeyName(e.keycode);
    if (!rawName) return;
    const mod = getModifierName(rawName);
    if (mod) {
      pressedModifiers.add(mod);
      return;
    }
    // التوحيد بعد فحص المعدلات — النام باد 1 يطابق الهوت كي المسجل بـ 1
    const keyName = canonKeyName(rawName);
    if (heldKeys.has(keyName)) return;
    heldKeys.add(keyName);

    const ctrl = e.ctrlKey || pressedModifiers.has("Ctrl");
    const alt = e.altKey || pressedModifiers.has("Alt");
    const shift = e.shiftKey || pressedModifiers.has("Shift");

    let combo = "";
    if (ctrl) combo += "Ctrl+";
    if (alt) combo += "Alt+";
    if (shift) combo += "Shift+";
    combo += keyName;

    const listener = hotkeyListeners[combo];
    if (listener) {
      logMessage(
        `⌨️ Hotkey triggered: ${combo} -> command ${listener.commandId}`,
      );
      mainWindow.webContents.send("hotkey:execute", {
        commandId: listener.commandId,
        commandType: listener.commandType,
      });
    }
  });
  uIOhook.start();
  logMessage("✅ uIOhook started for global hotkeys");
}

ipcMain.handle("hotkey:register", (event, combo, commandId, commandType) => {
  if (!isTrustedRenderer(event)) return { success: false };
  if (hotkeyListeners[combo]) {
    logMessage(`⚠️ Hotkey ${combo} already registered, replacing`);
  }
  hotkeyListeners[combo] = { commandId, commandType };
  startUiohook();
  return { success: true };
});

ipcMain.handle("hotkey:unregister", (event, combo) => {
  if (!isTrustedRenderer(event)) return { success: false };
  if (hotkeyListeners[combo]) {
    delete hotkeyListeners[combo];
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle("hotkey:unregisterAll", () => {
  hotkeyListeners = {};
  return { success: true };
});

// ============================================================
// 8. نافذة Electron الرئيسية + التحديث التلقائي
// ============================================================
let mainWindow;

function initAutoUpdater() {
  if (!app.isPackaged) {
    logMessage("ℹ️ بيئة تطوير محلي: تم تعطيل Auto-Updater.");
    createWindow();
    return;
  }

  autoUpdater.setFeedURL({
    provider: "github",
    owner: "captenblank1",
    repo: "Stream-Moon-Program",
  });

  autoUpdater.verifyUpdateCodeSignature = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  let mainOpened = false;
  const openMainWindow = () => {
    if (mainOpened) return;
    mainOpened = true;
    closeUpdateSplash();
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  };
  const safetyTimer = setTimeout(openMainWindow, 90000);

  autoUpdater.on("checking-for-update", () => {
    logMessage("🔍 جاري التحقق من وجود تحديثات جديدة...");
  });

  autoUpdater.on("update-available", (info) => {
    logMessage(`🔄 يتوفر تحديث جديد (${info.version})، جاري التحميل...`);
    createUpdateSplash(info.version);
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    logMessage(`⬇️ تحميل التحديث: ${percent}%`);
    updateSplashProgress(percent);
  });

  autoUpdater.on("update-not-available", () => {
    logMessage("✅ التطبيق يعمل بأحدث إصدار.");
    clearTimeout(safetyTimer);
    openMainWindow();
  });

  autoUpdater.on("update-downloaded", (info) => {
    logMessage(
      `✅ تم تحميل التحديث (${info.version}) - سيتم تثبيت التحديث وإعادة التشغيل.`,
    );
    updateSplashProgress(100, "جاري تثبيت التحديث وإعادة التشغيل...");

    setImmediate(() => {
      clearTimeout(safetyTimer);
      closeUpdateSplash();

      logMessage("🔄 استدعاء quitAndInstall...");
      autoUpdater.quitAndInstall(false, false);

      setTimeout(() => {
        if (process.platform === "win32") {
          logMessage("⚠️ quitAndInstall لم ينجح، محاولة إعادة تشغيل يدوية...");
          app.relaunch();
          app.exit(0);
        }
      }, 5000);
    });
  });

  autoUpdater.on("error", (err) => {
    logError("❌ فشل التحديث التلقائي:", err.message);
    clearTimeout(safetyTimer);
    openMainWindow();
  });

  autoUpdater.on("quit-and-install", () => {
    logMessage("🔄 جاري إنهاء التطبيق وبدء التثبيت...");
  });

  autoUpdater.checkForUpdates();
}

// ============================================================
// 8.1 شاشة التحديث
// ============================================================
let updateSplashWindow = null;

function createUpdateSplash(version) {
  if (updateSplashWindow) return;
  updateSplashWindow = new BrowserWindow({
    width: 440,
    height: 220,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: path.join(__dirname, "icon.ico"),
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8">
<style>
  body { font-family: Tahoma, Arial, sans-serif; background: #141a26; color: #fff;
         display: flex; flex-direction: column; align-items: center; justify-content: center;
         height: 100vh; margin: 0; user-select: none; }
  h2 { margin: 0 0 6px; font-size: 17px; }
  p { margin: 0 0 16px; color: #9fb0c9; font-size: 13px; }
  .bar { width: 320px; height: 10px; background: #2a3345; border-radius: 6px; overflow: hidden; }
  .bar > div { width: 0%; height: 100%; background: linear-gradient(90deg,#4f8cff,#28c76f);
               border-radius: 6px; transition: width .2s; }
  #pct { margin-top: 10px; font-size: 13px; color: #9fb0c9; }
</style></head>
<body>
  <h2>🔄 Stream Moon — تحديث جديد</h2>
  <p>جاري تحميل الإصدار ${version} — بعد الانتهاء، ستظهر نافذة التثبيت لتأكيد التحديث</p>
  <div class="bar"><div id="fill"></div></div>
  <div id="pct">0%</div>
</body></html>`;
  updateSplashWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(html),
  );
  updateSplashWindow.on("closed", () => {
    updateSplashWindow = null;
  });
}

function updateSplashProgress(percent, text) {
  if (!updateSplashWindow || updateSplashWindow.isDestroyed()) return;
  // تمرير القيم عبر JSON.stringify — يمنع حقن كود من أي قيمة مستقبل
  const label = String(text || `${percent}%`);
  const safePercent = String(Math.round(Number(percent) || 0));
  updateSplashWindow.webContents
    .executeJavaScript(
      `document.getElementById('fill').style.width=${JSON.stringify(safePercent + "%")};
       document.getElementById('pct').textContent=${JSON.stringify(label)};`,
    )
    .catch(() => {});
}

function closeUpdateSplash() {
  if (updateSplashWindow && !updateSplashWindow.isDestroyed()) {
    updateSplashWindow.destroy();
  }
  updateSplashWindow = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    maximized: true,
    icon: path.join(__dirname, "icon.ico"),
    menu: null,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  // بعض أنظمة ويندوز تتجاهل maximized:true عند الإنشاء — نكبّر صراحةً
  // بعد التحميل لضمان ملء الشاشة دائماً
  mainWindow.once("ready-to-show", () => {
    try {
      if (!mainWindow.isMaximized()) mainWindow.maximize();
    } catch {}
  });
  mainWindow.loadURL("app://s/index.html");

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://") && !url.startsWith("file://"))
      event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // فتح الروابط الخارجية في المتصفح — بروتوكولات http/https فقط،
    // ما عداها (file://, smb://, ms-msdt:, chrome://...) يُرفض نهائياً
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    } else {
      logMessage(`⛔ تم حظر فتح رابط ببروتوكول غير مسموح: ${url}`);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-attach-webview", (event, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============================================================
// 9. قفل التشغيل
// ============================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ============================================================
// 10. تشغيل التطبيق
// ============================================================
app.whenReady().then(async () => {
  initPaths();
  loadLegacyKeyForMigration();
  loadConfig();

  // ✅ تحميل أو إنشاء المفتاح الرئيسي للبلوجن (تخزين محمي)
  loadOrCreatePluginMasterKey();

  // 🧹 تنظيف أثر الترحيل: حذف ملف المفتاح القديم بالنص الصريح ومسح المفتاح من الذاكرة
  try {
    if (fs.existsSync(KEY_FILE)) {
      fs.unlinkSync(KEY_FILE);
      logMessage("🧹 تم حذف ملف مفتاح التشفير القديم (لم يعد لازماً)");
    }
  } catch (_) {}
  if (legacyEncryptionKey) {
    try {
      legacyEncryptionKey.fill(0);
    } catch (_) {}
    legacyEncryptionKey = null;
  }

  // ===== حماية كل النوافذ/المحتويات التي تُنشأ لاحقاً =====
  // منع فتح نوافذ ببروتوكولات خطيرة (file:, chrome:, javascript:) من أي محتوى،
  // والإبقاء على http/https فقط بالسلوك الافتراضي
  app.on("web-contents-created", (event, contents) => {
    try {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) return { action: "allow" };
        logMessage(`⛔ تم حظر فتح نافذة ببروتوكول غير مسموح: ${url}`);
        return { action: "deny" };
      });
      contents.on("will-navigate", (e, url) => {
        if (/^(file:|chrome:|chrome-extension:|javascript:|data:)/i.test(url)) {
          // data: مسموح فقط لشاشة التحديث الداخلية (تُنشأ من كودنا)
          const isOwnDataSplash =
            url.startsWith("data:") &&
            contents === (updateSplashWindow && updateSplashWindow.webContents);
          if (!isOwnDataSplash) {
            e.preventDefault();
            logMessage(`⛔ تم حظر تنقل لبروتوكول غير مسموح: ${url}`);
          }
        }
      });
    } catch {}
  });

  logMessage("✅ تم التهيئة باستخدام robotjs");

  // تسخين مساعد VK مسبقاً: أول PowerShell يستهلك 1-3 ثوان في Add-Type
  // وبدون هذا يتأخر أول كومبو (أو يبدو أنه لم ينفذ)
  setTimeout(() => {
    try {
      const p = getPsKbdHelper();
      if (p) logMessage("🔥 تم تسخين مساعد VK للكيبورد");
    } catch {}
  }, 3000);

  // الوسيط المحلي: يعرض الشاشات/الأوفرلاي عبر 127.0.0.1 بدل الخادم
  startLocalProxy();

  // بصمة عتاد الجهاز تُرفق تلقائياً بكل طلبات الواجهة إلى الخادم —
  // طبقة حظر لا تنكسر بمسح بيانات المتصفح أو إعادة تثبيت البرنامج.
  // ومعها توكن الدخول: يُحقن من هنا ولا يمر عبر الواجهة/المتصفح إطلاقاً.
  try {
    const serverBase = normalizeServerUrl(
      config.serverUrl || DEFAULT_SERVER_URL,
    ).replace(/\/+$/, "");
    const MACHINE_FINGERPRINT = getMachineId();
    // مسارات لا يُحقن فيها التوكن: الدخول/التسجيل (لا مصادقة) والتجديد
    // (يجب أن يعتمد على الكوكي وحده — التوكن القديم قد يكون ملغى/منتهياً)
    const NO_TOKEN_PATHS = [
      "/api/auth/refresh",
      "/api/auth/login",
      "/api/auth/register",
    ];
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`${serverBase}/*`] },
      (details, callback) => {
        try {
          details.requestHeaders["x-machine-id"] = MACHINE_FINGERPRINT;
          details.requestHeaders["x-machine-id-legacy"] = getLegacyMachineId();
          const hasOwnAuth =
            details.requestHeaders["Authorization"] ||
            details.requestHeaders["authorization"];
          const skipToken =
            hasOwnAuth ||
            NO_TOKEN_PATHS.some((p) => details.url.includes(p));
          if (config.authToken && !skipToken) {
            details.requestHeaders["Authorization"] =
              `Bearer ${config.authToken}`;
          }
        } catch {}
        callback({ requestHeaders: details.requestHeaders });
      },
    );

    // إبقاء التوكن المختوم طازجاً: بعد أي عملية دخول/تجديد يضبط الخادم
    // كوكي httpOnly — syncTokenFromCookie تقرأه وتعيد الختم تلقائياً
    session.defaultSession.webRequest.onCompleted(
      { urls: [`${serverBase}/api/auth/*`] },
      () => {
        syncTokenFromCookie();
      },
    );
    // مزامنة أولية عند الإقلاع (لو الخادم جدد الكوكي أثناء غلق البرنامج)
    setTimeout(syncTokenFromCookie, 3000);

    logMessage("✅ تفعيل بصمة العتاد والتوكن المختوم على طلبات الشبكة");
  } catch (e) {
    logError("⚠️ تعذر تفعيل بصمة العتاد للطلبات:", e.message);
  }

  if (config.sessionToken) {
    setTimeout(connectToServer, 1000);
  } else {
    logMessage("⏳ في انتظار ربط الجلسة من الواجهة...");
  }

  registerAppProtocol();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ============================================================
// 11. إيقاف التطبيق
// ============================================================
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (currentSocket) {
      currentSocket.disconnect();
      currentSocket.removeAllListeners();
      currentSocket = null;
    }
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    hotkeyListeners = {};
    pressedModifiers.clear();
    if (uiohookStarted) {
      try {
        uIOhook.stop();
      } catch (e) {}
      uiohookStarted = false;
    }
    app.quit();
  }
});
