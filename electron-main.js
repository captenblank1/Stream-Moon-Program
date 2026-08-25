// electron-main.js - Agent مدمج بالكامل (مع robotjs + autoUpdater + Hotkey + تشفير البلوجن)
// ============================================================

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  protocol,
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
const DEFAULT_SERVER_URL = "https://backend-7hj8.onrender.com";
const LEGACY_SERVER_URLS = [
  "backend-production-484d.up.railway.app",
  "streammoon.onrender.com",
];

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
let encryptionKey = null;
let config = {
  serverUrl: DEFAULT_SERVER_URL,
  sessionToken: null,
};

// ===== متغيرات المفتاح الرئيسي للبلوجن =====
let pluginMasterKey = null;

function loadOrCreateKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      encryptionKey = Buffer.from(fs.readFileSync(KEY_FILE, "utf8"), "hex");
    } else {
      encryptionKey = crypto.randomBytes(32);
      fs.writeFileSync(KEY_FILE, encryptionKey.toString("hex"));
    }
  } catch (e) {
    encryptionKey = crypto.randomBytes(32);
    logError("⚠️ تعذّر حفظ مفتاح التشفير، سيتم استخدام مفتاح مؤقت.");
  }
}

function encrypt(text) {
  if (!text || !encryptionKey) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedData) {
  if (!encryptedData || !encryptionKey) return null;
  const parts = encryptedData.split(":");
  if (parts.length !== 2) return null;
  const iv = Buffer.from(parts[0], "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
  let decrypted = decipher.update(parts[1], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function getMachineId() {
  try {
    if (fs.existsSync(MACHINE_ID_FILE)) {
      return fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
    }
  } catch (_) {}
  const raw = [
    os.hostname(),
    (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || "unknown",
    os.platform(),
    os.arch(),
    os.totalmem(),
    process.env.COMPUTERNAME || "",
  ].join("|");
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
      config.sessionToken = data.sessionToken
        ? decrypt(data.sessionToken)
        : null;
      config.serverUrl = data.serverUrl
        ? normalizeServerUrl(data.serverUrl)
        : DEFAULT_SERVER_URL;
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
    const toSave = { serverUrl: config.serverUrl };
    toSave.sessionToken = config.sessionToken
      ? encrypt(config.sessionToken)
      : null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    logError("❌ فشل حفظ الإعدادات:", e.message);
  }
}

// توليد مفتاح من Machine ID (نفس طريقة Java)
function generateKeyFromMachineId() {
  const machineId = getMachineId();
  const seed = machineId + "StreamMoon2024SecureKey";
  return crypto.createHash("sha256").update(seed).digest();
}

// توليد أو تحميل المفتاح الرئيسي للبلوجن
function loadOrCreatePluginMasterKey() {
  try {
    // محاولة قراءة المفتاح المشفر
    if (fs.existsSync(PLUGIN_KEY_FILE)) {
      const encryptedData = fs.readFileSync(PLUGIN_KEY_FILE);

      // استخراج IV والبيانات المشفرة
      const iv = encryptedData.subarray(0, 16);
      const ciphertext = encryptedData.subarray(16);

      // توليد مفتاح فك التشفير من Machine ID
      const key = generateKeyFromMachineId();

      // فك التشفير
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      pluginMasterKey = decrypted;
      logMessage("🔑 تم تحميل المفتاح الرئيسي للبلوجن من الملف");
      return;
    }
  } catch (error) {
    logError("⚠️ فشل تحميل المفتاح الرئيسي:", error.message);
  }

  // ✅ إنشاء مفتاح جديد من Machine ID (بدلاً من Random)
  pluginMasterKey = generateKeyFromMachineId();
  savePluginMasterKeyEncrypted();
  logMessage("🔑 تم إنشاء مفتاح رئيسي جديد من Machine ID");
}

// حفظ المفتاح الرئيسي مشفراً
function savePluginMasterKeyEncrypted() {
  try {
    // توليد مفتاح تشفير من Machine ID
    const key = generateKeyFromMachineId();

    // تشفير المفتاح الرئيسي
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(pluginMasterKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // حفظ: IV + البيانات المشفرة
    const finalBuffer = Buffer.concat([iv, encrypted]);
    fs.writeFileSync(PLUGIN_KEY_FILE, finalBuffer);

    logMessage("💾 تم حفظ المفتاح الرئيسي للبلوجن مشفراً");
  } catch (error) {
    logError("❌ فشل حفظ المفتاح الرئيسي:", error.message);
  }
}

// الحصول على المفتاح الرئيسي (لإرساله للبلوجن)
function getPluginMasterKeyHex() {
  if (!pluginMasterKey) {
    loadOrCreatePluginMasterKey();
  }
  return pluginMasterKey ? pluginMasterKey.toString("hex") : null;
}
// حفظ المفتاح الرئيسي مشفراً
function savePluginMasterKeyEncrypted() {
  try {
    // توليد مفتاح تشفير من Machine ID
    const key = generateKeyFromMachineId();

    // تشفير المفتاح الرئيسي
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(pluginMasterKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // حفظ: IV + البيانات المشفرة
    const finalBuffer = Buffer.concat([iv, encrypted]);
    fs.writeFileSync(PLUGIN_KEY_FILE, finalBuffer);

    logMessage("💾 تم حفظ المفتاح الرئيسي للبلوجن مشفراً");
  } catch (error) {
    logError("❌ فشل حفظ المفتاح الرئيسي:", error.message);
  }
}

// الحصول على المفتاح الرئيسي (لإرساله للبلوجن)
function getPluginMasterKeyHex() {
  if (!pluginMasterKey) {
    loadOrCreatePluginMasterKey();
  }
  return pluginMasterKey ? pluginMasterKey.toString("hex") : null;
}

// حفظ المفتاح الرئيسي مشفراً
function savePluginMasterKeyEncrypted() {
  try {
    // توليد مفتاح تشفير من Machine ID
    const machineId = getMachineId();
    const key = crypto
      .createHash("sha256")
      .update(machineId + "StreamMoon2024SecureKey")
      .digest();

    // تشفير المفتاح الرئيسي
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(pluginMasterKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // حفظ: IV + البيانات المشفرة
    const finalBuffer = Buffer.concat([iv, encrypted]);
    fs.writeFileSync(PLUGIN_KEY_FILE, finalBuffer);

    logMessage("💾 تم حفظ المفتاح الرئيسي للبلوجن مشفراً");
  } catch (error) {
    logError("❌ فشل حفظ المفتاح الرئيسي:", error.message);
  }
}

// الحصول على المفتاح الرئيسي (لإرساله للبلوجن)
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

function logMessage(...msg) {
  const line = `[${new Date().toISOString()}] ${msg.join(" ")}`;
  rotateLog(LOG_FILE);
  fs.appendFileSync(LOG_FILE, line + "\n");
  safeConsoleLog(line);
}

function logError(...msg) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg.join(" ")}`;
  rotateLog(LOG_FILE);
  rotateLog(ERROR_LOG_FILE);
  fs.appendFileSync(LOG_FILE, line + "\n");
  fs.appendFileSync(ERROR_LOG_FILE, line + "\n");
  safeConsoleError(line);
}

// ============================================================
// 4. تنفيذ المفاتيح باستخدام robotjs
// ============================================================

const ROBOT_MODIFIERS = { Ctrl: "control", Alt: "alt", Shift: "shift" };
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
  Win: "command",
};

function parseCombo(str) {
  if (typeof str !== "string" || !str) return null;
  const parts = str.split("+").map((p) => p.trim());
  const key = parts.pop();
  const modifiers = [];
  for (const p of parts) {
    const m = ROBOT_MODIFIERS[p];
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

async function sendComboViaRobot(combo) {
  try {
    logMessage(
      `⌨️ ضغط كومبو حقيقي: ${combo.modifiers.join("+")}${combo.modifiers.length ? "+" : ""}${combo.key}`,
    );
    robot.keyTap(combo.key, combo.modifiers);
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

  if (/^[#!^+]/.test(keys)) {
    logError(`⛔ تم حظر أمر يحتوي على مفتاح نظامي: ${keys}`);
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
    else await sendKeysViaRobot(keys);
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

  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    logError("❌ تخطي Webhook: رابط غير صالح ->", url);
    return;
  }

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
    auth: { token: config.sessionToken },
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
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (socket.connected) socket.emit("ping", { timestamp: Date.now() });
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
ipcMain.on("get-server-url-sync", (event) => {
  event.returnValue = normalizeServerUrl(config.serverUrl);
});

ipcMain.handle("get-agent-status", () => {
  return {
    connected: currentSocket?.connected || false,
    server: config.serverUrl,
    hasSession: !!config.sessionToken,
  };
});

// ===== IPC جديد: تشفير ملف للبلوجن =====
ipcMain.handle("encrypt-for-plugin", (event, inputPath, outputPath) => {
  return encryptFileForPlugin(inputPath, outputPath);
});

// ===== IPC جديد: فك تشفير ملف من البلوجن =====
ipcMain.handle("decrypt-from-plugin", (event, inputPath) => {
  return decryptFileFromPlugin(inputPath);
});

// ===== IPC جديد: الحصول على مفتاح البلوجن =====
ipcMain.handle("get-plugin-key", () => {
  return getPluginMasterKeyHex();
});

// ===== نافذة الدفع المعزولة =====
let paymentWindow = null;
ipcMain.handle("open-payment-window", (event, token) => {
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
  paymentWindow.loadURL(
    token ? `${paymentUrl}?token=${encodeURIComponent(safeToken)}` : paymentUrl,
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

function startUiohook() {
  if (uiohookStarted) return;
  uiohookStarted = true;

  const heldKeys = new Set();
  uIOhook.on("keyup", (e) => {
    const keyName = getKeyName(e.keycode);
    const mod = getModifierName(keyName);
    if (mod) pressedModifiers.delete(mod);
    if (keyName) heldKeys.delete(keyName);
  });

  uIOhook.on("keydown", (e) => {
    const keyName = getKeyName(e.keycode);
    if (!keyName) return;
    const mod = getModifierName(keyName);
    if (mod) {
      pressedModifiers.add(mod);
      return;
    }
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
  if (hotkeyListeners[combo]) {
    logMessage(`⚠️ Hotkey ${combo} already registered, replacing`);
  }
  hotkeyListeners[combo] = { commandId, commandType };
  startUiohook();
  return { success: true };
});

ipcMain.handle("hotkey:unregister", (event, combo) => {
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
  const label = text || `${percent}%`;
  updateSplashWindow.webContents
    .executeJavaScript(
      `document.getElementById('fill').style.width='${percent}%';
       document.getElementById('pct').textContent='${label}';`,
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
    icon: path.join(__dirname, "icon.ico"),
    menu: null,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  mainWindow.loadURL("app://s/index.html");

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://") && !url.startsWith("file://"))
      event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("file://")) {
      require("electron").shell.openExternal(url);
      return { action: "deny" };
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
  loadOrCreateKey();
  loadConfig();

  // ✅ تحميل أو إنشاء المفتاح الرئيسي للبلوجن
  loadOrCreatePluginMasterKey();

  logMessage("✅ تم التهيئة باستخدام robotjs");

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
