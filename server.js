// ============================================================
// server.js - الإصدار المُحسَّن بالكامل (مع إصلاح الذاكرة والأداء)
// ============================================================

require("dotenv").config();
const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL && process.env.NODE_ENV === "production") {
  console.error("❌ FRONTEND_URL must be set in production");
  process.exit(1);
}

// ================ الاستيرادات ================
const { TikTokLiveConnection, WebcastEvent } = require("tiktok-live-connector");
const Rcon = require("rcon");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const bodyParser = require("body-parser");
const path = require("path");
const mongoose = require("mongoose");
const fs = require("fs");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const paypal = require("@paypal/checkout-server-sdk");
const { fileTypeFromBuffer } = require("file-type");
const cron = require("node-cron");
const winston = require("winston");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;
const nodeKeySender = require("node-key-sender");
const { exec } = require("child_process");
const NodeCache = require("node-cache");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // الحد الأقصى للطلبات من IP واحد
  message: { success: false, message: "عدد الطلبات كبير جداً، حاول لاحقاً" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ================ إعدادات البيئة ================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET must be set in .env");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tiktokApp_new";
const PLUGIN_SECRET = process.env.PLUGIN_SECRET;
if (!PLUGIN_SECRET) throw new Error("PLUGIN_SECRET must be set in .env");
const BLACKMOON_KEY = process.env.BLACKMOON_KEY || null;

// ================ إعدادات ثابتة ================
const MAX_PROFILES = 20;
const DEFAULT_COMMAND_DELAY_MS = 100;
const LIKE_MAX_DELTA = 500;
const MAX_AUDIO_MB = 1000;
const MAX_VIDEO_MB = 10000;
const WARNING_HOURS = 24;
const GRACE_HOURS = 48;
const DEFAULT_RCON_HOST = process.env.RCON_HOST || "127.0.0.1";
const DEFAULT_RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const DEFAULT_RCON_PASSWORD = process.env.RCON_PASSWORD || "change_me";
const DEFAULT_RCON_PLAYER = process.env.RCON_PLAYER || "Player";
const CACHE_TTL = 3600; // 1 ساعة
const CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 دقيقة

let lastLikeCount = new Map();

function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}

// ================ السجلات ================
const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "error" : "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});
if (NODE_ENV === "production") {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
}

// ================ تهيئة node-key-sender ================
let keySenderReady = false;
if (process.platform === "win32") {
  try {
    const nircmdPath = path.join(__dirname, "nircmd.exe");
    if (fs.existsSync(nircmdPath)) {
      nodeKeySender.setOption("nircmdPath", nircmdPath);
      keySenderReady = true;
      console.log("✅ node-key-sender مع nircmd جاهز (Windows only)");
    } else {
      console.warn("⚠️ nircmd.exe غير موجود");
    }
  } catch (err) {
    console.error("❌ فشل تحميل node-key-sender:", err.message);
  }
} else {
  console.log(
    "ℹ️ تم تعطيل node-key-sender على Linux - سيتم الاعتماد على Agent المحلي فقط",
  );
  keySenderReady = false;
}

// ================ دوال node-key-sender ================
async function executeNativeKeystroke(keys, repeat = 1, intervalMs = 500) {
  // تنظيف المدخلات
  const sanitizedKeys = sanitizeKeystroke(keys);
  if (!sanitizedKeys || sanitizedKeys.length === 0) {
    logger.warn("⛔ تم تجاهل كيستروك غير صالح (فارغ بعد التنقية)");
    return false;
  }

  if (!keySenderReady) {
    logger.error("node-key-sender غير جاهز");
    return false;
  }

  const nircmdPath = path.join(__dirname, "nircmd.exe");
  let nircmdKeys = sanitizedKeys.toLowerCase().replace(/\+/g, "+");

  const sendOnce = () => {
    return new Promise((resolve) => {
      exec(`"${nircmdPath}" sendkeypress ${nircmdKeys}`, (error) => {
        if (error) {
          logger.error(`فشل تنفيذ nircmd: ${error.message}`);
          resolve(false);
        } else {
          logger.info(`⌨️ تم تنفيذ كيستروك: ${sanitizedKeys}`);
          resolve(true);
        }
      });
    });
  };

  // تنفيذ الكيستروك مع التكرار والفاصل الزمني
  if (repeat <= 1) {
    await sendOnce();
  } else {
    for (let i = 0; i < repeat; i++) {
      if (i > 0 && intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      await sendOnce();
    }
  }

  return true;
}

// دالة تنقية خاصة بأوامر الكيستروك (للسماح فقط بالأحرف الآمنة)
function sanitizeKeystroke(input) {
  if (!input || typeof input !== "string") return "";
  // السماح فقط: حروف (إنجليزية وعربية)، أرقام، مسافات، +، -، =، أقواس، وعلامات الترقيم البسيطة.
  // هذا يمنع أي أحرف خطيرة مثل ; | & $ ( ) ` \n \r
  return input.replace(/[^a-zA-Z0-9\u0600-\u06FF\s+\-=(){}[\].,;:!?]/g, "");
}

// ================ إعدادات PayPal ================
function paypalEnvironment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.warn("⚠️ PayPal credentials not set. Using dummy environment.");
    return new paypal.core.SandboxEnvironment("dummy", "dummy");
  }
  if (process.env.PAYPAL_MODE === "live") {
    return new paypal.core.LiveEnvironment(clientId, clientSecret);
  } else {
    return new paypal.core.SandboxEnvironment(clientId, clientSecret);
  }
}
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment());

// ================ مدير الحالة المركزية ================
class AppState {
  constructor() {
    // استخدام NodeCache مع TTL تلقائي
    this.cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

    // مخازن مؤقتة بصلاحيات مختلفة
    this.tempStores = {
      executedOncePerLive: new NodeCache({ stdTTL: 3600, checkperiod: 120 }),
      likeCounters: new NodeCache({ stdTTL: 3600, checkperiod: 120 }),
      giftStreakState: new NodeCache({ stdTTL: 15, checkperiod: 5 }),
      userAvatarCache: new NodeCache({ stdTTL: 3600, checkperiod: 300 }),
      userInfoCache: new NodeCache({ stdTTL: 3600, checkperiod: 300 }),
      interactionCooldown: new NodeCache({ stdTTL: 5, checkperiod: 1 }),
    };

    // الاتصالات والمقابس (تحتاج تحكم يدوي)
    this.userTikTokConnections = new Map();
    this.userRconInstances = new Map();
    this.pluginSockets = new Set();
    this.userLocalAgents = new Map();
    this.agentRegistrationTokens = new Map();
    this.bindingTokens = new Map();
    this.heartbeats = new Map(); // لتخزين معرفات المؤقتات
    this.executingCommands = new Map(); // لمنع التكرار اليدوي
    this.liveHeartbeats = new Map(); // (سيتم استخدام heartbeats بدلاً منه)
  }

  // طرق مساعدة للوصول للمخازن
  getCache(key) {
    return this.cache.get(key);
  }
  setCache(key, value) {
    this.cache.set(key, value);
  }
  delCache(key) {
    this.cache.del(key);
  }

  getTemp(store, key) {
    const st = this.tempStores[store];
    return st ? st.get(key) : null;
  }
  setTemp(store, key, value, ttl = CACHE_TTL) {
    const st = this.tempStores[store];
    if (st) st.set(key, value, ttl);
  }
  delTemp(store, key) {
    const st = this.tempStores[store];
    if (st) st.del(key);
  }

  // تنظيف دوري للخرائط التي لا يديرها cache
  cleanup() {
    const now = Date.now();
    // تنظيف اتصالات TikTok القديمة
    for (const [userId, conn] of this.userTikTokConnections) {
      if (
        !conn.isLive &&
        conn.lastActivity &&
        now - conn.lastActivity > 600000
      ) {
        this.deleteTikTokConnection(userId);
      }
    }
    // تنظيف رموز التسجيل المنتهية
    for (const [token, data] of this.agentRegistrationTokens) {
      if (data.expires < now) this.agentRegistrationTokens.delete(token);
    }
    for (const [token, data] of this.bindingTokens) {
      if (data.expires < now) this.bindingTokens.delete(token);
    }
    // تنظيف المقابس الميتة
    for (const socket of this.pluginSockets) {
      if (!socket.connected) this.pluginSockets.delete(socket);
    }
  }

  deleteTikTokConnection(userId) {
    const conn = this.userTikTokConnections.get(userId);
    if (conn && conn.connection) {
      try {
        conn.connection.removeAllListeners();
        conn.connection.disconnect();
      } catch (e) {}
      if (this.heartbeats.has(userId)) {
        clearInterval(this.heartbeats.get(userId));
        this.heartbeats.delete(userId);
      }
    }
    this.userTikTokConnections.delete(userId);
    // حذف البيانات المؤقتة
    this.delTemp("executedOncePerLive", userId);
    this.delTemp("likeCounters", userId);
    this.delTemp("giftStreakState", userId);
    // حذف الكاش الخاص بالمستخدم
    this.delCache(`gifts:${userId}`);
    this.delCache(`interactions:${userId}`);
  }
}

const state = new AppState();

// ================ دوال مساعدة لإدارة الاتصالات ================
function getTikTokConnection(userId) {
  return state.userTikTokConnections.get(userId);
}
function setTikTokConnection(userId, conn) {
  state.userTikTokConnections.set(userId, conn);
}
function deleteTikTokConnection(userId) {
  state.deleteTikTokConnection(userId);
}

// ================ إعدادات Express ================
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

// قائمة المواقع المسموح بها
const allowedOrigins = [
  "https://streammoon.net",
  "https://www.streammoon.net",
  "https://streammoon.onrender.com",
  "https://backend-7hj8.onrender.com",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
  pingInterval: 25000, // إرسال نبضة كل 25 ثانية
  pingTimeout: 120000, // اعتبر الاتصال مقطوعاً بعد 60 ثانية
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  }),
);

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use("/audios", express.static(path.join(__dirname, "audios")));
app.use(cookieParser());
app.use((req, res, next) => {
  req.setTimeout(30 * 1000);
  next();
});

const authenticateToken = async (req, res, next) => {
  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers["authorization"];
    token = authHeader && authHeader.split(" ")[1];
  }
  if (!token)
    return res.status(401).json({ success: false, message: "لا يوجد توكن" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      // محاولة تجديد التوكن (إذا كان لدى المستخدم صلاحية)
      try {
        const oldDecoded = jwt.decode(token);
        if (oldDecoded && oldDecoded.id) {
          const user = await User.findById(oldDecoded.id);
          if (user) {
            const newToken = jwt.sign(
              {
                id: user._id,
                email: user.email,
                plan: user.plan,
                planType: user.planType,
                role: user.role,
              },
              JWT_SECRET,
              { expiresIn: JWT_EXPIRES_IN },
            );
            res.cookie("token", newToken, {
              httpOnly: true,
              secure: true,
              sameSite: "none",
              maxAge: 30 * 24 * 60 * 60 * 1000,
            });
            req.user = {
              id: user._id,
              email: user.email,
              plan: user.plan,
              planType: user.planType,
              role: user.role,
            };
            return next();
          }
        }
      } catch (refreshErr) {
        logger.error("فشل تجديد التوكن:", refreshErr.message);
      }
    }
    return res.status(403).json({ success: false, message: "توكن غير صالح" });
  }
};

const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "مستخدم غير موجود" });
    if (user.role !== "admin")
      return res.status(403).json({ success: false, message: "غير مصرح به" });
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================ الاتصال بقاعدة البيانات ================
mongoose
  .connect(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 45000,
  })
  .then(async () => {
    logger.info("✅ متصل بـ MongoDB");
    const db = mongoose.connection.db;
    try {
      const collections = await db.listCollections().toArray();
      const usersCollectionExists = collections.some((c) => c.name === "users");
      if (usersCollectionExists) {
        await db
          .collection("users")
          .updateMany({}, { $unset: { username: "" } });
        const oldIndexNames = ["username_1", "screenToken_1"];
        for (const indexName of oldIndexNames) {
          try {
            await db.collection("users").dropIndex(indexName);
          } catch (err) {
            if (!err.message.includes("index not found")) {
              logger.warn(`⚠️ فشل حذف الفهرس ${indexName}:`, err.message);
            }
          }
        }
      }
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await db
        .collection("users")
        .createIndex({ screenToken: 1 }, { unique: true, sparse: true });
      await db
        .collection("users")
        .createIndex({ machineId: 1 }, { unique: true, sparse: true });
      await db
        .collection("giftcommands")
        .createIndex({ userId: 1, profile: 1 });
      await db
        .collection("interactioncommands")
        .createIndex({ userId: 1, profile: 1 });
      await db
        .collection("profiles")
        .createIndex({ owner: 1, id: 1 }, { unique: true });
      logger.info("✅ تم إنشاء الفهارس");
    } catch (err) {
      logger.warn("⚠️ فشل إنشاء بعض الفهارس:", err.message);
    }
    await seedGiftsIfNeeded();
  })
  .catch((err) => logger.error("❌ فشل الاتصال بـ MongoDB:", err));

// ================ تعريف Schemas ================
const agentSessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expires: { type: Date, required: true, index: { expires: 0 } }, // TTL: يحذف تلقائياً بعد انتهاء الصلاحية
  },
  { timestamps: true },
);
const AgentSession = mongoose.model("AgentSession", agentSessionSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  plan: { type: String, enum: ["free", "paid"], default: "free" },
  planType: { type: String, enum: ["monthly", "yearly", null], default: null },
  subscriptionExpiry: { type: Date, default: null },
  subscriptionGracePeriodEnd: { type: Date, default: null },
  subscriptionWarningSent: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  tiktokUsername: { type: String, default: null },
  screenToken: { type: String, unique: true, sparse: true },
  selectedProfile: { type: Number, default: 1, min: 1, max: MAX_PROFILES },
  createdAt: { type: Date, default: Date.now },
  audioUsedMB: { type: Number, default: 0 },
  videoUsedMB: { type: Number, default: 0 },
  machineId: { type: String, unique: true, sparse: true, default: null },
  rconConfig: {
    host: { type: String, default: DEFAULT_RCON_HOST },
    port: { type: Number, default: DEFAULT_RCON_PORT },
    password: { type: String, default: DEFAULT_RCON_PASSWORD },
    player: { type: String, default: DEFAULT_RCON_PLAYER },
  },
});
const User = mongoose.model("User", userSchema);

const paypalSubscriptionSchema = new mongoose.Schema({
  subscriptionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  planType: { type: String, enum: ["monthly", "yearly"], required: true },
  status: { type: String, default: "PENDING" },
  createdAt: { type: Date, default: Date.now },
});
const PaypalSubscription = mongoose.model(
  "PaypalSubscription",
  paypalSubscriptionSchema,
);

const giftCommandSchema = new mongoose.Schema(
  {
    giftId: { type: mongoose.Schema.Types.Mixed, required: true },
    name: { type: String, default: "" },
    command: { type: String, default: "" },
    webhookUrl: { type: String, default: "" },
    repeat: { type: Number, default: 1 },
    interval: { type: Number, default: 500 },
    delayBefore: { type: Number, default: 0 },
    audio: { type: String, default: null },
    volume: { type: Number, default: 100 },
    video: { type: String, default: null },
    videoVolume: { type: Number, default: 100 },
    screen: { type: Number, default: 1 },
    targetUser: { type: String, default: "all" },
    active: { type: Boolean, default: true },
    playSound: { type: Boolean, default: true },
    playVideo: { type: Boolean, default: true },
    oncePerLive: { type: Boolean, default: false },
    profile: { type: Number, default: 1, min: 1, max: MAX_PROFILES },
    showOverlay: { type: Boolean, default: false },
    overlayText: { type: String, default: "" },
    duration: { type: Number, default: 5, min: 1, max: 60 },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    combo: { type: String, default: null },
  },
  { timestamps: true },
);
const GiftCommand = mongoose.model("GiftCommand", giftCommandSchema);

const interactionCommandSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["follow", "like", "comment", "share", "gift", "all"],
      required: true,
    },
    combo: { type: String, default: null, index: true },
    name: { type: String, default: "" },
    command: { type: String, default: "" },
    webhookUrl: { type: String, default: "" },
    repeat: { type: Number, default: 1 },
    interval: { type: Number, default: 500 },
    delayBefore: { type: Number, default: 0 },
    audio: { type: String, default: null },
    volume: { type: Number, default: 100 },
    video: { type: String, default: null },
    videoVolume: { type: Number, default: 100 },
    screen: { type: Number, default: 1 },
    targetUser: { type: String, default: "all" },
    active: { type: Boolean, default: true },
    playSound: { type: Boolean, default: true },
    playVideo: { type: Boolean, default: true },
    keyword: { type: String, default: "" },
    threshold: { type: Number, default: 0 },
    oncePerLive: { type: Boolean, default: false },
    profile: { type: Number, default: 1, min: 1, max: MAX_PROFILES },
    showOverlay: { type: Boolean, default: false },
    overlayText: { type: String, default: "" },
    duration: { type: Number, default: 5, min: 1, max: 60 },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
const InteractionCommand = mongoose.model(
  "InteractionCommand",
  interactionCommandSchema,
);

const giftSchema = new mongoose.Schema({
  id: Number,
  name: String,
  describe: String,
  diamond_count: Number,
  type: Number,
  source: Number,
  image: mongoose.Schema.Types.Mixed,
});
const Gift = mongoose.model("Gift", giftSchema);

const audioSchema = new mongoose.Schema({
  name: String,
  file: { type: String, unique: true },
  cloudinaryUrl: String,
  sizeMB: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});
const Audio = mongoose.model("Audio", audioSchema);

const videoSchema = new mongoose.Schema({
  name: String,
  file: { type: String, unique: true },
  cloudinaryUrl: String,
  sizeMB: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});
const Video = mongoose.model("Video", videoSchema);

const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
});
const Setting = mongoose.model("Setting", settingSchema);

const profileSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: {
    type: String,
    default: function () {
      return `Profile ${this.id}`;
    },
  },
  active: { type: Boolean, default: false },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
});
profileSchema.index({ owner: 1, id: 1 }, { unique: true });
const Profile = mongoose.model("Profile", profileSchema);

// ================ دوال مساعدة ================
async function ensureUserProfiles(userId) {
  const count = await Profile.countDocuments({ owner: userId });
  if (count === 0) {
    const profiles = [];
    for (let i = 1; i <= MAX_PROFILES; i++) {
      profiles.push({
        id: i,
        name: `Profile ${i}`,
        owner: userId,
        active: i === 1,
      });
    }
    await Profile.insertMany(profiles);
    logger.info(`✅ تم إنشاء ${MAX_PROFILES} بروفايل للمستخدم ${userId}`);
  } else if (count < MAX_PROFILES) {
    const existingIds = (
      await Profile.find({ owner: userId }).select("id")
    ).map((p) => p.id);
    for (let i = 1; i <= MAX_PROFILES; i++) {
      if (!existingIds.includes(i)) {
        await Profile.create({
          id: i,
          name: `Profile ${i}`,
          owner: userId,
          active: false,
        });
      }
    }
  }
}

async function getUserSelectedProfile(userId) {
  const user = await User.findById(userId);
  return user ? user.selectedProfile : 1;
}

async function updateSubscriptionStatus(user) {
  const now = new Date();
  if (!user.subscriptionExpiry) {
    if (user.plan !== "free") {
      user.plan = "free";
      user.planType = null;
      user.subscriptionGracePeriodEnd = null;
      user.subscriptionWarningSent = false;
      await user.save();
    }
    return {
      plan: user.plan,
      status: "expired",
      expiry: null,
      graceEnd: null,
      daysLeft: 0,
      hoursLeft: 0,
      isWarning: false,
      isGrace: false,
      message: "لا يوجد اشتراك نشط",
    };
  }
  const expiry = new Date(user.subscriptionExpiry);
  const diffMs = expiry - now;
  const hoursLeft = diffMs / (1000 * 60 * 60);
  const daysLeft = hoursLeft / 24;
  if (diffMs > 0) {
    const isWarning =
      hoursLeft <= WARNING_HOURS && !user.subscriptionWarningSent;
    if (isWarning) {
      user.subscriptionWarningSent = true;
      await user.save();
    }
    return {
      plan: user.plan,
      status: "active",
      expiry,
      graceEnd: null,
      daysLeft: Math.max(0, daysLeft),
      hoursLeft: Math.max(0, hoursLeft),
      isWarning,
      isGrace: false,
      message: isWarning
        ? `اشتراكك المدفوع ينتهي بعد ${Math.floor(hoursLeft)} ساعة. يرجى التجديد.`
        : null,
    };
  }
  if (user.subscriptionGracePeriodEnd) {
    const graceEnd = new Date(user.subscriptionGracePeriodEnd);
    const graceLeftMs = graceEnd - now;
    if (graceLeftMs > 0) {
      return {
        plan: user.plan,
        status: "grace",
        expiry,
        graceEnd,
        daysLeft: 0,
        hoursLeft: graceLeftMs / (1000 * 60 * 60),
        isWarning: false,
        isGrace: true,
        message: `لقد انتهى اشتراكك المدفوع، لكن لديك ${GRACE_HOURS} ساعة سماح لإتمام التجديد. سيتم تحويل حسابك للخطة المجانية بعد ${Math.floor(graceLeftMs / (1000 * 60 * 60))} ساعة.`,
      };
    } else {
      user.plan = "free";
      user.planType = null;
      user.subscriptionExpiry = null;
      user.subscriptionGracePeriodEnd = null;
      user.subscriptionWarningSent = false;
      await user.save();
      return {
        plan: "free",
        status: "expired",
        expiry: null,
        graceEnd: null,
        daysLeft: 0,
        hoursLeft: 0,
        isWarning: false,
        isGrace: false,
        message:
          "تم تحويل حسابك للخطة المجانية. يمكنك الاشتراك مجددًا للاستفادة من الميزات المدفوعة.",
      };
    }
  } else {
    const graceEnd = new Date(now);
    graceEnd.setHours(now.getHours() + GRACE_HOURS);
    user.subscriptionGracePeriodEnd = graceEnd;
    await user.save();
    return {
      plan: user.plan,
      status: "grace",
      expiry,
      graceEnd,
      daysLeft: 0,
      hoursLeft: GRACE_HOURS,
      isWarning: false,
      isGrace: true,
      message: `لقد انتهى اشتراكك المدفوع، لكن لديك ${GRACE_HOURS} ساعة سماح لإتمام التجديد. سيتم تحويل حسابك للخطة المجانية بعد ${GRACE_HOURS} ساعة.`,
    };
  }
}

async function getUserPlan(userId) {
  const user = await User.findById(userId);
  if (!user) return "free";
  const status = await updateSubscriptionStatus(user);
  return status.plan;
}

async function getTotalCommandsForUser(userId) {
  const giftCount = await GiftCommand.countDocuments({ userId });
  const interactionCount = await InteractionCommand.countDocuments({ userId });
  return giftCount + interactionCount;
}

async function canAccessProfile(userId, profileId) {
  const profile = await Profile.findOne({ owner: userId, id: profileId });
  if (!profile) return false;
  const plan = await getUserPlan(userId);
  if (plan === "paid") return true;
  return profileId === 1;
}

async function seedGiftsIfNeeded() {
  const count = await Gift.countDocuments();
  if (count === 0) {
    const giftFile = path.join(__dirname, "gifts.json");
    if (fs.existsSync(giftFile)) {
      try {
        const gifts = JSON.parse(fs.readFileSync(giftFile, "utf8"));
        await Gift.insertMany(gifts);
        logger.info(`✅ تم إدراج ${gifts.length} هدية من ملف gifts.json`);
      } catch (e) {
        logger.warn("⚠️ فشل قراءة gifts.json:", e.message);
      }
    }
  }
}

async function refreshCachesForUser(userId) {
  try {
    const gifts = await GiftCommand.find({ userId }).lean();
    const interactions = await InteractionCommand.find({ userId }).lean();
    const giftMapByProfile = new Map();
    for (const g of gifts) {
      const p = g.profile || 1;
      if (!giftMapByProfile.has(p)) giftMapByProfile.set(p, new Map());
      giftMapByProfile.get(p).set(String(g.giftId), g);
    }
    const interactionMapByProfile = new Map();
    for (const ic of interactions) {
      const p = ic.profile || 1;
      if (!interactionMapByProfile.has(p)) interactionMapByProfile.set(p, []);
      interactionMapByProfile.get(p).push(ic);
    }
    // تخزين في cache بدلاً من map
    state.setCache(`gifts:${userId}`, giftMapByProfile);
    state.setCache(`interactions:${userId}`, interactionMapByProfile);
    logger.info(`♻️ تم تحديث الكاش للمستخدم ${userId}`);
  } catch (err) {
    logger.error("❌ خطأ في تحديث الكاش:", err.message);
  }
}

function getGiftCommandForProfile(userId, profile, giftIdStr) {
  const giftMap = state.getCache(`gifts:${userId}`);
  if (!giftMap) return null;
  const profileMap = giftMap.get(profile);
  if (!profileMap) return null;
  return profileMap.get(String(giftIdStr)) || null;
}

function getInteractionCommandsForProfile(userId, profile) {
  const interactMap = state.getCache(`interactions:${userId}`);
  if (!interactMap) return [];
  return interactMap.get(profile) || [];
}

// ================ دوال حذف الملفات ================
async function deleteFilesForCommand(cmd, userId) {
  let audioSize = 0,
    videoSize = 0;

  try {
    if (cmd.video) {
      const videoDoc = await Video.findOne({ file: cmd.video, userId });
      if (videoDoc) {
        videoSize = videoDoc.sizeMB || 0;
        await Video.deleteOne({ file: cmd.video });
      }
    }
  } catch (err) {
    logger.error(`❌ فشل حذف الفيديو ${cmd.video}:`, err.message);
  }

  try {
    if (cmd.audio) {
      const audioDoc = await Audio.findOne({ file: cmd.audio, userId });
      if (audioDoc) {
        audioSize = audioDoc.sizeMB || 0;
        await Audio.deleteOne({ file: cmd.audio });
      }
    }
  } catch (err) {
    logger.error(`❌ فشل حذف الصوت ${cmd.audio}:`, err.message);
  }

  if (userId && (audioSize > 0 || videoSize > 0)) {
    try {
      const user = await User.findById(userId);
      if (user) {
        user.audioUsedMB = Math.max(0, user.audioUsedMB - audioSize);
        user.videoUsedMB = Math.max(0, user.videoUsedMB - videoSize);
        await user.save();

        const storageData = {
          audio: {
            usedMB: user.audioUsedMB,
            limitMB: MAX_AUDIO_MB,
            remainingMB: Math.max(0, MAX_AUDIO_MB - user.audioUsedMB),
          },
          video: {
            usedMB: user.videoUsedMB,
            limitMB: MAX_VIDEO_MB,
            remainingMB: Math.max(0, MAX_VIDEO_MB - user.videoUsedMB),
          },
        };
        io.to(`user-${userId}`).emit("storage-update", storageData);
      }
    } catch (err) {
      logger.error(`❌ فشل تحديث مساحة المستخدم ${userId}:`, err.message);
    }
  }

  return { audioSize, videoSize };
}

// ================ رفع ملف من رابط ================
async function uploadFileFromUrl(url, userId, type) {
  try {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return null;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`فشل تحميل الملف: ${response.status}`);

    const buffer = await response.arrayBuffer();
    const mime =
      response.headers.get("content-type") ||
      (type === "video" ? "video/mp4" : "audio/mpeg");
    const fileSizeMB = buffer.byteLength / (1024 * 1024);

    const folder = type === "video" ? "blackmoon_videos" : "blackmoon_audio";
    const resourceType = type === "video" ? "video" : "raw";

    const urlPath = new URL(url).pathname;
    const originalName =
      path.parse(urlPath).name || (type === "video" ? "video" : "audio");
    const ext = path.extname(urlPath) || (type === "video" ? ".mp4" : ".mp3");
    const publicId = `${originalName.replace(/[^a-zA-Z0-9\u0600-\u06FF\-]/g, "-")}-${Date.now()}`;
    const filename = `${publicId}${ext}`;

    const uploadResult = await cloudinary.uploader.upload(
      `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`,
      {
        public_id: publicId,
        resource_type: resourceType,
        folder: folder,
        access_mode: "public",
        timeout: 120000,
      },
    );

    if (type === "audio") {
      await Audio.create({
        name: originalName,
        file: filename,
        cloudinaryUrl: uploadResult.secure_url,
        sizeMB: fileSizeMB,
        userId: userId,
      });
    } else {
      await Video.create({
        name: originalName,
        file: filename,
        cloudinaryUrl: uploadResult.secure_url,
        sizeMB: fileSizeMB,
        userId: userId,
      });
    }

    const user = await User.findById(userId);
    if (user) {
      if (type === "audio") {
        user.audioUsedMB += fileSizeMB;
      } else {
        user.videoUsedMB += fileSizeMB;
      }
      await user.save();
    }

    return filename;
  } catch (err) {
    logger.error(`❌ فشل رفع الملف من URL ${url}:`, err.message);
    return null;
  }
}

// ================ حد 7 أوامر نشطة للخطة المجانية ================
async function enforceFreePlanLimits(userId, profile) {
  const user = await User.findById(userId);
  if (!user || user.plan !== "free") return;

  const giftCommands = await GiftCommand.find({
    userId,
    profile,
    active: true,
  }).sort({ createdAt: 1 });

  const interactionCommands = await InteractionCommand.find({
    userId,
    profile,
    active: true,
  }).sort({ createdAt: 1 });

  const allActive = [...giftCommands, ...interactionCommands];
  allActive.sort((a, b) => a.createdAt - b.createdAt);

  if (allActive.length <= 7) return;

  const toDisable = allActive.slice(0, allActive.length - 7);
  for (const cmd of toDisable) {
    cmd.active = false;
    await cmd.save();
  }
}

// ================ وظائف RCON ================
async function getUserRcon(userId) {
  const user = await User.findById(userId);
  if (!user || !user.rconConfig) return null;
  const config = user.rconConfig;
  const key = userId.toString();
  let instance = state.userRconInstances.get(key);
  if (
    instance &&
    instance.connected &&
    instance.config.host === config.host &&
    instance.config.port === config.port &&
    instance.config.password === config.password
  ) {
    return instance.rcon;
  }
  if (instance && instance.rcon) {
    try {
      instance.rcon.disconnect();
    } catch (e) {}
  }
  const rcon = new Rcon(config.host, config.port, config.password);
  let connected = false;
  await new Promise((resolve) => {
    rcon.on("auth", () => {
      connected = true;
      resolve();
    });
    rcon.on("error", () => resolve());
    rcon.on("end", () => resolve());
    rcon.connect();
    setTimeout(() => resolve(), 5000);
  });
  if (!connected) return null;
  state.userRconInstances.set(key, { rcon, config, connected: true });
  return rcon;
}

function replacePlaceholders(cmd, nickname, username, rconPlayer) {
  const safeName = (name) =>
    name && name.includes(" ") ? `"${name}"` : name || "";

  const safeNickname = safeName(nickname);
  const safeUsername = safeName(username);
  const safePlayer = safeName(rconPlayer);

  let finalCmd = cmd
    .replace(/{player}/g, safePlayer)
    .replace(/{nickname}/g, safeNickname)
    .replace(/{username}/g, safeUsername);

  if (finalCmd.startsWith("/")) finalCmd = finalCmd.slice(1);
  return finalCmd.trim();
}

async function sendRconCommand(userId, command, { nickname, username } = {}) {
  if (state.pluginSockets.size > 0) {
    const finalCommand = command
      .replace(/{nickname}/g, nickname || "")
      .replace(/{username}/g, username || "");

    for (const sock of state.pluginSockets) {
      sock.emit("execute", {
        command: finalCommand,
        player: username || "console",
        nickname: nickname || username || "console",
      });
    }
    logger.info(`📡 أرسل إلى البلوجن: ${finalCommand}`);
    return;
  }
  const user = await User.findById(userId);
  if (!user || !user.rconConfig) return;
  const rcon = await getUserRcon(userId);
  if (!rcon) {
    logger.info(`⚠️ RCON للمستخدم ${userId} غير متصل، تأجيل الأمر: ${command}`);
    return;
  }

  const final = replacePlaceholders(
    command,
    nickname,
    username,
    user.rconConfig.player,
  );
  try {
    rcon.send(final);
  } catch (err) {
    logger.error("❌ فشل إرسال أمر RCON:", err.message);
  }
}

// ================ Webhook ================
async function sendWebhook(webhookUrl, data, userId = null) {
  if (!webhookUrl || !webhookUrl.trim()) return;
  webhookUrl = webhookUrl.trim();
  if (!webhookUrl.startsWith("http://") && !webhookUrl.startsWith("https://")) {
    logger.warn(`⚠️ تجاهل webhook: رابط غير صالح (${webhookUrl})`);
    return;
  }

  const isLocalhost =
    webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");
  if (isLocalhost && userId) {
    const userIdStr = userId.toString();
    const agentSocket = state.userLocalAgents.get(userIdStr);
    if (!agentSocket || !agentSocket.connected) {
      logger.warn(
        `⚠️ لا يوجد عميل محلي للمستخدم ${userId}، تجاهل webhook إلى ${webhookUrl}`,
      );
      io.to(`user-${userId}`).emit("webhook-error", {
        message: "العميل المحلي غير متصل",
        url: webhookUrl,
      });
      return;
    }
    logger.info(
      `📡 إرسال webhook إلى العميل المحلي للمستخدم ${userId}: ${webhookUrl}`,
    );
    agentSocket.emit("webhook-request", {
      url: webhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data,
      repeat: 1,
      interval: 0,
      delayBefore: 0,
    });
    return;
  }

  logger.info(`🌐 إرسال Webhook إلى: ${webhookUrl.substring(0, 50)}...`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BlackMoon/1.0",
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) logger.info(`✅ Webhook نجح (${response.status})`);
    else logger.warn(`⚠️ Webhook فشل (${response.status})`);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") logger.error("❌ Webhook timeout");
    else logger.error("❌ Webhook error:", err.message);
  }
}

// ================ تشغيل الصوت ================
async function playAudio(
  file,
  volume = 100,
  targetUserId = null,
  giftId = null,
  screen = 1,
  sendToUser = false,
) {
  // تطبيع المسار
  let fileName = file;
  if (file.startsWith("/audios/")) {
    fileName = file.substring(8);
  } else if (file.startsWith("http://") || file.startsWith("https://")) {
    // رابط كامل
  } else {
    fileName = file;
  }

  let audioUrl = file;

  if (
    targetUserId &&
    !file.startsWith("http://") &&
    !file.startsWith("https://")
  ) {
    const audioDoc = await Audio.findOne({
      file: fileName,
      userId: targetUserId,
    });
    if (audioDoc && audioDoc.cloudinaryUrl) {
      audioUrl = audioDoc.cloudinaryUrl;
    } else {
      if (!file.startsWith("/audios/") && !file.startsWith("http")) {
        audioUrl = `/audios/${fileName}`;
      } else {
        audioUrl = file;
      }
    }
  } else {
    audioUrl = file;
    if (!audioUrl.startsWith("http") && !audioUrl.startsWith("/audios/")) {
      audioUrl = `/audios/${audioUrl}`;
    }
  }

  const uniqueId = `${targetUserId || "global"}-${giftId || "default"}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  const payload = {
    filename: audioUrl,
    volume: Math.min(100, Math.max(0, parseInt(volume) || 100)),
    timestamp: Date.now(),
    giftId: giftId || "default",
    screen: screen,
    id: uniqueId,
  };

  if (!targetUserId) return;

  const screenRoom = `screen-${targetUserId}`;
  const hasScreen = io.sockets.adapter.rooms.has(screenRoom);

  if (sendToUser) {
    io.to(`user-${targetUserId}`).emit("play-sound", payload);
  } else if (hasScreen) {
    io.to(screenRoom).emit("play-sound", payload);
  } else {
    console.log(`⚠️ لا توجد شاشة للمستخدم ${targetUserId}، تم تجاهل الصوت`);
  }
}

// ================ تنفيذ الإجراء ================
async function executeAction(
  cmdObj,
  triggerUser = "Unknown",
  userId,
  data = null,
  source = "auto",
  eventId = null, // معرف فريد للحدث للتتبع
) {
  // سجل بداية التنفيذ مع eventId إن وجد
  console.log(
    `⚡ [EXECUTE] eventId=${eventId || "manual"}, cmd=${
      cmdObj.name || cmdObj._id
    }, triggerUser=${triggerUser}, repeat=${cmdObj.repeat || 1}, source=${source}`,
  );

  if (!cmdObj.active) return;

  const {
    command,
    webhookUrl,
    repeat = 1,
    interval = 500,
    delayBefore = 0,
    audio,
    volume = 100,
    video,
    videoVolume = 100,
    screen = 1,
    _id,
    name = "",
    oncePerLive = false,
    playSound = true,
    playVideo = true,
    keystrokeText = null,
    combo = null,
    duration = 5,
  } = cmdObj;

  // استخراج الاسم الحقيقي والصورة
  let realName = triggerUser;
  let avatar = "";
  if (data) {
    const uniqueId = getSenderFromEvent(data);
    const nameFromEvent = getUserRealName(data);
    const avatarFromEvent = getUserAvatar(data);
    if (
      nameFromEvent &&
      nameFromEvent !== "Unknown" &&
      nameFromEvent !== uniqueId
    ) {
      realName = nameFromEvent;
    }
    if (avatarFromEvent) avatar = avatarFromEvent;
    try {
      const info = await fetchTikTokUserInfo(uniqueId);
      if (info.nickname && info.nickname !== uniqueId) {
        realName = info.nickname;
      }
      if (info.avatar) avatar = info.avatar;
    } catch (err) {
      if (
        realName === triggerUser &&
        nameFromEvent &&
        nameFromEvent !== "Unknown"
      ) {
        realName = nameFromEvent;
      }
    }
  }

  // oncePerLive (باستخدام NodeCache)
  if (oncePerLive && _id && userId) {
    const key = `${userId}:${String(_id)}`;
    if (state.getTemp("executedOncePerLive", key)) {
      logger.info(
        `⏭️ الأمر ${name} تم تنفيذه مرة واحدة - تخطي (eventId=${eventId})`,
      );
      return;
    }
    state.setTemp("executedOncePerLive", key, true, 3600);
  }

  // تشغيل الصوت فوراً
  if (playSound && audio) {
    const giftId = cmdObj.giftId || cmdObj._id || "default";
    const sendToUser = source === "manual";
    await playAudio(
      audio,
      volume,
      userId,
      String(giftId),
      cmdObj.screen || 1,
      sendToUser,
    );
  }

  // التأخير
  if (delayBefore > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayBefore));
  }

  // تشغيل الفيديو
  if (playVideo && video && userId) {
    let videoUrl = video;
    try {
      const videoDoc = await Video.findOne({ file: video, userId });
      videoUrl =
        videoDoc?.cloudinaryUrl ||
        `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${encodeURIComponent(video)}`;
    } catch (e) {}

    const payload = {
      videoId: videoUrl,
      user: triggerUser,
      screen: screen,
      volume: videoVolume,
    };

    const screenRoom = `screen-${userId}`;
    const hasScreen = io.sockets.adapter.rooms.has(screenRoom);

    if (hasScreen) {
      io.to(screenRoom).emit("gift-video", payload);
      if (duration && duration > 0) {
        setTimeout(() => {
          if (hasScreen) io.to(screenRoom).emit("stop-video");
        }, duration * 1000);
      }
    } else {
      console.log(
        `⚠️ لا توجد شاشة للمستخدم ${userId}، تم تجاهل الفيديو (eventId=${eventId})`,
      );
    }
  }

  // التراكب
  if (cmdObj.showOverlay && userId) {
    const overlayPayload = {
      username: realName,
      avatar: avatar,
      text: cmdObj.overlayText || "",
      duration: (duration || 5) * 1000,
      screen: cmdObj.screen || 1,
    };

    const screenRoom = `screen-${userId}`;
    const hasScreen = io.sockets.adapter.rooms.has(screenRoom);

    if (hasScreen) {
      io.to(screenRoom).emit("show-overlay", overlayPayload);
    } else {
      console.log(
        `⚠️ لا توجد شاشة للمستخدم ${userId}، تم تجاهل التراكب (eventId=${eventId})`,
      );
    }
  }

  // تنفيذ الأوامر والكيستروك والويبهوك
  for (let i = 0; i < repeat; i++) {
    if (i > 0 && interval > 0) {
      await new Promise((r) => setTimeout(r, interval));
    }

    // ========== التعديل الأساسي هنا ==========
    // الكيستروك: يُرسل فقط إذا لم يكن هناك أمر RCON (command فارغ)
    // حتى لا تتداخل الأوامر المعقدة (مثل أوامر ماينكرافت) مع SendKeys
    if (keystrokeText && !command) {
      const finalKeystroke = replacePlaceholders(
        keystrokeText,
        realName,
        triggerUser,
        "",
      );
      console.log(
        `⌨️ [KEYSTROKE] eventId=${eventId}, keys="${finalKeystroke}"`,
      );
      const agentSocket = state.userLocalAgents.get(userId.toString());
      if (agentSocket && agentSocket.connected) {
        agentSocket.emit("execute-keys", {
          command: finalKeystroke,
          repeat: 1,
          interval: 0,
          combo,
        });
      } else if (keySenderReady) {
        await executeNativeKeystroke(finalKeystroke, 1, 0);
      }
    }

    // أوامر RCON (تبقى كما هي، تُرسل مباشرة إلى السيرفر)
    if (command && command.trim()) {
      console.log(
        `📟 [RCON] eventId=${eventId}, command="${command.substring(0, 50)}..."`,
      );
      const lines = command
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l);
      if (lines.length > 1) {
        const groups = [];
        let currentGroup = [];
        for (const line of lines) {
          if (line.toLowerCase() === "or") {
            if (currentGroup.length) {
              groups.push(currentGroup);
              currentGroup = [];
            }
          } else currentGroup.push(line);
        }
        if (currentGroup.length) groups.push(currentGroup);
        const selectedGroup = groups.length
          ? groups[Math.floor(Math.random() * groups.length)]
          : [];
        let cumulativeDelay = 0;
        for (const cmdLine of selectedGroup) {
          if (cmdLine.toLowerCase().startsWith("delay ")) {
            const sec = parseFloat(cmdLine.split(/\s+/)[1]);
            if (!isNaN(sec)) cumulativeDelay += sec;
            continue;
          }
          setTimeout(() => {
            sendRconCommand(userId, cmdLine, {
              nickname: realName,
              username: triggerUser,
            });
          }, cumulativeDelay * 1000); // تحويل الثواني إلى ملي ثانية
          cumulativeDelay += DEFAULT_COMMAND_DELAY_MS / 1000;
        }
      } else {
        const singleCmd = lines[0];
        sendRconCommand(userId, singleCmd, {
          nickname: realName,
          username: triggerUser,
        });
      }
    }

    // الويبهوك
    if (webhookUrl && webhookUrl.trim()) {
      const webhookData = {
        name: name || "",
        user: triggerUser,
        displayName: realName,
        type: cmdObj.type || "keyboard",
        timestamp: new Date().toISOString(),
        profile: cmdObj.profile || 1,
        event: "webhook_execution",
        repeat: 1,
        interval: 0,
        iteration: i + 1,
      };
      await sendWebhook(webhookUrl, webhookData, userId);
    }
  }
}

// ================ دوال مساعدة لأحداث TikTok ================
function resetOncePerLiveForUser(userId) {
  // حذف oncePerLive
  const keys = state.tempStores.executedOncePerLive.keys();
  for (const key of keys) {
    if (key.startsWith(`${userId}:`)) {
      state.delTemp("executedOncePerLive", key);
    }
  }

  // حذف عدادات اللايك
  const likeKeys = state.tempStores.likeCounters.keys();
  for (const key of likeKeys) {
    if (key.startsWith(`${userId}:`)) {
      state.delTemp("likeCounters", key);
    }
  }

  // ❌ لا نمسح interactionCooldown لأنه يعتمد على TTL تلقائي
}

function getSenderFromEvent(data) {
  if (!data) return "Unknown";
  const user = data.user || {};
  const candidates = [
    user.uniqueId,
    user.unique_id,
    data.uniqueId,
    data.unique_id,
    user.username,
    data.username,
    data.userId,
    user.userId,
    user.id,
    data.id,
    data.uid,
    data.sender,
    user.nickname,
    user.nickName,
    user.displayName,
    user.display_name,
  ];
  for (let c of candidates) {
    if (typeof c === "string" && c.trim() && !/^\d+$/.test(c.trim()))
      return c.trim();
    if (typeof c === "number") continue;
  }
  return "StreamMoon";
}

function getUserRealName(data) {
  const user = data.user || {};
  const candidates = [
    user.nickname,
    user.nickName,
    user.displayName,
    user.display_name,
    user.uniqueId,
    user.unique_id,
    user.username,
    user.name,
    user.userName,
    data.nickname,
    data.displayName,
    getSenderFromEvent(data),
  ];
  for (let c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return getSenderFromEvent(data);
}

function getUserAvatar(data) {
  if (!data) return "";
  const user = data.user || {};

  const normalizeUrl = (url) => {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return "https:" + url;
    return null;
  };

  const paths = [
    user.avatar_thumb?.url_list?.[0],
    user.avatarThumb?.url_list?.[0],
    user.avatar_thumb_medium?.url_list?.[0],
    user.avatarThumbMedium?.url_list?.[0],
    user.profile_picture?.url_list?.[0],
    user.profilePicture?.url_list?.[0],
    user.avatar,
    user.avatarUrl,
    user.profilePicture,
    user.profile_picture,
    user.avatar_thumb?.url,
    user.avatarThumb?.url,
    user.profilePicture?.url,
    user.profile_picture?.url,
    user.user?.avatar_thumb?.url_list?.[0],
    user.user?.avatarThumb?.url_list?.[0],
    user.user?.profile_picture?.url_list?.[0],
    user.user?.profilePicture?.url_list?.[0],
    data.avatar_thumb?.url_list?.[0],
    data.avatarThumb?.url_list?.[0],
    data.profile_picture?.url_list?.[0],
    data.profilePicture?.url_list?.[0],
    data.avatar,
    data.avatarUrl,
    user.userInfo?.avatar_thumb?.url_list?.[0],
    user.userInfo?.avatarThumb?.url_list?.[0],
    user.userInfo?.profile_picture?.url_list?.[0],
    user.userInfo?.profilePicture?.url_list?.[0],
  ];

  for (let raw of paths) {
    const url = normalizeUrl(raw);
    if (url) {
      console.log(`✅ تم العثور على صورة المستخدم: ${url}`);
      return url;
    }
  }

  if (data.userInfo) {
    const info = data.userInfo;
    const infoPaths = [
      info.avatar_thumb?.url_list?.[0],
      info.avatarThumb?.url_list?.[0],
      info.profile_picture?.url_list?.[0],
      info.profilePicture?.url_list?.[0],
      info.avatar,
      info.avatarUrl,
    ];
    for (let raw of infoPaths) {
      const url = normalizeUrl(raw);
      if (url) {
        console.log(`✅ تم العثور على صورة المستخدم من userInfo: ${url}`);
        return url;
      }
    }
  }

  console.warn("⚠️ لم يتم العثور على صورة للمستخدم");
  return "";
}

async function fetchUserAvatarFromTikTok(uniqueId) {
  if (!uniqueId) return "";
  const cached = state.getTemp("userAvatarCache", uniqueId);
  if (cached) return cached;
  try {
    const url = `https://www.tikwm.com/api/user/?unique_id=${uniqueId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return "";
    const data = await response.json();
    if (data && data.data && data.data.avatar) {
      let avatarUrl = data.data.avatar;
      if (avatarUrl.startsWith("//")) avatarUrl = "https:" + avatarUrl;
      state.setTemp("userAvatarCache", uniqueId, avatarUrl, 3600);
      console.log(`✅ تم جلب صورة المستخدم ${uniqueId} عبر API: ${avatarUrl}`);
      return avatarUrl;
    }
  } catch (err) {
    console.warn(`⚠️ فشل جلب صورة المستخدم ${uniqueId} عبر API:`, err.message);
  }
  return "";
}

async function fetchTikTokUserInfo(uniqueId) {
  if (!uniqueId) return { nickname: null, avatar: null };
  const cached = state.getTemp("userInfoCache", uniqueId);
  if (cached) return cached;
  try {
    const url = `https://www.tikwm.com/api/user/?unique_id=${uniqueId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      if (data?.data) {
        let avatarUrl = data.data.avatar || "";
        if (avatarUrl.startsWith("//")) avatarUrl = "https:" + avatarUrl;
        const info = {
          nickname: data.data.nickname || uniqueId,
          avatar: avatarUrl,
        };
        state.setTemp("userInfoCache", uniqueId, info, 3600);
        return info;
      }
    }
  } catch (err) {
    logger.warn(`⚠️ فشل جلب معلومات ${uniqueId} عبر tikwm:`, err.message);
  }

  // المحاولة الثانية: scraping
  try {
    const url = `https://www.tiktok.com/@${uniqueId}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (response.ok) {
      const html = await response.text();
      const match = html.match(
        /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/,
      );
      if (match && match[1]) {
        const json = JSON.parse(match[1]);
        const userData =
          json?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.user;
        if (userData) {
          const info = {
            nickname: userData.nickname || uniqueId,
            avatar: userData.avatarMedium || userData.avatarLarger || "",
          };
          state.setTemp("userInfoCache", uniqueId, info, 3600);
          return info;
        }
      }
    }
  } catch (err) {
    logger.warn(`⚠️ فشل جلب معلومات ${uniqueId} عبر scraping:`, err.message);
  }

  return { nickname: uniqueId, avatar: null };
}

async function getAvatarWithFallback(data, uniqueId) {
  let avatar = getUserAvatar(data);
  if (avatar) return avatar;
  if (uniqueId) {
    const cached = state.getTemp("userAvatarCache", uniqueId);
    if (cached) return cached;
    try {
      const fetchPromise = fetchUserAvatarFromTikTok(uniqueId);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 0),
      );
      avatar = await Promise.race([fetchPromise, timeoutPromise]);
      if (avatar) return avatar;
    } catch (err) {
      console.warn(`⚠️ فشل جلب صورة ${uniqueId}:`, err.message);
    }
  }
  return "";
}

function normalizeUser(u) {
  return u ? String(u).trim().toLowerCase() : "unknown";
}

function addKeystrokeToCommand(cmd) {
  const cmdObj = cmd.toObject ? { ...cmd.toObject() } : { ...cmd };
  cmdObj.keystrokeText =
    cmdObj.command && cmdObj.command.trim() !== ""
      ? cmdObj.command
      : cmdObj.combo || "";
  return cmdObj;
}

// ================ تحديث وقت النشاط ================
function updateLastActivity(userId) {
  const conn = getTikTokConnection(userId);
  if (conn) {
    conn.lastRoomUpdate = Date.now();
    setTikTokConnection(userId, conn);
  }
}

// ================ Heartbeat ================
function startLiveHeartbeat(userId) {
  if (state.heartbeats.has(userId)) {
    clearInterval(state.heartbeats.get(userId));
    state.heartbeats.delete(userId);
  }

  const interval = setInterval(async () => {
    const conn = getTikTokConnection(userId);
    if (!conn || !conn.connection) {
      clearInterval(interval);
      state.heartbeats.delete(userId);
      return;
    }
    if (!conn.isLive) {
      clearInterval(interval);
      state.heartbeats.delete(userId);
      return;
    }

    try {
      // ✅ التعديل الأساسي: نعتمد فقط على roomId لتحديد انتهاء البث
      if (!conn.roomId) {
        conn.isLive = false;
        setTikTokConnection(userId, conn);
        resetOncePerLiveForUser(userId);
        clearInterval(interval);
        state.heartbeats.delete(userId);
        logger.info(`🔄 انتهاء البث للمستخدم ${userId} (roomId فارغ)`);
        return;
      }

      // ❌ نزيل التحقق الزمني بالكامل (كان سابقاً: if (now - lastUpdate > 60000))
      // لا نقوم بأي إجراء إضافي
    } catch (err) {
      conn.isLive = false;
      setTikTokConnection(userId, conn);
      resetOncePerLiveForUser(userId);
      clearInterval(interval);
      state.heartbeats.delete(userId);
      logger.warn(`⚠️ خطأ في heartbeat للمستخدم ${userId}: ${err.message}`);
    }
  }, 15000);

  state.heartbeats.set(userId, interval);
}

// ================ إدارة اتصالات TikTok ================
async function connectUser(userId, username) {
  console.log(`🔗 [CONNECT] محاولة اتصال للمستخدم ${userId} @${username}`);
  if (getTikTokConnection(userId)) {
    deleteTikTokConnection(userId);
  }
  const connection = new TikTokLiveConnection(username, {
    apiKey: BLACKMOON_KEY,
  });

  let debugOnce = false;

  connection.on(WebcastEvent.GIFT, async (data) => {
    const eventId = generateEventId(); // معرف فريد لهذا الحدث
    updateLastActivity(userId);

    if (!debugOnce) {
      console.log("🔍 هيكل بيانات الهدية (GIFT) - أول مرة:");
      console.log(JSON.stringify(data, null, 2).substring(0, 2000));
      console.log("🔍 المفاتيح الرئيسية:", Object.keys(data));
      console.log(
        "🔍 مفاتيح user:",
        data.user ? Object.keys(data.user) : "لا يوجد user",
      );
      debugOnce = true;
    }

    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      const rawGiftId =
        data.giftId ?? data.gift_id ?? data.giftDetails?.id ?? data.id ?? null;
      const giftIdStr = rawGiftId ? String(rawGiftId).trim() : "unknown";
      const rawCount =
        data.repeatCount ??
        data.repeat_count ??
        data.repeat ??
        data.comboCount ??
        1;
      const repeatCount = Math.max(
        1,
        parseInt(String(rawCount).replace(/\D/g, ""), 10) || 1,
      );
      const giftType = Number(
        data.giftType ?? data.gift_type ?? data.giftDetails?.giftType ?? 0,
      );
      const repeatEnd = !!(data.repeatEnd ?? data.repeat_end);

      console.log(
        `📥 [GIFT] eventId=${eventId}, sender=${sender}, giftId=${giftIdStr}, repeatCount=${repeatCount}, type=${giftType}, repeatEnd=${repeatEnd}`,
      );

      if (giftType === 1) {
        const streakKey =
          data.repeatId ??
          data.repeat_id ??
          data.comboId ??
          `${userId}:${sender}:${giftIdStr}`;
        let stateObj = state.getTemp("giftStreakState", streakKey) || {
          lastRepeat: 0,
          ts: Date.now(),
        };
        let delta = 0;
        if (repeatCount > stateObj.lastRepeat)
          delta = repeatCount - stateObj.lastRepeat;
        else if (repeatCount < stateObj.lastRepeat) delta = repeatCount;
        stateObj.lastRepeat = Math.max(stateObj.lastRepeat, repeatCount);
        stateObj.ts = Date.now();
        state.setTemp("giftStreakState", streakKey, stateObj, 15);

        if (repeatEnd) {
          if (delta > 0) {
            await processGiftDelta({
              userId,
              sender,
              giftIdStr,
              delta,
              newRepeat: repeatCount,
              data,
              eventId,
            });
          }
          state.delTemp("giftStreakState", streakKey);
          return;
        }
        if (delta <= 0) return;
        await processGiftDelta({
          userId,
          sender,
          giftIdStr,
          delta,
          newRepeat: repeatCount,
          data,
          eventId,
        });
      } else {
        await processGiftDelta({
          userId,
          sender,
          giftIdStr,
          delta: repeatCount,
          newRepeat: repeatCount,
          data,
          eventId,
        });
      }
    } catch (err) {
      logger.error(`❌ خطأ في GIFT handler للمستخدم ${userId}:`, err.message);
    }
  });

  async function processGiftDelta({
    userId,
    sender,
    giftIdStr,
    delta,
    newRepeat,
    data,
    eventId,
  }) {
    console.log(
      `🔁 [processGiftDelta] eventId=${eventId}, sender=${sender}, giftId=${giftIdStr}, delta=${delta}`,
    );

    try {
      const userProfile = await getUserSelectedProfile(userId);
      let giftCmd = getGiftCommandForProfile(userId, userProfile, giftIdStr);
      if (!giftCmd) {
        giftCmd = await GiftCommand.findOne({
          giftId: giftIdStr,
          profile: userProfile,
          userId,
        });
        if (giftCmd) await refreshCachesForUser(userId);
      }
      if (
        giftCmd &&
        (giftCmd.command ||
          giftCmd.webhookUrl ||
          giftCmd.combo ||
          giftCmd.audio ||
          giftCmd.video)
      ) {
        const targetOk =
          !giftCmd.targetUser ||
          normalizeUser(giftCmd.targetUser) === "all" ||
          normalizeUser(giftCmd.targetUser) === sender;
        if (targetOk) {
          const cmdObj = giftCmd.toObject
            ? { ...giftCmd.toObject() }
            : { ...giftCmd };
          const configuredRepeat = Math.max(
            1,
            parseInt(cmdObj.repeat || 1, 10) || 1,
          );
          cmdObj.repeat = configuredRepeat * delta;
          cmdObj.keystrokeText =
            cmdObj.command && cmdObj.command.trim() !== ""
              ? cmdObj.command
              : cmdObj.combo || "";
          await executeAction(cmdObj, sender, userId, data, "auto", eventId);
        } else {
          console.log(
            `⏭️ [processGiftDelta] target mismatch for eventId=${eventId}`,
          );
        }
      } else {
        console.log(
          `⏭️ [processGiftDelta] no command found for eventId=${eventId}`,
        );
      }

      // معالجة أوامر التفاعل من نوع "gift" (اختياري)
      const giftInteractions = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((i) => i.type === "gift");
      for (const ic of giftInteractions) {
        if (
          ic.targetUser &&
          normalizeUser(ic.targetUser) !== "all" &&
          normalizeUser(ic.targetUser) !== sender
        )
          continue;
        // قد ترغب في تنفيذها أيضاً مع eventId
        await executeAction(
          addKeystrokeToCommand(ic),
          sender,
          userId,
          data,
          "auto",
          eventId,
        );
      }
    } catch (err) {
      logger.error("❌ processGiftDelta error:", err.message);
    }
  }

  connection.on(WebcastEvent.FOLLOW, async (data) => {
    const eventId = generateEventId();
    updateLastActivity(userId);

    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      console.log(`👤 [FOLLOW] eventId=${eventId}, sender=${sender}`);

      const followKey = `follow:${userId}:${sender}`;
      if (state.getTemp("interactionCooldown", followKey)) {
        console.log(`⏭️ [FOLLOW] مكرر (cooldown) eventId=${eventId}`);
        return;
      }
      state.setTemp("interactionCooldown", followKey, true, 5);

      const userProfile = await getUserSelectedProfile(userId);
      const commands = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((c) => c.type === "follow" && c.active);

      for (let cmd of commands) {
        if (
          cmd.targetUser &&
          normalizeUser(cmd.targetUser) !== "all" &&
          normalizeUser(cmd.targetUser) !== sender
        )
          continue;

        const key = `${userId}:${String(cmd._id)}:${sender}`;
        if (state.getTemp("executedOncePerLive", key)) continue;
        await executeAction(
          addKeystrokeToCommand(cmd),
          sender,
          userId,
          data,
          "auto",
          eventId,
        );
        state.setTemp("executedOncePerLive", key, true, 3600);
      }
    } catch (err) {
      logger.error("❌ FOLLOW handler error:", err.message);
    }
  });

  connection.on(WebcastEvent.CHAT, async (data) => {
    const eventId = generateEventId();
    updateLastActivity(userId);

    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      const comment = (data.comment || "").toString();
      if (!comment) return;

      console.log(
        `💬 [CHAT] eventId=${eventId}, sender=${sender}, comment="${comment.substring(0, 30)}"`,
      );

      // ✅ منع تكرار نفس التعليق لنفس المستخدم خلال 5 ثوانٍ
      const chatKey = `chat:${userId}:${sender}:${comment}`;
      if (state.getTemp("interactionCooldown", chatKey)) {
        console.log(`⏭️ [CHAT] مكرر (cooldown) eventId=${eventId}`);
        return;
      }
      state.setTemp("interactionCooldown", chatKey, true, 5);

      const userProfile = await getUserSelectedProfile(userId);
      const commands = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((c) => c.type === "comment" && c.active);

      for (let cmd of commands) {
        if (
          cmd.targetUser &&
          normalizeUser(cmd.targetUser) !== "all" &&
          normalizeUser(cmd.targetUser) !== sender
        )
          continue;

        if (cmd.oncePerLive) {
          const key = `${userId}:${String(cmd._id)}`;
          if (state.getTemp("executedOncePerLive", key)) continue;
          if (
            cmd.keyword &&
            !comment.toLowerCase().includes(cmd.keyword.trim().toLowerCase())
          )
            continue;
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
          state.setTemp("executedOncePerLive", key, true, 3600);
        } else {
          if (
            cmd.keyword &&
            comment.toLowerCase().includes(cmd.keyword.trim().toLowerCase())
          ) {
            await executeAction(
              addKeystrokeToCommand(cmd),
              sender,
              userId,
              data,
              "auto",
              eventId,
            );
          } else if (!cmd.keyword) {
            await executeAction(
              addKeystrokeToCommand(cmd),
              sender,
              userId,
              data,
              "auto",
              eventId,
            );
          }
        }
      }
    } catch (err) {
      logger.error("❌ CHAT handler error:", err.message);
    }
  });

  connection.on(WebcastEvent.LIKE, async (data) => {
    const eventId = generateEventId();
    updateLastActivity(userId);

    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      console.log(`❤️ [LIKE] eventId=${eventId}, sender=${sender}`);

      const likeKey = `like:${userId}:${sender}`;
      if (state.getTemp("interactionCooldown", likeKey)) {
        console.log(`⏭️ [LIKE] مكرر (cooldown) eventId=${eventId}`);
        return;
      }
      state.setTemp("interactionCooldown", likeKey, true, 5);

      const currentTotal =
        parseInt(
          String(data.likeCount ?? data.like_count ?? data.count ?? 0).replace(
            /\D/g,
            "",
          ),
          10,
        ) || 0;
      if (currentTotal <= 0) return;

      const keyTotal = `${userId}:${sender}`;
      const lastTotal = lastLikeCount.get(keyTotal) || 0;
      let delta = currentTotal - lastTotal;

      if (delta < 0) {
        lastLikeCount.set(keyTotal, currentTotal);
        delta = currentTotal;
      } else if (delta === 0) {
        return;
      } else {
        lastLikeCount.set(keyTotal, currentTotal);
      }

      if (delta > LIKE_MAX_DELTA) delta = LIKE_MAX_DELTA;
      console.log(`📊 [LIKE] delta=${delta} for eventId=${eventId}`);

      const userProfile = await getUserSelectedProfile(userId);
      const commands = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((c) => c.type === "like" && c.active);

      for (let cmd of commands) {
        if (
          cmd.targetUser &&
          normalizeUser(cmd.targetUser) !== "all" &&
          normalizeUser(cmd.targetUser) !== sender
        )
          continue;

        if (cmd.oncePerLive) {
          const key = `${userId}:${String(cmd._id)}`;
          if (state.getTemp("executedOncePerLive", key)) continue;
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
          state.setTemp("executedOncePerLive", key, true, 3600);
          continue;
        }

        const threshold = parseInt(cmd.threshold || 0, 10) || 0;
        const keyUser = `${userId}:${String(cmd._id)}:${sender}`;
        let current = state.getTemp("likeCounters", keyUser) || 0;
        current += delta;
        state.setTemp("likeCounters", keyUser, current, 3600);

        if (threshold <= 0) {
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
          continue;
        }

        const times = Math.floor(current / threshold);
        if (times <= 0) continue;

        for (let i = 0; i < times; i++) {
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
        }
        state.setTemp(
          "likeCounters",
          keyUser,
          current - times * threshold,
          3600,
        );
        if (state.getTemp("likeCounters", keyUser) < 0)
          state.delTemp("likeCounters", keyUser);
      }
    } catch (err) {
      logger.error("❌ LIKE handler error:", err.message);
    }
  });

  connection.on(WebcastEvent.SHARE, async (data) => {
    const eventId = generateEventId();
    updateLastActivity(userId);

    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      console.log(`🔁 [SHARE] eventId=${eventId}, sender=${sender}`);

      const shareKey = `share:${userId}:${sender}`;
      if (state.getTemp("interactionCooldown", shareKey)) {
        console.log(`⏭️ [SHARE] مكرر (cooldown) eventId=${eventId}`);
        return;
      }
      state.setTemp("interactionCooldown", shareKey, true, 5);

      const userProfile = await getUserSelectedProfile(userId);
      const commands = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((c) => c.type === "share" && c.active);

      for (let cmd of commands) {
        if (
          cmd.targetUser &&
          normalizeUser(cmd.targetUser) !== "all" &&
          normalizeUser(cmd.targetUser) !== sender
        )
          continue;

        if (cmd.oncePerLive) {
          const key = `${userId}:${String(cmd._id)}`;
          if (state.getTemp("executedOncePerLive", key)) continue;
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
          state.setTemp("executedOncePerLive", key, true, 3600);
        } else {
          await executeAction(
            addKeystrokeToCommand(cmd),
            sender,
            userId,
            data,
            "auto",
            eventId,
          );
        }
      }
    } catch (err) {
      logger.error("❌ SHARE handler error:", err.message);
    }
  });

  connection.on(WebcastEvent.ROOM_UPDATE, (data) => {
    const prev = getTikTokConnection(userId)?.isLive;
    const newRoomId = data?.roomId ?? data?.room_id ?? null;
    const newIsLive =
      typeof data?.isLive === "boolean" ? data.isLive : !!newRoomId;
    if (!prev && newIsLive) resetOncePerLiveForUser(userId);
    if (prev && !newIsLive) resetOncePerLiveForUser(userId);
    const conn = getTikTokConnection(userId);
    if (conn) {
      conn.isLive = newIsLive;
      conn.roomId = newIsLive ? newRoomId : null;
      conn.lastRoomUpdate = Date.now();
      setTikTokConnection(userId, conn);
    }
  });

  connection.on(WebcastEvent.DISCONNECTED, () => {
    const conn = getTikTokConnection(userId);
    if (conn) {
      conn.isLive = false;
      conn.roomId = null;
      setTikTokConnection(userId, conn);
    }
    resetOncePerLiveForUser(userId);
    logger.info(`⚠️ تم قطع الاتصال بـ TikTok للمستخدم ${userId}`);

    // 🔄 إعادة محاولة الاتصال بعد 5 ثوانٍ (إذا كان المستخدم لا يزال يريد الاتصال)
    setTimeout(async () => {
      const currentConn = getTikTokConnection(userId);
      // إذا كان الاتصال لا يزال مقطوعاً وليس هناك محاولة جارية
      if (currentConn && !currentConn.isLive && !currentConn.reconnecting) {
        logger.info(`🔄 محاولة إعادة الاتصال للمستخدم ${userId}...`);
        currentConn.reconnecting = true;
        setTikTokConnection(userId, currentConn);
        try {
          const user = await User.findById(userId);
          if (user && user.tiktokUsername) {
            await connectUser(userId, user.tiktokUsername);
          }
        } catch (err) {
          logger.error(
            `❌ فشلت إعادة الاتصال للمستخدم ${userId}:`,
            err.message,
          );
        } finally {
          const updatedConn = getTikTokConnection(userId);
          if (updatedConn) {
            updatedConn.reconnecting = false;
            setTikTokConnection(userId, updatedConn);
          }
        }
      }
    }, 5000);
  });
  connection.on(WebcastEvent.ERROR, (err) => {
    if (err?.message?.includes("illegal tag")) return;
    logger.error(`❌ خطأ في اتصال TikTok للمستخدم ${userId}:`, err.message);
  });

  try {
    await connection.connect();
    await refreshCachesForUser(userId);
    resetOncePerLiveForUser(userId);
    setTikTokConnection(userId, {
      connection,
      username,
      isLive: true,
      roomId: null,
      lastRoomUpdate: Date.now(),
      reconnecting: false, // ✅ أضف هذا السطر
    });
    startLiveHeartbeat(userId);
    logger.info(`✅ متصل بحساب @${username} للمستخدم ${userId}`);
    return true;
  } catch (err) {
    logger.info(`⚠️ الحساب @${username} ليس لايف حالياً للمستخدم ${userId}`);
    setTikTokConnection(userId, {
      connection,
      username,
      isLive: false,
      roomId: null,
      reconnecting: false, // ✅ أضف هنا أيضاً
    });
    return false;
  }
}

// ================ نقاط نهاية المصادقة ================
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني وكلمة المرور مطلوبان",
      });
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res
        .status(400)
        .json({ success: false, message: "المستخدم موجود بالفعل" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const screenToken = crypto.randomBytes(32).toString("hex");
    const user = new User({
      email,
      password: hashedPassword,
      plan: "free",
      role: "user",
      screenToken,
      selectedProfile: 1,
      audioUsedMB: 0,
      videoUsedMB: 0,
    });
    await user.save();
    await ensureUserProfiles(user._id);
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        plan: user.plan,
        planType: user.planType,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, token });
  } catch (err) {
    logger.error("❌ خطأ في التسجيل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني وكلمة المرور مطلوبان",
      });
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "بيانات الدخول غير صحيحة" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res
        .status(401)
        .json({ success: false, message: "بيانات الدخول غير صحيحة" });
    if (!user.screenToken) {
      user.screenToken = crypto.randomBytes(32).toString("hex");
      await user.save();
    }
    await updateSubscriptionStatus(user);
    await ensureUserProfiles(user._id);
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        plan: user.plan,
        planType: user.planType,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, token });
  } catch (err) {
    logger.error("❌ خطأ في تسجيل الدخول:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/user/screen-token", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "مستخدم غير موجود" });
    let token = user.screenToken;
    if (!token) {
      token = crypto.randomBytes(32).toString("hex");
      user.screenToken = token;
      await user.save();
    }
    res.json({ success: true, token });
  } catch (err) {
    logger.error("❌ خطأ في جلب توكن الشاشة:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/admin", authenticateToken, isAdmin, (req, res) => {
  res.redirect(`${FRONTEND_URL}/admin`);
});

// ================ صفحة الشاشات ================
app.get("/screens/:token/:screenNumber", async (req, res) => {
  try {
    const { token, screenNumber } = req.params;
    const screenNum = parseInt(screenNumber.replace(".html", ""), 10);
    const unmuted = true;

    if (isNaN(screenNum) || screenNum < 1 || screenNum > 10)
      return res.status(404).send("Screen not found");

    const user = await User.findOne({ screenToken: token });
    if (!user) return res.status(404).send("Invalid screen token");

    const safeToken = JSON.stringify(token);
    const safeEmailForTitle = user.email.replace(/[&<>]/g, function (m) {
      if (m === "&") return "&amp;";
      if (m === "<") return "&lt;";
      if (m === ">") return "&gt;";
      return m;
    });
    const safeUnmuted = unmuted ? "true" : "false";

    const html = `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Screen ${screenNum} - ${safeEmailForTitle}</title>
  <style>
    html,body{ margin:0;padding:0;width:100%;height:100%; background:transparent; overflow:hidden; }
    video{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:transparent; display:none; }
    .overlay-container {
      position: fixed;
      top: 20%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: transparent;
      backdrop-filter: none;
      color: white;
      padding: 10px 20px;
      border-radius: 0;
      text-align: center;
      z-index: 9999;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      border: none;
      min-width: auto;
      box-shadow: none;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .overlay-avatar { width:100px; height:100px; border-radius:50%; object-fit:cover; border:3px solid #4caf50; background: transparent; }
    .overlay-username { font-size:20px; font-weight:bold; margin:0; text-shadow:1px 1px 2px black; }
    .overlay-text {
      font-size: 17px;
      color: #ffd966;
      background: transparent;
      padding: 3px 10px;
      border-radius: 0;
      margin-top: 2px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8), 0 0 5px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <div id="overlay" class="overlay-container">
    <img id="overlayAvatar" class="overlay-avatar" src="" alt="">
    <div id="overlayUsername" class="overlay-username"></div>
    <div id="overlayText" class="overlay-text"></div>
  </div>
  <video id="videoPlayer" autoplay playsinline ${unmuted ? "" : "muted"}></video>
  <script src="https://cdn.socket.io/4.7.1/socket.io.min.js"></script>
  <script>
  (function(){
    const SCREEN_NUMBER = ${screenNum};
    const USER_TOKEN = ${safeToken};
    const UNMUTED = ${safeUnmuted};
    console.log('🎬 Screen ' + SCREEN_NUMBER + ' loaded' + (UNMUTED ? ' (مع الصوت)' : ' (مكتوم)'));

    const AUDIO_BASE = "/audios/";
    const VIDEO_BASE = "/videos/";

    const socket = io(window.location.origin, { query: { token: USER_TOKEN }, transports: ['websocket', 'polling'] });
    let audioUnlocked = false;
    let lastPlayedSoundId = null;

    const audioQueues = {};
    const isPlaying = {};
    const currentAudio = {};

    async function tryUnlockAudio() {
      if (audioUnlocked) return true;
      try {
        if (typeof AudioContext !== 'undefined') {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (ctx.state === 'suspended') await ctx.resume();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(0);
          osc.stop(0.01);
          setTimeout(() => ctx.close(), 200);
        }
        const silentAudio = new Audio();
        silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
        silentAudio.muted = true;
        silentAudio.volume = 0;
        await silentAudio.play();
        silentAudio.pause();
        silentAudio.src = '';
        audioUnlocked = true;
        console.log('✅ فتح الصوت بنجاح (طريقة الصوت المكتوم)');
        return true;
      } catch (e) {
        console.warn('❌ فشل فتح الصوت:', e);
        return false;
      }
    }

    function processQueue(giftId) {
      if (!audioQueues[giftId] || audioQueues[giftId].length === 0) {
        isPlaying[giftId] = false;
        currentAudio[giftId] = null;
        return;
      }
      if (isPlaying[giftId]) return;
      isPlaying[giftId] = true;

      const item = audioQueues[giftId].shift();
      const a = new Audio();
      a.src = item.filename;
      a.volume = item.volume;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      currentAudio[giftId] = a;

      a.onended = () => {
        currentAudio[giftId] = null;
        isPlaying[giftId] = false;
        processQueue(giftId);
      };

      a.onerror = () => {
        console.warn('❌ خطأ في تحميل الصوت:', item.filename);
        currentAudio[giftId] = null;
        isPlaying[giftId] = false;
        processQueue(giftId);
      };

      a.play().catch(err => {
        console.warn('❌ فشل تشغيل الصوت:', err.message, item.filename);
        currentAudio[giftId] = null;
        isPlaying[giftId] = false;
        processQueue(giftId);
      });
    }

    socket.on('play-sound', async (payload) => {
      try {
        if (!payload || !payload.filename) {
          console.warn('⚠️ play-sound بدون filename');
          return;
        }
        if (payload.screen && payload.screen !== SCREEN_NUMBER) return;

        if (!audioUnlocked) await tryUnlockAudio();

        const giftId = payload.giftId || 'default';
        const vol100 = typeof payload.volume !== 'undefined' ? Number(payload.volume) : 100;
        const vol = Math.min(100, Math.max(0, vol100)) / 100;

        let src = payload.filename;
        if (!src.startsWith('http://') && !src.startsWith('https://')) {
          if (src.startsWith('/audios/')) src = src.substring(8);
          src = AUDIO_BASE + encodeURIComponent(src);
        }

        console.log('🔊 تشغيل الصوت من المسار:', src);
        if (!audioQueues[giftId]) audioQueues[giftId] = [];
        audioQueues[giftId].push({ filename: src, volume: vol });
        if (!isPlaying[giftId]) processQueue(giftId);
      } catch (err) {
        console.error('play-sound handler error', err);
      }
    });

    socket.on('stop-sound', () => {
      for (const giftId in currentAudio) {
        if (currentAudio[giftId]) {
          try {
            currentAudio[giftId].pause();
            currentAudio[giftId].currentTime = 0;
            currentAudio[giftId].src = '';
            currentAudio[giftId].load();
          } catch(e) {}
          currentAudio[giftId] = null;
        }
        if (audioQueues[giftId]) audioQueues[giftId] = [];
        isPlaying[giftId] = false;
      }
    });

    const video = document.getElementById('videoPlayer');
    const videoQueue = [];
    let isVideoPlaying = false;
    let videoVolume = 1;

    video.muted = !UNMUTED;
    video.volume = UNMUTED ? videoVolume : 0;

    function playNextVideo() {
      if (isVideoPlaying || videoQueue.length === 0) return;
      const src = videoQueue.shift();
      isVideoPlaying = true;
      video.src = src;
      video.muted = true;
      video.volume = 0;
      video.style.display = 'block';

      video.play().then(() => {
        if (UNMUTED) {
          video.muted = false;
          video.volume = videoVolume;
          console.log('🔊 تم إلغاء كتم الفيديو بعد التشغيل');
        } else {
          video.muted = true;
          video.volume = 0;
        }
      }).catch(e => console.warn('video autoplay blocked', e));

      video.onended = () => {
        isVideoPlaying = false;
        video.style.display = 'none';
        video.src = '';
        playNextVideo();
      };
    }

    if (UNMUTED) {
      document.body.addEventListener('click', () => {
        if (video.muted) {
          video.muted = false;
          video.volume = videoVolume;
          console.log('🔊 تم إلغاء كتم الفيديو بعد النقرة');
        }
      });
    }

    socket.on('gift-video', (data) => {
      try {
        if (data.screen !== SCREEN_NUMBER) return;
        if (data.volume !== undefined) {
          videoVolume = Math.min(1, Math.max(0, Number(data.volume) / 100));
          if (!video.muted) video.volume = videoVolume;
        }
        let vidName = data.videoId;
        if (!vidName.startsWith('http://') && !vidName.startsWith('https://')) {
          vidName = VIDEO_BASE + encodeURIComponent(vidName);
        }
        console.log('🎬 Screen ' + SCREEN_NUMBER + ' playing:', vidName);
        videoQueue.push(vidName);
        playNextVideo();
      } catch (err) {
        console.error('gift-video handler error', err);
      }
    });

    socket.on('stop-video', () => {
      if (video && !video.paused) {
        video.pause();
        video.currentTime = 0;
        video.style.display = 'none';
        isVideoPlaying = false;
        while(videoQueue.length) videoQueue.pop();
      }
    });

    const overlayDiv = document.getElementById('overlay');
    const overlayAvatar = document.getElementById('overlayAvatar');
    const overlayUsername = document.getElementById('overlayUsername');
    const overlayText = document.getElementById('overlayText');
    let overlayTimeout = null;

    socket.on('show-overlay', (data) => {
      try {
        if (!data) return;
        if (data.screen && data.screen !== SCREEN_NUMBER) return;

        console.log('📢 استقبال تراكب للشاشة ' + SCREEN_NUMBER + ':', data);

        const avatarSrc = data.avatar || 'https://via.placeholder.com/70?text=User';
        overlayAvatar.src = avatarSrc;
        overlayAvatar.onerror = () => {
          overlayAvatar.src = 'https://via.placeholder.com/70?text=User';
        };

        overlayUsername.textContent = data.username || 'مستخدم';
        overlayText.textContent = data.text || '';
        overlayDiv.style.display = 'flex';

        if (overlayTimeout) clearTimeout(overlayTimeout);
        overlayTimeout = setTimeout(() => {
          overlayDiv.style.display = 'none';
        }, data.duration || 5000);
      } catch (err) {
        console.error('خطأ في عرض التراكب:', err);
      }
    });

    socket.on('connect_error', (err) => console.warn('socket connect_error', err));
    socket.on('connect', () => console.log('✅ Socket connected'));
  })();
  <\/script>
</body>
</html>`;
    res.send(html);
  } catch (err) {
    logger.error("❌ Error serving screen:", err.message);
    res.status(500).send("Internal server error");
  }
});

// ================ PayPal ================
app.post(
  "/api/paypal/subscription-created",
  authenticateToken,
  async (req, res) => {
    try {
      const { subscriptionId, planType } = req.body;
      if (!subscriptionId || !planType)
        return res
          .status(400)
          .json({ success: false, message: "Invalid data" });
      await PaypalSubscription.create({
        subscriptionId,
        userId: req.user.id,
        planType,
        status: "PENDING",
      });
      res.json({ success: true });
    } catch (err) {
      logger.error("Subscription creation error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post(
  "/api/paypal/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const event = req.body;
      logger.info("PayPal webhook event:", event.event_type);
      if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") {
        const subscriptionId = event.resource.id;
        const sub = await PaypalSubscription.findOne({ subscriptionId });
        if (sub && sub.status === "PENDING") {
          const user = await User.findById(sub.userId);
          if (user) {
            const now = new Date();
            const expiry = new Date(now);
            if (sub.planType === "monthly") expiry.setMonth(now.getMonth() + 1);
            else expiry.setFullYear(now.getFullYear() + 1);
            user.plan = "paid";
            user.planType = sub.planType;
            user.subscriptionExpiry = expiry;
            user.subscriptionGracePeriodEnd = null;
            user.subscriptionWarningSent = false;
            await user.save();
            sub.status = "ACTIVE";
            await sub.save();
            logger.info(`Subscription activated for user ${user.email}`);
          }
        }
      } else if (event.event_type === "BILLING.SUBSCRIPTION.CANCELLED") {
        const subscriptionId = event.resource.id;
        const sub = await PaypalSubscription.findOne({ subscriptionId });
        if (sub && sub.status === "ACTIVE") {
          const user = await User.findById(sub.userId);
          if (user) {
            user.plan = "free";
            user.planType = null;
            user.subscriptionExpiry = null;
            user.subscriptionGracePeriodEnd = null;
            user.subscriptionWarningSent = false;
            await user.save();
          }
          sub.status = "CANCELLED";
          await sub.save();
          logger.info(`Subscription cancelled for user ${user?.email}`);
        }
      }
      res.sendStatus(200);
    } catch (err) {
      logger.error("Webhook error:", err);
      res.sendStatus(500);
    }
  },
);

// ================ حذف ملفات ================
app.delete("/api/audio/:filename", authenticateToken, async (req, res) => {
  try {
    const filename = req.params.filename;
    const keep = req.query.keep === "true";
    const audioDoc = await Audio.findOne({ file: filename });
    if (!audioDoc)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود" });
    if (audioDoc.userId.toString() !== req.user.id)
      return res
        .status(403)
        .json({ success: false, message: "غير مصرح لك بحذف هذا الملف" });

    if (!keep) {
      const basePublicId = path.parse(filename).name;
      await cloudinary.uploader.destroy(`blackmoon_audio/${basePublicId}`, {
        resource_type: "raw",
      });
    }
    const user = await User.findById(req.user.id);
    if (user) {
      user.audioUsedMB = Math.max(0, user.audioUsedMB - audioDoc.sizeMB);
      await user.save();
    }
    await Audio.deleteOne({ file: filename });

    const updatedUser = await User.findById(req.user.id);
    const storageData = {
      audio: {
        usedMB: updatedUser.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - updatedUser.audioUsedMB),
      },
      video: {
        usedMB: updatedUser.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - updatedUser.videoUsedMB),
      },
    };
    io.to(`user-${req.user.id}`).emit("storage-update", storageData);
    res.json({
      success: true,
      message: keep
        ? "تم حذف الصوت من قاعدة البيانات (مع الاحتفاظ بالنسخة في السحابة)"
        : "تم حذف الصوت بالكامل",
      storage: storageData,
    });
  } catch (err) {
    logger.error("❌ خطأ في حذف الصوت:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/video/:filename", authenticateToken, async (req, res) => {
  try {
    const filename = req.params.filename;
    const keep = req.query.keep === "true";
    const videoDoc = await Video.findOne({ file: filename });
    if (!videoDoc)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود" });
    if (videoDoc.userId.toString() !== req.user.id)
      return res
        .status(403)
        .json({ success: false, message: "غير مصرح لك بحذف هذا الملف" });

    if (!keep) {
      const basePublicId = path.parse(filename).name;
      await cloudinary.uploader.destroy(`blackmoon_videos/${basePublicId}`, {
        resource_type: "video",
      });
    }
    const user = await User.findById(req.user.id);
    if (user) {
      user.videoUsedMB = Math.max(0, user.videoUsedMB - videoDoc.sizeMB);
      await user.save();
    }
    await Video.deleteOne({ file: filename });
    await GiftCommand.updateMany(
      { video: filename },
      { $set: { video: null } },
    );
    await InteractionCommand.updateMany(
      { video: filename },
      { $set: { video: null } },
    );

    const updatedUser = await User.findById(req.user.id);
    const storageData = {
      audio: {
        usedMB: updatedUser.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - updatedUser.audioUsedMB),
      },
      video: {
        usedMB: updatedUser.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - updatedUser.videoUsedMB),
      },
    };
    io.to(`user-${req.user.id}`).emit("storage-update", storageData);
    res.json({
      success: true,
      message: keep
        ? "تم حذف الفيديو من قاعدة البيانات (مع الاحتفاظ بالنسخة في السحابة)"
        : "تم حذف الفيديو بالكامل",
      storage: storageData,
    });
  } catch (err) {
    logger.error("❌ خطأ في حذف الفيديو:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ التخزين والاشتراك ================
app.get("/api/user/storage", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "مستخدم غير موجود" });
    res.json({
      success: true,
      audio: {
        usedMB: user.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - user.audioUsedMB),
      },
      video: {
        usedMB: user.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - user.videoUsedMB),
      },
    });
  } catch (err) {
    logger.error("❌ خطأ في جلب معلومات التخزين:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/user/subscription", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "مستخدم غير موجود" });
    const subscriptionInfo = await updateSubscriptionStatus(user);
    res.json({ success: true, subscription: subscriptionInfo });
  } catch (err) {
    logger.error("❌ خطأ في جلب معلومات الاشتراك:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/auth/me", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user)
    return res
      .status(404)
      .json({ success: false, message: "مستخدم غير موجود" });
  const subscriptionInfo = await updateSubscriptionStatus(user);
  res.json({
    success: true,
    user: {
      id: user._id,
      email: user.email,
      plan: user.plan,
      planType: user.planType,
      subscriptionExpiry: user.subscriptionExpiry,
      role: user.role,
      tiktokUsername: user.tiktokUsername,
      selectedProfile: user.selectedProfile,
    },
    subscription: subscriptionInfo,
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
  res.json({ success: true, message: "تم تسجيل الخروج" });
});

app.delete("/api/auth/delete", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const giftCommands = await GiftCommand.find({ userId });
    const interactionCommands = await InteractionCommand.find({ userId });
    const allCommands = [...giftCommands, ...interactionCommands];
    for (const cmd of allCommands) {
      await deleteFilesForCommand(cmd, userId);
    }
    await GiftCommand.deleteMany({ userId });
    await InteractionCommand.deleteMany({ userId });
    await Audio.deleteMany({ userId });
    await Video.deleteMany({ userId });
    await Profile.deleteMany({ owner: userId });
    await User.findByIdAndDelete(userId);
    res.clearCookie("token");
    res.json({
      success: true,
      message: "تم حذف الحساب وجميع البيانات المرتبطة",
    });
  } catch (err) {
    logger.error("❌ خطأ في حذف الحساب:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/auth/refresh", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false });
    await updateSubscriptionStatus(user);
    const newToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        plan: user.plan,
        planType: user.planType,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
    res.cookie("token", newToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true });
  } catch (err) {
    logger.error("Refresh token error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/tiktok-disconnect", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    deleteTikTokConnection(userId);
    resetOncePerLiveForUser(userId);
    res.json({ success: true, message: "تم قطع الاتصال" });
  } catch (err) {
    logger.error("❌ خطأ في قطع الاتصال:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/tiktok-user", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    deleteTikTokConnection(userId);
    const user = await User.findById(userId);
    await user.save();
    res.json({ success: true, message: "تم قطع الاتصال وحذف الاسم" });
  } catch (err) {
    logger.error("❌ خطأ في قطع الاتصال:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/tiktok-user", authenticateToken, async (req, res) => {
  const { username, connect = true } = req.body;
  if (!username)
    return res
      .status(400)
      .json({ success: false, message: "اسم المستخدم مطلوب" });
  const userId = req.user.id;
  const user = await User.findById(userId);
  user.tiktokUsername = username;
  await user.save();
  if (connect) {
    await connectUser(userId, username);
  }
  res.json({ success: true });
});

app.get("/api/live-status", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  await refreshCachesForUser(userId);
  const connection = getTikTokConnection(userId);
  const isLive = connection ? connection.isLive : false;
  const user = await User.findById(userId);
  const username = user?.tiktokUsername || null;
  res.json({ isLive, username });
});

app.get("/api/profiles", authenticateToken, async (req, res) => {
  try {
    await ensureUserProfiles(req.user.id);
    const profiles = await Profile.find({ owner: req.user.id }).sort({ id: 1 });
    const plan = await getUserPlan(req.user.id);
    if (plan === "free")
      return res.json({
        success: true,
        profiles: profiles.filter((p) => p.id === 1),
      });
    res.json({ success: true, profiles });
  } catch (err) {
    logger.error("❌ خطأ في جلب البروفايلات:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== إنشاء أمر تفاعل جديد =====
app.post("/api/interaction-commands", authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const user = await User.findById(req.user.id);
    const profile = Math.max(
      1,
      Math.min(
        MAX_PROFILES,
        parseInt(payload.profile || user.selectedProfile, 10) ||
          user.selectedProfile,
      ),
    );
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: "لا يمكنك إنشاء أوامر لهذا البروفايل في النسخة المجانية. قم بالترقية.",
      });
    }

    const plan = await getUserPlan(req.user.id);
    if (plan === "free") {
      const total = await getTotalCommandsForUser(req.user.id);
      if (total >= 7) {
        return res.status(403).json({
          success: false,
          message: "لقد وصلت للحد الأقصى للأوامر (7) في النسخة المجانية. قم بالترقية لإضافة المزيد.",
        });
      }
    }

    const { type } = payload;
    if (!type || !["follow", "like", "comment", "share", "gift", "all"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: `النوع غير مدعوم. الأنواع المسموحة: follow, like, comment, share, gift, all`,
      });
    }

    // التحقق من عدم تكرار الـ combo لنفس المستخدم والبروفايل (إذا تم توفيره)
    if (payload.combo && payload.combo.trim() !== "") {
      const existingCombo = await InteractionCommand.findOne({
        userId: req.user.id,
        profile,
        combo: payload.combo.trim(),
      });
      if (existingCombo) {
        return res.status(400).json({
          success: false,
          message: "هذا الاختصار موجود بالفعل في هذا البروفايل",
        });
      }
    }

    const newCommand = await InteractionCommand.create({
      type: payload.type,
      combo: payload.combo || null,
      name: payload.name || "",
      command: payload.command || "",
      webhookUrl: payload.webhookUrl || "",
      repeat: parseInt(payload.repeat || 1, 10) || 1,
      interval: parseInt(payload.interval || 500, 10) || 500,
      delayBefore: parseInt(payload.delayBefore || 0, 10) || 0,
      audio: payload.audio || null,
      volume: parseInt(payload.volume || 100, 10) || 100,
      video: payload.video || null,
      videoVolume: parseInt(payload.videoVolume || 100, 10) || 100,
      screen: parseInt(payload.screen || 1, 10) || 1,
      targetUser: payload.targetUser || "all",
      active: payload.active !== false,
      playSound: payload.playSound !== false,
      playVideo: payload.playVideo !== false,
      keyword: payload.keyword || "",
      threshold: parseInt(payload.threshold || 0, 10) || 0,
      oncePerLive: !!payload.oncePerLive,
      profile: profile,
      userId: req.user.id,
      showOverlay: payload.showOverlay === true,
      overlayText: payload.overlayText || "",
      duration: parseInt(payload.duration) || 5,
    });

    await enforceFreePlanLimits(req.user.id, profile);
    await refreshCachesForUser(req.user.id);

    res.json({ success: true, command: newCommand });
  } catch (err) {
    logger.error("❌ خطأ في إنشاء أمر التفاعل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(
  "/api/profiles/copy/:sourceId",
  authenticateToken,
  async (req, res) => {
    try {
      const plan = await getUserPlan(req.user.id);
      if (plan !== "paid")
        return res.status(403).json({
          success: false,
          message: "لا يمكنك نسخ بروفايل في النسخة المجانية",
        });

      const sourceId = parseInt(req.params.sourceId);
      if (sourceId < 1 || sourceId > MAX_PROFILES)
        return res
          .status(400)
          .json({ success: false, message: "مصدر غير صالح" });

      const { targetProfile } = req.body;
      if (!targetProfile)
        return res.status(400).json({
          success: false,
          message: "يجب تحديد البروفايل المستهدف (targetProfile) بين 1 و 20",
        });

      const targetId = parseInt(targetProfile);
      if (targetId < 1 || targetId > MAX_PROFILES)
        return res
          .status(400)
          .json({ success: false, message: "البروفايل المستهدف غير صالح" });

      const sourceProfile = await Profile.findOne({
        owner: req.user.id,
        id: sourceId,
      });
      if (!sourceProfile)
        return res
          .status(404)
          .json({ success: false, message: "البروفايل المصدر غير موجود" });

      const targetProfileDoc = await Profile.findOne({
        owner: req.user.id,
        id: targetId,
      });
      if (!targetProfileDoc)
        return res
          .status(404)
          .json({ success: false, message: "البروفايل المستهدف غير موجود" });

      await GiftCommand.deleteMany({ userId: req.user.id, profile: targetId });
      await InteractionCommand.deleteMany({
        userId: req.user.id,
        profile: targetId,
      });

      const giftCommands = await GiftCommand.find({
        userId: req.user.id,
        profile: sourceId,
      });

      async function deepCopyMedia(file, userId, type) {
        if (!file) return null;
        if (file.startsWith("/audios/") || file.startsWith("/videos/")) {
          return file;
        }
        if (file.startsWith("http://") || file.startsWith("https://")) {
          const newFile = await uploadFileFromUrl(file, userId, type);
          return newFile || null;
        }
        const Model = type === "audio" ? Audio : Video;
        const doc = await Model.findOne({ file, userId });
        if (doc) {
          const cloudUrl =
            doc.cloudinaryUrl ||
            `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/${
              type === "audio" ? "raw/upload" : "video/upload"
            }/${file}`;
          const newFile = await uploadFileFromUrl(cloudUrl, userId, type);
          return newFile || null;
        }
        return null;
      }

      for (const cmd of giftCommands) {
        const newCmd = cmd.toObject();
        delete newCmd._id;
        newCmd.profile = targetId;
        newCmd.userId = req.user.id;
        newCmd.audio = await deepCopyMedia(newCmd.audio, req.user.id, "audio");
        newCmd.video = await deepCopyMedia(newCmd.video, req.user.id, "video");
        await GiftCommand.create(newCmd);
      }

      const interactionCommands = await InteractionCommand.find({
        userId: req.user.id,
        profile: sourceId,
      });
      for (const cmd of interactionCommands) {
        const newCmd = cmd.toObject();
        delete newCmd._id;
        newCmd.profile = targetId;
        newCmd.userId = req.user.id;
        newCmd.audio = await deepCopyMedia(newCmd.audio, req.user.id, "audio");
        newCmd.video = await deepCopyMedia(newCmd.video, req.user.id, "video");
        await InteractionCommand.create(newCmd);
      }

      await refreshCachesForUser(req.user.id);
      res.json({
        success: true,
        message: `تم نسخ الأوامر من البروفايل ${sourceId} إلى البروفايل ${targetId} (مع نسخ مستقل لجميع الوسائط)`,
      });
    } catch (err) {
      logger.error("❌ خطأ في نسخ البروفايل:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.get(
  "/api/profiles/export/:profileId",
  authenticateToken,
  async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId);
      const canAccess = await canAccessProfile(req.user.id, profileId);
      if (!canAccess)
        return res
          .status(403)
          .json({ success: false, message: "لا يمكن الوصول" });

      const gifts = await GiftCommand.find({
        userId: req.user.id,
        profile: profileId,
      }).lean();
      const interactions = await InteractionCommand.find({
        userId: req.user.id,
        profile: profileId,
      }).lean();

      const resolveMediaUrl = async (file, type) => {
        if (!file) return null;
        if (file.startsWith("/audios/") || file.startsWith("/videos/"))
          return file;
        if (file.startsWith("http")) return file;
        const Model = type === "audio" ? Audio : Video;
        const doc = await Model.findOne({ file, userId: req.user.id });
        if (doc && doc.cloudinaryUrl) return doc.cloudinaryUrl;
        const resource = type === "audio" ? "raw/upload" : "video/upload";
        return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/${resource}/${file}`;
      };

      const enrichedGifts = [];
      for (let cmd of gifts) {
        const newCmd = { ...cmd };
        newCmd.audio = await resolveMediaUrl(cmd.audio, "audio");
        newCmd.video = await resolveMediaUrl(cmd.video, "video");
        enrichedGifts.push(newCmd);
      }

      const enrichedInteractions = [];
      for (let cmd of interactions) {
        const newCmd = { ...cmd };
        newCmd.audio = await resolveMediaUrl(cmd.audio, "audio");
        newCmd.video = await resolveMediaUrl(cmd.video, "video");
        enrichedInteractions.push(newCmd);
      }

      res.json({
        success: true,
        data: {
          profileId,
          gifts: enrichedGifts,
          interactions: enrichedInteractions,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post("/api/profiles/import-shared", authenticateToken, async (req, res) => {
  try {
    const { data, targetProfile } = req.body;
    if (!data || !targetProfile)
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });

    const targetId = parseInt(targetProfile);
    if (targetId < 1 || targetId > MAX_PROFILES)
      return res
        .status(400)
        .json({ success: false, message: "بروفايل غير صالح" });

    const canAccess = await canAccessProfile(req.user.id, targetId);
    if (!canAccess)
      return res
        .status(403)
        .json({ success: false, message: "لا يمكن الوصول" });

    await GiftCommand.deleteMany({ userId: req.user.id, profile: targetId });
    await InteractionCommand.deleteMany({
      userId: req.user.id,
      profile: targetId,
    });

    const uploadMedia = async (url, type) => {
      if (!url) return null;
      if (url.startsWith("/audios/") || url.startsWith("/videos/")) return url;
      try {
        return await uploadFileFromUrl(url, req.user.id, type);
      } catch (err) {
        logger.warn(`فشل رفع ${type} من ${url}`);
        return null;
      }
    };

    for (let cmd of data.gifts || []) {
      const newCmd = { ...cmd };
      delete newCmd._id;
      newCmd.userId = req.user.id;
      newCmd.profile = targetId;
      newCmd.audio = await uploadMedia(newCmd.audio, "audio");
      newCmd.video = await uploadMedia(newCmd.video, "video");
      await GiftCommand.create(newCmd);
    }

    for (let cmd of data.interactions || []) {
      const newCmd = { ...cmd };
      delete newCmd._id;
      newCmd.userId = req.user.id;
      newCmd.profile = targetId;
      newCmd.audio = await uploadMedia(newCmd.audio, "audio");
      newCmd.video = await uploadMedia(newCmd.video, "video");
      await InteractionCommand.create(newCmd);
    }

    await refreshCachesForUser(req.user.id);
    res.json({
      success: true,
      message: `تم استيراد البروفايل إلى ${targetId}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

async function getDefaultAudios() {
  const audiosDir = path.join(__dirname, "audios");
  if (!fs.existsSync(audiosDir)) return [];
  const files = fs.readdirSync(audiosDir);
  const audioFiles = files.filter((f) => /\.(mp3|wav|ogg)$/i.test(f));
  return audioFiles.map((filename) => ({
    name: path.parse(filename).name,
    file: `/audios/${filename}`,
    cloudinaryUrl: null,
    sizeMB: null,
    isDefault: true,
    userId: null,
  }));
}

app.get("/api/gifts", async (req, res) => {
  try {
    let gifts = await Gift.find().sort({ diamond_count: 1 });
    gifts = gifts.map((g) => {
      const gift = g.toObject();
      if (!gift.image?.url_list?.length) {
        const name = encodeURIComponent(gift.name || "Gift");
        gift.image = {
          url_list: [
            `https://via.placeholder.com/100/4caf50/ffffff?text=${name}`,
          ],
        };
      }
      return gift;
    });
    res.json({ success: true, gifts });
  } catch (err) {
    logger.error("❌ خطأ في جلب الهدايا:", err.message);
    res.status(500).json({ success: false, gifts: [] });
  }
});

app.get("/api/audio", authenticateToken, async (req, res) => {
  try {
    const userAudios = await Audio.find({ userId: req.user.id }).sort({
      name: 1,
    });
    const defaultAudios = await getDefaultAudios();
    const combined = [
      ...defaultAudios,
      ...userAudios.map((a) => ({ ...a.toObject(), isDefault: false })),
    ];
    res.json({ success: true, audios: combined });
  } catch (err) {
    logger.error("❌ خطأ في جلب الأصوات:", err.message);
    res.status(500).json({ success: false, audios: [] });
  }
});

app.get("/api/videos", authenticateToken, async (req, res) => {
  try {
    const videos = await Video.find({ userId: req.user.id }).sort({
      createdAt: -1,
    });
    res.json({ success: true, videos });
  } catch (err) {
    logger.error("❌ خطأ في جلب الفيديوهات:", err.message);
    res.status(500).json({ success: false, videos: [] });
  }
});

app.get("/api/streamer", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const conn = getTikTokConnection(userId);
  const isLive = conn ? conn.isLive : false;
  const user = await User.findById(userId);
  const username = user?.tiktokUsername || null;

  let nickname = username;
  let profilePicture = "";

  if (conn && conn.connection && conn.connection.state?.roomInfo?.data) {
    const roomInfo = conn.connection.state.roomInfo.data;
    const owner = roomInfo.owner || {};
    if (owner.nickname) nickname = owner.nickname;
    if (owner.avatar_thumb?.url_list?.[0]) {
      profilePicture = owner.avatar_thumb.url_list[0];
    } else if (owner.avatar_thumb_medium?.url_list?.[0]) {
      profilePicture = owner.avatar_thumb_medium.url_list[0];
    }
    if (roomInfo.roomId) isLive = true;
  }

  if (!profilePicture && username) {
    try {
      const info = await fetchTikTokUserInfo(username);
      if (info.nickname) nickname = info.nickname;
      if (info.avatar) profilePicture = info.avatar;
    } catch (err) {
      logger.warn(`⚠️ فشل جلب معلومات المستخدم ${username}:`, err.message);
    }
  }

  res.json({ isLive, username, nickname, profilePicture });
});

app.get("/api/rcon-config", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const config = user.rconConfig || {
    host: DEFAULT_RCON_HOST,
    port: DEFAULT_RCON_PORT,
    password: DEFAULT_RCON_PASSWORD,
    player: DEFAULT_RCON_PLAYER,
  };
  res.json(config);
});

app.post("/api/rcon-config", authenticateToken, async (req, res) => {
  const { host, port, password, player } = req.body;
  const user = await User.findById(req.user.id);
  user.rconConfig = { host, port: parseInt(port), password, player };
  await user.save();
  const key = user._id.toString();
  if (state.userRconInstances.has(key)) {
    try {
      state.userRconInstances.get(key).rcon.disconnect();
    } catch (e) {}
    state.userRconInstances.delete(key);
  }
  res.json({ success: true, config: user.rconConfig });
});

app.post("/api/profile/select", authenticateToken, async (req, res) => {
  try {
    const p = parseInt(req.body.profile, 10);
    if (!p || p < 1 || p > MAX_PROFILES)
      return res.status(400).json({
        success: false,
        message: `يجب أن يكون البروفايل بين 1 و ${MAX_PROFILES}`,
      });
    const canAccess = await canAccessProfile(req.user.id, p);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message:
          "لا يمكنك الوصول إلى هذا البروفايل في النسخة المجانية. قم بالترقية.",
      });
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "مستخدم غير موجود" });
    user.selectedProfile = p;
    await user.save();
    await Profile.updateMany(
      { owner: req.user.id },
      { $set: { active: false } },
    );
    await Profile.updateOne(
      { owner: req.user.id, id: p },
      { $set: { active: true } },
    );
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, profile: p });
  } catch (err) {
    logger.error("❌ خطأ في تبديل البروفايل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put("/api/profile/:id/name", authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const { name } = req.body;
    if (!profileId || profileId < 1 || profileId > MAX_PROFILES)
      return res
        .status(400)
        .json({ success: false, message: "معرف بروفايل غير صالح" });
    if (!name || name.trim() === "")
      return res.status(400).json({ success: false, message: "الاسم مطلوب" });
    const canAccess = await canAccessProfile(req.user.id, profileId);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك تعديل هذا البروفايل في النسخة المجانية",
      });
    await Profile.updateOne(
      { owner: req.user.id, id: profileId },
      { $set: { name: name.trim() } },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (err) {
    logger.error("❌ خطأ في تحديث اسم البروفايل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/gift-commands", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const p = req.query.profile
      ? Math.max(
          1,
          Math.min(MAX_PROFILES, parseInt(req.query.profile, 10) || 1),
        )
      : user
        ? user.selectedProfile
        : 1;
    const canAccess = await canAccessProfile(req.user.id, p);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك الوصول إلى أوامر هذا البروفايل",
      });
    const gifts = await GiftCommand.find({
      userId: req.user.id,
      profile: p,
    }).sort({ createdAt: -1 });
    res.json({ success: true, gifts });
  } catch (err) {
    logger.error("❌ خطأ في جلب أوامر الهدايا:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/gift-commands/:id", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "معرف غير صالح" });
    }
    const gift = await GiftCommand.findById(req.params.id);
    if (!gift) {
      return res
        .status(404)
        .json({ success: false, message: "الأمر غير موجود" });
    }
    if (gift.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "غير مصرح به" });
    }
    res.json({ success: true, gift });
  } catch (err) {
    logger.error("❌ خطأ في جلب أمر الهدية:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(
  "/api/gift-commands/:id/execute",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return res
          .status(400)
          .json({ success: false, message: "معرف غير صالح" });
      const gift = await GiftCommand.findById(req.params.id);
      if (!gift)
        return res.status(404).json({ success: false, message: "غير موجود" });
      if (gift.userId.toString() !== req.user.id)
        return res.status(403).json({ success: false, message: "غير مصرح به" });
      const canAccess = await canAccessProfile(req.user.id, gift.profile);
      if (!canAccess)
        return res.status(403).json({
          success: false,
          message: "لا يمكنك تنفيذ أمر من بروفايل غير مصرح به",
        });
      const count = Math.max(1, parseInt(req.body?.count || 1, 10) || 1);
      const timesToRun = Math.min(count, 10);
      const requestedScreen = req.body?.screen
        ? parseInt(req.body.screen)
        : null;
      const cmdObj = gift.toObject ? { ...gift.toObject() } : { ...gift };
      const configuredRepeat = Math.max(
        1,
        parseInt(cmdObj.repeat || 1, 10) || 1,
      );
      const keystrokeText =
        cmdObj.command && cmdObj.command.trim() !== ""
          ? cmdObj.command
          : cmdObj.combo || "";
      for (let t = 0; t < timesToRun; t++) {
        const one = {
          ...cmdObj,
          repeat: configuredRepeat,
          screen: requestedScreen || cmdObj.screen || 1,
          keystrokeText,
          combo: cmdObj.combo,
        };
        await executeAction(one, "StreamMoon", req.user.id, null, "manual");
        if (t < timesToRun - 1 && cmdObj.interval > 0)
          await new Promise((r) => setTimeout(r, cmdObj.interval));
      }
      res.json({ success: true, message: "تم التنفيذ", count: timesToRun });
    } catch (err) {
      logger.error("❌ خطأ في تنفيذ أمر الهدية:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.get(
  "/api/interaction-commands/:id",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .json({ success: false, message: "معرف غير صالح" });
      }
      const cmd = await InteractionCommand.findById(req.params.id);
      if (!cmd) {
        return res
          .status(404)
          .json({ success: false, message: "الأمر غير موجود" });
      }
      if (cmd.userId.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: "غير مصرح به" });
      }
      res.json({ success: true, command: cmd });
    } catch (err) {
      logger.error("❌ خطأ في جلب أمر التفاعل:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post("/api/gift-commands", authenticateToken, async (req, res) => {
  try {
    const body = req.body;
    const user = await User.findById(req.user.id);
    const profile = Math.max(
      1,
      Math.min(
        MAX_PROFILES,
        parseInt(body.profile || user.selectedProfile, 10) ||
          user.selectedProfile,
      ),
    );
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message:
          "لا يمكنك إنشاء أوامر لهذا البروفايل في النسخة المجانية. قم بالترقية.",
      });

    if (!body.giftId && body.giftId !== 0)
      return res.status(400).json({ success: false, message: "giftId مطلوب" });
    const giftIdToSave = String(body.giftId).trim();
    const exists = await GiftCommand.findOne({
      userId: req.user.id,
      giftId: giftIdToSave,
      profile,
    });
    if (exists)
      return res.status(400).json({
        success: false,
        message: "هذا giftId موجود مسبقاً في هذا البروفايل",
      });

    const newGift = await GiftCommand.create({
      giftId: giftIdToSave,
      name: body.name || `Gift ${giftIdToSave}`,
      command: body.command || "",
      webhookUrl: body.webhookUrl || "",
      repeat: parseInt(body.repeat || 1, 10) || 1,
      interval: parseInt(body.interval || 500, 10) || 500,
      delayBefore: parseInt(body.delayBefore || 0, 10) || 0,
      audio: body.audio || null,
      volume: parseInt(body.volume || 100, 10) || 100,
      video: body.video || null,
      videoVolume: parseInt(body.videoVolume || 100, 10) || 100,
      screen: parseInt(body.screen || 1, 10) || 1,
      targetUser: body.targetUser || "all",
      active: body.active !== false,
      playSound: body.playSound !== false,
      playVideo: body.playVideo !== false,
      oncePerLive: !!body.oncePerLive,
      profile,
      userId: req.user.id,
      combo: body.combo || null,
      showOverlay: body.showOverlay === true,
      overlayText: body.overlayText || "",
      duration: parseInt(body.duration) || 5,
    });

    await enforceFreePlanLimits(req.user.id, profile);
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, gift: newGift });
  } catch (err) {
    logger.error("❌ خطأ في إنشاء أمر الهدية:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put("/api/gift-commands/:id", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: "معرف غير صالح" });
    const gift = await GiftCommand.findById(req.params.id);
    if (!gift)
      return res.status(404).json({ success: false, message: "غير موجود" });
    if (gift.userId.toString() !== req.user.id)
      return res.status(403).json({ success: false, message: "غير مصرح به" });
    const canAccess = await canAccessProfile(req.user.id, gift.profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك تعديل أمر من بروفايل غير مصرح به",
      });
    Object.assign(gift, req.body);
    await gift.save();
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, gift });
  } catch (err) {
    logger.error("❌ خطأ في تحديث أمر الهدية:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/gift-commands/:id", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "معرف غير صالح" });
    }
    const gift = await GiftCommand.findById(req.params.id);
    if (!gift) {
      return res.status(200).json({
        success: true,
        message: "الأمر غير موجود، تم اعتباره محذوفاً",
        alreadyDeleted: true,
      });
    }
    if (gift.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "غير مصرح به" });
    }
    await deleteFilesForCommand(gift, req.user.id);
    await GiftCommand.findByIdAndDelete(req.params.id);
    await refreshCachesForUser(req.user.id);
    const updatedUser = await User.findById(req.user.id);
    const storageData = {
      audio: {
        usedMB: updatedUser.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - updatedUser.audioUsedMB),
      },
      video: {
        usedMB: updatedUser.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - updatedUser.videoUsedMB),
      },
    };
    io.to(`user-${req.user.id}`).emit("storage-update", storageData);
    res.json({ success: true, storage: storageData });
  } catch (err) {
    logger.error("❌ خطأ في حذف أمر الهدية:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/gift-commands", authenticateToken, async (req, res) => {
  try {
    const profile = parseInt(req.query.profile);
    if (!profile || profile < 1 || profile > MAX_PROFILES)
      return res
        .status(400)
        .json({ success: false, message: "profile مطلوب وصحيح" });
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك حذف أوامر من بروفايل غير مصرح به",
      });

    const commands = await GiftCommand.find({ userId: req.user.id, profile });
    let totalAudioSize = 0,
      totalVideoSize = 0;
    for (const cmd of commands) {
      const { audioSize, videoSize } = await deleteFilesForCommand(
        cmd,
        req.user.id,
      );
      totalAudioSize += audioSize;
      totalVideoSize += videoSize;
    }
    const result = await GiftCommand.deleteMany({
      userId: req.user.id,
      profile,
    });
    await refreshCachesForUser(req.user.id);
    const updatedUser = await User.findById(req.user.id);
    const storageData = {
      audio: {
        usedMB: updatedUser.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - updatedUser.audioUsedMB),
      },
      video: {
        usedMB: updatedUser.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - updatedUser.videoUsedMB),
      },
    };
    io.to(`user-${req.user.id}`).emit("storage-update", storageData);
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      profile,
      storage: storageData,
    });
  } catch (err) {
    logger.error("❌ خطأ في حذف جميع أوامر الهدايا:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/interaction-commands", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const p = req.query.profile
      ? Math.max(
          1,
          Math.min(MAX_PROFILES, parseInt(req.query.profile, 10) || 1),
        )
      : user
        ? user.selectedProfile
        : 1;
    const canAccess = await canAccessProfile(req.user.id, p);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك الوصول إلى أوامر هذا البروفايل",
      });
    const list = await InteractionCommand.find({
      userId: req.user.id,
      profile: p,
    }).sort({ createdAt: -1 });
    res.json({ success: true, list });
  } catch (err) {
    logger.error("❌ خطأ في جلب أوامر التفاعل:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(
  "/api/interaction-commands/:id/execute",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return res
          .status(400)
          .json({ success: false, message: "معرف غير صالح" });
      const cmd = await InteractionCommand.findById(req.params.id);
      if (!cmd)
        return res.status(404).json({ success: false, message: "غير موجود" });
      if (cmd.userId.toString() !== req.user.id)
        return res.status(403).json({ success: false, message: "غير مصرح به" });
      const canAccess = await canAccessProfile(req.user.id, cmd.profile);
      if (!canAccess)
        return res.status(403).json({
          success: false,
          message: "لا يمكنك تنفيذ أمر من بروفايل غير مصرح به",
        });
      const count = Math.max(1, parseInt(req.body?.count || 1, 10) || 1);
      const timesToRun = Math.min(count, 10);
      const requestedScreen = req.body?.screen
        ? parseInt(req.body.screen)
        : null;
      const cmdObj = cmd.toObject ? { ...cmd.toObject() } : { ...cmd };
      const configuredRepeat = Math.max(
        1,
        parseInt(cmdObj.repeat || 1, 10) || 1,
      );
      const keystrokeText =
        cmdObj.command && cmdObj.command.trim() !== ""
          ? cmdObj.command
          : cmdObj.combo || "";
      const agentSocket = state.userLocalAgents.get(req.user.id);
      if (agentSocket && agentSocket.connected && keystrokeText) {
        for (let t = 0; t < timesToRun; t++) {
          agentSocket.emit("execute-keys", {
            command: keystrokeText,
            repeat: configuredRepeat,
            interval: cmdObj.interval || 500,
            combo: cmdObj.combo,
          });
          if (t < timesToRun - 1 && cmdObj.interval > 0)
            await new Promise((r) => setTimeout(r, cmdObj.interval));
        }
      } else if (keySenderReady && keystrokeText) {
        for (let t = 0; t < timesToRun; t++) {
          await executeNativeKeystroke(
            keystrokeText,
            configuredRepeat,
            cmdObj.interval || 500,
          );
          if (t < timesToRun - 1 && cmdObj.interval > 0)
            await new Promise((r) => setTimeout(r, cmdObj.interval));
        }
      }
      for (let t = 0; t < timesToRun; t++) {
        const one = {
          ...cmdObj,
          repeat: configuredRepeat,
          screen: requestedScreen || cmdObj.screen || 1,
        };
        await executeAction(one, "StreamMoon", req.user.id, null, "manual");
      }
      res.json({ success: true, message: "تم التنفيذ", count: timesToRun });
    } catch (err) {
      logger.error("❌ خطأ في تنفيذ أمر التفاعل:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.put(
  "/api/interaction-commands/:id",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return res
          .status(400)
          .json({ success: false, message: "معرف غير صالح" });
      const cmd = await InteractionCommand.findById(req.params.id);
      if (!cmd)
        return res.status(404).json({ success: false, message: "غير موجود" });
      if (cmd.userId.toString() !== req.user.id)
        return res.status(403).json({ success: false, message: "غير مصرح به" });
      const canAccess = await canAccessProfile(req.user.id, cmd.profile);
      if (!canAccess)
        return res.status(403).json({
          success: false,
          message: "لا يمكنك تعديل أمر من بروفايل غير مصرح به",
        });
      if (
        req.body.combo &&
        req.body.combo !== cmd.combo &&
        req.body.combo.trim() !== ""
      ) {
        const existingCombo = await InteractionCommand.findOne({
          userId: req.user.id,
          profile: cmd.profile,
          combo: req.body.combo.trim(),
          _id: { $ne: cmd._id },
        });
        if (existingCombo)
          return res.status(400).json({
            success: false,
            message: "هذا الاختصار موجود بالفعل في هذا البروفايل",
          });
        req.body.combo = req.body.combo.trim();
      } else if (req.body.combo === "" || req.body.combo === null)
        req.body.combo = null;
      Object.assign(cmd, req.body);
      await cmd.save();
      await refreshCachesForUser(req.user.id);
      res.json({ success: true, command: cmd });
    } catch (err) {
      logger.error("❌ خطأ في تحديث أمر التفاعل:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.delete(
  "/api/interaction-commands/:id",
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .json({ success: false, message: "معرف غير صالح" });
      }
      const cmd = await InteractionCommand.findById(req.params.id);
      if (!cmd) {
        return res.status(200).json({
          success: true,
          message: "الأمر غير موجود، تم اعتباره محذوفاً",
          alreadyDeleted: true,
        });
      }
      if (cmd.userId.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: "غير مصرح به" });
      }
      await deleteFilesForCommand(cmd, req.user.id);
      await InteractionCommand.findByIdAndDelete(req.params.id);
      await refreshCachesForUser(req.user.id);
      res.json({
        success: true,
        message: "تم حذف الأمر والملفات المرتبطة بنجاح",
      });
    } catch (err) {
      logger.error("❌ خطأ في حذف أمر التفاعل:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

app.delete("/api/interaction-commands", authenticateToken, async (req, res) => {
  try {
    const profile = parseInt(req.query.profile);
    if (!profile || profile < 1 || profile > MAX_PROFILES)
      return res
        .status(400)
        .json({ success: false, message: "profile مطلوب وصحيح" });
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك حذف أوامر من بروفايل غير مصرح به",
      });

    const commands = await InteractionCommand.find({
      userId: req.user.id,
      profile,
    });
    let totalAudioSize = 0,
      totalVideoSize = 0;
    for (const cmd of commands) {
      const { audioSize, videoSize } = await deleteFilesForCommand(
        cmd,
        req.user.id,
      );
      totalAudioSize += audioSize;
      totalVideoSize += videoSize;
    }
    const result = await InteractionCommand.deleteMany({
      userId: req.user.id,
      profile,
    });
    await refreshCachesForUser(req.user.id);
    const updatedUser = await User.findById(req.user.id);
    const storageData = {
      audio: {
        usedMB: updatedUser.audioUsedMB,
        limitMB: MAX_AUDIO_MB,
        remainingMB: Math.max(0, MAX_AUDIO_MB - updatedUser.audioUsedMB),
      },
      video: {
        usedMB: updatedUser.videoUsedMB,
        limitMB: MAX_VIDEO_MB,
        remainingMB: Math.max(0, MAX_VIDEO_MB - updatedUser.videoUsedMB),
      },
    };
    io.to(`user-${req.user.id}`).emit("storage-update", storageData);
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      profile,
      storage: storageData,
    });
  } catch (err) {
    logger.error("❌ خطأ في حذف جميع أوامر التفاعل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/execute-keystroke", authenticateToken, async (req, res) => {
  try {
    const { combo } = req.body;
    if (!combo)
      return res.status(400).json({ success: false, message: "combo مطلوب" });
    const profile = await getUserSelectedProfile(req.user.id);
    let command = await InteractionCommand.findOne({
      userId: req.user.id,
      profile,
      combo,
      active: true,
    });
    if (!command)
      command = await GiftCommand.findOne({
        userId: req.user.id,
        profile,
        combo,
        active: true,
      });
    if (!command)
      return res
        .status(404)
        .json({ success: false, message: "اختصار غير معروف" });
    let keystrokeText =
      command.command && command.command.trim() !== ""
        ? command.command
        : combo;
    const agentSocket = state.userLocalAgents.get(req.user.id);
    if (agentSocket && agentSocket.connected) {
      agentSocket.emit("execute-keys", {
        command: keystrokeText,
        repeat: command.repeat || 1,
        interval: command.interval || 500,
        combo,
      });
      return res.json({
        success: true,
        method: "local_agent",
        keystroke: keystrokeText,
      });
    } else if (keySenderReady) {
      await executeNativeKeystroke(
        keystrokeText,
        command.repeat || 1,
        command.interval || 500,
      );
      return res.json({
        success: true,
        method: "node-key-sender",
        keystroke: keystrokeText,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "لا يوجد عميل محلي ولا node-key-sender متاح",
      });
    }
  } catch (err) {
    logger.error("❌ خطأ في تنفيذ الاختصار:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/play-sound", authenticateToken, (req, res) => {
  const { filename, volume = 100 } = req.body;
  if (!filename)
    return res.status(400).json({ success: false, message: "اسم الملف مطلوب" });
  playAudio(filename, volume, req.user.id);
  res.json({ success: true });
});

app.post("/api/play-video", authenticateToken, async (req, res) => {
  const { filename, screen = 1, user = "Manual", volume = 100 } = req.body;
  if (!filename)
    return res.status(400).json({ success: false, message: "اسم الملف مطلوب" });
  const videoDoc = await Video.findOne({ file: filename, userId: req.user.id });
  let videoUrl = videoDoc?.cloudinaryUrl;
  if (!videoUrl)
    videoUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${encodeURIComponent(filename)}`;
  io.to(`user-${req.user.id}`).emit("gift-video", {
    videoId: videoUrl,
    user,
    screen,
    volume,
  });
  res.json({ success: true });
});

app.post("/api/reset-live-state", authenticateToken, (req, res) => {
  resetOncePerLiveForUser(req.user.id);
  res.json({ success: true });
});

app.post("/api/test-webhook", authenticateToken, async (req, res) => {
  try {
    const { url, payload } = req.body;
    if (!url)
      return res.status(400).json({ success: false, message: "الرابط مطلوب" });
    const testData = payload || {
      test: true,
      timestamp: new Date().toISOString(),
      source: "blackmoon_tester",
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BlackMoon/1.0",
      },
      body: JSON.stringify(testData),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const responseText = await response.text();
    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      response: responseText.substring(0, 500),
    });
  } catch (err) {
    logger.error("❌ خطأ في اختبار Webhook:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ رفع الملفات ================
const uploadTFC = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const videoStorage = multer.memoryStorage();
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".flv", ".wmv"];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("امتداد غير مسموح للفيديو"));
  },
});

app.post(
  "/api/profiles/import-file",
  authenticateToken,
  uploadTFC.single("tfcFile"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "لم يتم رفع أي ملف" });
      let commands;
      try {
        commands = JSON.parse(req.file.buffer.toString("utf8"));
      } catch (err) {
        return res
          .status(400)
          .json({ success: false, message: "الملف ليس بصيغة JSON صحيحة" });
      }
      if (!Array.isArray(commands))
        return res.status(400).json({
          success: false,
          message: "يجب أن يحتوي الملف على مصفوفة من الأوامر",
        });
      const user = await User.findById(req.user.id);
      const targetProfile = user ? user.selectedProfile : 1;
      const canAccess = await canAccessProfile(req.user.id, targetProfile);
      if (!canAccess)
        return res.status(403).json({
          success: false,
          message: "لا يمكنك استيراد الأوامر لهذا البروفايل في النسخة المجانية",
        });

      const results = { added: 0, replaced: 0, skipped: 0, errors: [] };
      const replace = req.body.replace === "true";

      for (const cmd of commands) {
        if (cmd.audio) {
          const audioExists = await Audio.findOne({
            file: cmd.audio,
            userId: req.user.id,
          });
          if (!audioExists) {
            if (
              cmd.audio.startsWith("http://") ||
              cmd.audio.startsWith("https://")
            ) {
              const newFilename = await uploadFileFromUrl(
                cmd.audio,
                req.user.id,
                "audio",
              );
              if (newFilename) {
                cmd.audio = newFilename;
              } else {
                cmd.audio = null;
                results.errors.push({
                  command: cmd,
                  error: `فشل رفع الملف الصوتي من الرابط: ${cmd.audio}`,
                });
              }
            } else if (!cmd.audio.startsWith("/audios/")) {
              cmd.audio = null;
              results.errors.push({
                command: cmd,
                error: `الملف الصوتي "${cmd.audio}" غير موجود في حسابك ولم يكن رابطاً صحيحاً، تم تعطيل الصوت.`,
              });
            }
          }
        }

        if (cmd.video) {
          const videoExists = await Video.findOne({
            file: cmd.video,
            userId: req.user.id,
          });
          if (!videoExists) {
            if (
              cmd.video.startsWith("http://") ||
              cmd.video.startsWith("https://")
            ) {
              const newFilename = await uploadFileFromUrl(
                cmd.video,
                req.user.id,
                "video",
              );
              if (newFilename) {
                cmd.video = newFilename;
              } else {
                cmd.video = null;
                results.errors.push({
                  command: cmd,
                  error: `فشل رفع ملف الفيديو من الرابط: ${cmd.video}`,
                });
              }
            } else if (!cmd.video.startsWith("/videos/")) {
              cmd.video = null;
              results.errors.push({
                command: cmd,
                error: `ملف الفيديو "${cmd.video}" غير موجود في حسابك ولم يكن رابطاً صحيحاً، تم تعطيل الفيديو.`,
              });
            }
          }
        }
      }

      for (const cmd of commands) {
        try {
          cmd.profile = targetProfile;
          cmd.userId = req.user.id;
          if (cmd.giftId !== undefined && cmd.giftId !== null) {
            const giftId = String(cmd.giftId);
            const existing = await GiftCommand.findOne({
              giftId,
              profile: targetProfile,
              userId: req.user.id,
            });
            if (existing) {
              if (replace) {
                await GiftCommand.findByIdAndUpdate(existing._id, cmd, {
                  new: true,
                });
                results.replaced++;
              } else results.skipped++;
            } else {
              await GiftCommand.create(cmd);
              results.added++;
            }
          } else if (
            cmd.type &&
            [
              "follow",
              "like",
              "comment",
              "share",
              "gift",
              "all",
              "keystroke",
            ].includes(cmd.type)
          ) {
            let finalCmd = { ...cmd };
            if (cmd.type === "keystroke" && cmd.combo) {
              finalCmd.type = "all";
              finalCmd.combo = cmd.combo;
            }
            await InteractionCommand.create({
              ...finalCmd,
              profile: targetProfile,
              userId: req.user.id,
            });
            results.added++;
          } else {
            results.errors.push({ command: cmd, error: "نوع أمر غير معروف" });
          }
        } catch (err) {
          results.errors.push({ command: cmd, error: err.message });
        }
      }

      await enforceFreePlanLimits(req.user.id, targetProfile);
      await refreshCachesForUser(req.user.id);
      res.json({ success: true, results });
    } catch (err) {
      logger.error("❌ خطأ في استيراد الملف:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post("/api/profiles/import", authenticateToken, async (req, res) => {
  try {
    const { commands, replace, profile: reqProfile } = req.body;
    let profile = reqProfile ? parseInt(reqProfile) : null;
    if (!profile) {
      const user = await User.findById(req.user.id);
      profile = user.selectedProfile;
    }
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message: "لا يمكنك استيراد أوامر لهذا البروفايل في النسخة المجانية",
      });
    if (!Array.isArray(commands))
      return res
        .status(400)
        .json({ success: false, message: "يجب إرسال مصفوفة من الأوامر" });

    const results = { added: 0, replaced: 0, skipped: 0, errors: [] };

    for (const cmd of commands) {
      if (cmd.audio) {
        const audioExists = await Audio.findOne({
          file: cmd.audio,
          userId: req.user.id,
        });
        if (!audioExists) {
          if (
            cmd.audio.startsWith("http://") ||
            cmd.audio.startsWith("https://")
          ) {
            const newFilename = await uploadFileFromUrl(
              cmd.audio,
              req.user.id,
              "audio",
            );
            if (newFilename) {
              cmd.audio = newFilename;
            } else {
              cmd.audio = null;
              results.errors.push({
                command: cmd,
                error: `فشل رفع الملف الصوتي من الرابط: ${cmd.audio}`,
              });
            }
          } else if (!cmd.audio.startsWith("/audios/")) {
            cmd.audio = null;
            results.errors.push({
              command: cmd,
              error: `الملف الصوتي "${cmd.audio}" غير موجود في حسابك ولم يكن رابطاً صحيحاً، تم تعطيل الصوت.`,
            });
          }
        }
      }

      if (cmd.video) {
        const videoExists = await Video.findOne({
          file: cmd.video,
          userId: req.user.id,
        });
        if (!videoExists) {
          if (
            cmd.video.startsWith("http://") ||
            cmd.video.startsWith("https://")
          ) {
            const newFilename = await uploadFileFromUrl(
              cmd.video,
              req.user.id,
              "video",
            );
            if (newFilename) {
              cmd.video = newFilename;
            } else {
              cmd.video = null;
              results.errors.push({
                command: cmd,
                error: `فشل رفع ملف الفيديو من الرابط: ${cmd.video}`,
              });
            }
          } else if (!cmd.video.startsWith("/videos/")) {
            cmd.video = null;
            results.errors.push({
              command: cmd,
              error: `ملف الفيديو "${cmd.video}" غير موجود في حسابك ولم يكن رابطاً صحيحاً، تم تعطيل الفيديو.`,
            });
          }
        }
      }
    }

    for (const cmd of commands) {
      try {
        if (cmd.giftId !== undefined && cmd.giftId !== null) {
          const giftId = String(cmd.giftId);
          const existing = await GiftCommand.findOne({
            giftId,
            profile,
            userId: req.user.id,
          });
          if (existing) {
            if (replace) {
              await GiftCommand.findByIdAndUpdate(
                existing._id,
                { ...cmd, profile, userId: req.user.id },
                { new: true },
              );
              results.replaced++;
            } else results.skipped++;
          } else {
            await GiftCommand.create({ ...cmd, profile, userId: req.user.id });
            results.added++;
          }
        } else if (
          cmd.type &&
          [
            "follow",
            "like",
            "comment",
            "share",
            "gift",
            "all",
            "keystroke",
          ].includes(cmd.type)
        ) {
          let finalCmd = { ...cmd };
          if (cmd.type === "keystroke" && cmd.combo) {
            finalCmd.type = "all";
            finalCmd.combo = cmd.combo;
          }
          await InteractionCommand.create({
            ...finalCmd,
            profile,
            userId: req.user.id,
          });
          results.added++;
        } else {
          results.errors.push({ command: cmd, error: "نوع أمر غير معروف" });
        }
      } catch (err) {
        results.errors.push({ command: cmd, error: err.message });
      }
    }

    await enforceFreePlanLimits(req.user.id, profile);
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, results });
  } catch (err) {
    logger.error("❌ خطأ في استيراد الأوامر:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(
  "/api/upload-video",
  authenticateToken,
  uploadVideo.single("video"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "لم يتم رفع أي ملف" });

      const type = await fileTypeFromBuffer(req.file.buffer);
      if (
        !type ||
        ![
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-matroska",
        ].includes(type.mime)
      )
        return res
          .status(400)
          .json({ success: false, message: "نوع الملف غير مدعوم" });

      const fileSizeMB = req.file.buffer.length / (1024 * 1024);
      const user = await User.findById(req.user.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "مستخدم غير موجود" });

      if (user.videoUsedMB + fileSizeMB > MAX_VIDEO_MB)
        return res.status(400).json({
          success: false,
          message: `لا يمكن رفع الفيديو، لقد تجاوزت حد التخزين (${MAX_VIDEO_MB} ميجا). المساحة المتبقية: ${Math.max(0, MAX_VIDEO_MB - user.videoUsedMB).toFixed(2)} ميجا`,
        });

      const originalName = path.parse(req.file.originalname).name;
      const safeName = originalName.replace(
        /[^a-zA-Z0-9\u0600-\u06FF\-]/g,
        "-",
      );
      const publicId = `${safeName}-${Date.now()}`;
      const filename = `${publicId}${path.extname(req.file.originalname)}`;
      const uploadResult = await cloudinary.uploader.upload(
        `data:${type.mime};base64,${req.file.buffer.toString("base64")}`,
        {
          public_id: publicId,
          resource_type: "video",
          folder: "blackmoon_videos",
          access_mode: "public",
          timeout: 120000,
        },
      );
      const videoUrl = uploadResult.secure_url;
      await Video.create({
        name: safeName,
        file: filename,
        cloudinaryUrl: videoUrl,
        sizeMB: fileSizeMB,
        userId: req.user.id,
      });
      user.videoUsedMB += fileSizeMB;
      await user.save();

      const { giftId, commandId, screen = 1 } = req.body;
      if (giftId) {
        const gift = await GiftCommand.findOne({ userId: req.user.id, giftId });
        if (gift) {
          gift.video = filename;
          gift.screen = parseInt(screen, 10) || 1;
          await gift.save();
        }
      }
      if (commandId) {
        const interaction = await InteractionCommand.findOne({
          _id: commandId,
          userId: req.user.id,
        });
        if (interaction) {
          interaction.video = filename;
          interaction.screen = parseInt(screen, 10) || 1;
          await interaction.save();
        }
      }

      res.json({ success: true, filename, url: videoUrl, sizeMB: fileSizeMB });
    } catch (err) {
      logger.error("❌ خطأ في رفع الفيديو:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

const audioStorage = multer.memoryStorage();
const uploadAudioFile = multer({
  storage: audioStorage,
  limits: { fileSize: MAX_AUDIO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".mp3", ".wav", ".ogg"].includes(ext)) cb(null, true);
    else cb(new Error("امتداد غير مسموح"));
  },
});

app.post(
  "/api/upload-audio",
  authenticateToken,
  uploadAudioFile.single("audio"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "لم يتم رفع أي ملف" });
      const type = await fileTypeFromBuffer(req.file.buffer);
      if (
        !type ||
        !["audio/mpeg", "audio/wav", "audio/ogg"].includes(type.mime)
      )
        return res
          .status(400)
          .json({ success: false, message: "نوع الملف غير مدعوم" });
      const fileSizeMB = req.file.buffer.length / (1024 * 1024);
      const user = await User.findById(req.user.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "مستخدم غير موجود" });
      if (user.audioUsedMB + fileSizeMB > MAX_AUDIO_MB)
        return res.status(400).json({
          success: false,
          message: `لا يمكن رفع الصوت، لقد تجاوزت حد التخزين (${MAX_AUDIO_MB} ميجا). المساحة المتبقية: ${Math.max(0, MAX_AUDIO_MB - user.audioUsedMB).toFixed(2)} ميجا`,
        });
      const originalName = path.parse(req.file.originalname).name;
      const safeName = originalName.replace(
        /[^a-zA-Z0-9\u0600-\u06FF\-]/g,
        "-",
      );
      const publicId = `${safeName}-${Date.now()}`;
      const filename = `${publicId}${path.extname(req.file.originalname)}`;
      const uploadResult = await cloudinary.uploader.upload(
        `data:${type.mime};base64,${req.file.buffer.toString("base64")}`,
        {
          public_id: publicId,
          resource_type: "raw",
          folder: "blackmoon_audio",
        },
      );
      const audioUrl = uploadResult.secure_url;
      await Audio.create({
        name: safeName,
        file: filename,
        cloudinaryUrl: audioUrl,
        sizeMB: fileSizeMB,
        userId: req.user.id,
      });
      user.audioUsedMB += fileSizeMB;
      await user.save();
      res.json({ success: true, filename, url: audioUrl, sizeMB: fileSizeMB });
    } catch (err) {
      logger.error("❌ خطأ في رفع الصوت:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ================ نقاط نهاية الإدارة ================
app.get("/api/admin/stats", authenticateToken, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({
      plan: "paid",
      subscriptionExpiry: { $gt: new Date() },
    });
    const totalGiftCommands = await GiftCommand.countDocuments();
    const totalInteractionCommands = await InteractionCommand.countDocuments();
    const activeLiveUsers = state.userTikTokConnections.size;
    res.json({
      success: true,
      stats: {
        totalUsers,
        paidUsers,
        totalCommands: totalGiftCommands + totalInteractionCommands,
        activeLiveUsers,
        freeUsers: totalUsers - paidUsers,
      },
    });
  } catch (err) {
    logger.error("❌ خطأ في جلب الإحصائيات:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/admin/users", authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    const usersWithDetails = await Promise.all(
      users.map(async (user) => ({
        id: user._id,
        email: user.email,
        plan: user.plan,
        planType: user.planType,
        subscriptionExpiry: user.subscriptionExpiry,
        role: user.role,
        tiktokUsername: user.tiktokUsername,
        commandCount: await getTotalCommandsForUser(user._id),
        isLiveNow:
          state.userTikTokConnections.has(user._id.toString()) &&
          state.userTikTokConnections.get(user._id.toString())?.isLive,
        createdAt: user.createdAt,
      })),
    );
    res.json({ success: true, users: usersWithDetails });
  } catch (err) {
    logger.error("❌ خطأ في جلب المستخدمين:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(
  "/api/admin/user/:id/renew",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const { planType } = req.body;
      if (!planType || !["monthly", "yearly"].includes(planType))
        return res
          .status(400)
          .json({ success: false, message: "نوع الخطة غير صالح" });
      const user = await User.findById(req.params.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "المستخدم غير موجود" });
      const now = new Date();
      const expiry = new Date(now);
      if (planType === "monthly") expiry.setDate(now.getDate() + 30);
      else expiry.setFullYear(now.getFullYear() + 1);
      user.plan = "paid";
      user.planType = planType;
      user.subscriptionExpiry = expiry;
      user.subscriptionGracePeriodEnd = null;
      user.subscriptionWarningSent = false;
      await user.save();
      res.json({ success: true, message: "تم تجديد الاشتراك بنجاح" });
    } catch (err) {
      logger.error("❌ خطأ في تجديد الاشتراك:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post(
  "/api/admin/user/:id/downgrade",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "المستخدم غير موجود" });
      user.plan = "free";
      user.planType = null;
      user.subscriptionExpiry = null;
      user.subscriptionGracePeriodEnd = null;
      user.subscriptionWarningSent = false;
      await user.save();
      res.json({ success: true, message: "تم إلغاء الترقية بنجاح" });
    } catch (err) {
      logger.error("❌ خطأ في إلغاء الترقية:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.post(
  "/api/admin/user/:id/make-admin",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "المستخدم غير موجود" });
      user.role = "admin";
      await user.save();
      res.json({ success: true, message: "تم ترقية المستخدم إلى مدير" });
    } catch (err) {
      logger.error("❌ خطأ في الترقية إلى مدير:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

app.delete(
  "/api/admin/user/:id",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "المستخدم غير موجود" });

      const userId = user._id;

      // حذف الملفات المرتبطة بالأوامر
      const giftCommands = await GiftCommand.find({ userId });
      const interactionCommands = await InteractionCommand.find({ userId });
      for (const cmd of [...giftCommands, ...interactionCommands]) {
        await deleteFilesForCommand(cmd, userId);
      }

      // حذف الأوامر
      await GiftCommand.deleteMany({ userId });
      await InteractionCommand.deleteMany({ userId });

      // حذف الوسائط
      await Audio.deleteMany({ userId });
      await Video.deleteMany({ userId });

      // حذف البروفايلات
      await Profile.deleteMany({ owner: userId });

      // حذف جلسات الوكيل
      await AgentSession.deleteMany({ userId });

      // فصل أي اتصال TikTok قائم
      deleteTikTokConnection(userId.toString());

      // حذف المستخدم نفسه
      await User.findByIdAndDelete(userId);

      res.json({ success: true, message: "تم حذف المستخدم وجميع بياناته" });
    } catch (err) {
      logger.error("❌ خطأ في حذف المستخدم:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ================ Socket.IO ================
const pluginNamespace = io.of("/plugin");
pluginNamespace.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query.token;
  if (token === PLUGIN_SECRET) {
    console.log("✅ Plugin authenticated successfully");
    return next();
  }
  console.warn(`❌ Authentication failed for token: ${token}`);
  return next(new Error("خطأ في المصادقة"));
});
pluginNamespace.on("connection", (socket) => {
  logger.info("✅ بلوجن ماينكرافت متصل:", socket.id);
  state.pluginSockets.add(socket);
  socket.emit("config", { player: "default" });
  socket.on("disconnect", () => {
    logger.info("❌ بلوجن ماينكرافت قطع الاتصال:", socket.id);
    state.pluginSockets.delete(socket);
  });
});

const agentNamespace = io.of("/agent");
agentNamespace.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Missing token"));
  try {
    const session = await AgentSession.findOne({ token });
    if (!session || session.expires < new Date()) {
      if (session) await AgentSession.deleteOne({ _id: session._id });
      return next(new Error("Invalid session"));
    }
    socket.userId = session.userId.toString();
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});
agentNamespace.on("connection", (socket) => {
  const userId = socket.userId;
  logger.info(`🖥️ العميل المحلي للمستخدم ${userId} متصل`);
  state.userLocalAgents.set(userId, socket);
  socket.on("disconnect", () => {
    logger.info(`🖥️ العميل المحلي للمستخدم ${userId} قطع الاتصال`);
    state.userLocalAgents.delete(userId);
  });
  socket.on("error", (err) => {
    logger.error(`خطأ في العميل المحلي ${userId}:`, err.message);
  });
});

app.post("/api/agent/register", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const agentToken = crypto.randomBytes(32).toString("hex");
    state.agentRegistrationTokens.set(agentToken, {
      userId,
      expires: Date.now() + 60000,
    });
    const protocol = process.env.NODE_ENV === "production" ? "wss" : "ws";
    const wsUrl = `${protocol}://${req.get("host")}/agent`;
    res.json({ success: true, wsUrl, token: agentToken });
  } catch (err) {
    logger.error("❌ خطأ في تسجيل العميل المحلي:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

io.use(async (socket, next) => {
  const screenToken = socket.handshake.query.token;
  if (screenToken) {
    try {
      const user = await User.findOne({ screenToken });
      if (user) {
        socket.userId = String(user._id);
        socket.isScreen = true;
        return next();
      }
    } catch (err) {}
  }

  let token = socket.handshake.auth?.token || socket.handshake.query.token;
  if (!token) {
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").reduce((acc, c) => {
        const [key, val] = c.trim().split("=");
        acc[key] = val;
        return acc;
      }, {});
      token = cookies.token;
    }
  }
  if (!token) return next(new Error("No token"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = String(decoded.id);
    socket.isScreen = false;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  if (socket.userId) {
    if (socket.isScreen) {
      const screenRoom = `screen-${socket.userId}`;
      socket.join(screenRoom);
      logger.info(
        `📱 شاشة متصلة للمستخدم ${socket.userId}، انضم إلى ${screenRoom}`,
      );
      socket.emit("connected", { room: screenRoom });
    } else {
      const userRoom = `user-${socket.userId}`;
      socket.join(userRoom);
      logger.info(
        `🖥️ فرونت متصل للمستخدم ${socket.userId}، انضم إلى ${userRoom}`,
      );
      socket.emit("connected", { room: userRoom });
    }
  } else {
    logger.info(`📱 عميل Socket.IO بدون userId: ${socket.id}`);
  }

  socket.on("join-room", ({ room }) => {
    if (room && typeof room === "string") {
      socket.join(room);
      logger.info(`📌 عميل ${socket.id} انضم يدوياً إلى ${room}`);
    }
  });

  socket.on("disconnect", () => {
    logger.info("📱 عميل Socket.IO قطع الاتصال:", socket.id);
  });
});

// ================ Cron Job ================
cron.schedule("0 * * * *", async () => {
  logger.info("Checking expired subscriptions...");
  const now = new Date();
  const expiredUsers = await User.find({
    plan: "paid",
    subscriptionExpiry: { $lt: now },
    subscriptionGracePeriodEnd: null,
  });
  for (const user of expiredUsers) {
    const graceEnd = new Date(now);
    graceEnd.setHours(now.getHours() + GRACE_HOURS);
    user.subscriptionGracePeriodEnd = graceEnd;
    await user.save();
    logger.info(`User ${user.email} entered grace period until ${graceEnd}`);
  }
  const graceExpiredUsers = await User.find({
    plan: "paid",
    subscriptionGracePeriodEnd: { $lt: now },
  });
  for (const user of graceExpiredUsers) {
    user.plan = "free";
    user.planType = null;
    user.subscriptionExpiry = null;
    user.subscriptionGracePeriodEnd = null;
    user.subscriptionWarningSent = false;
    await user.save();
    logger.info(`User ${user.email} downgraded to free after grace period`);
  }
});

// ================ صفحة ربط العميل المحلي (آمنة تماماً) ================
app.get("/agent-auth", async (req, res) => {
  const callbackPort = req.query.callbackPort || 3456;
  const port = Number(callbackPort);
  const protocol =
    process.env.NODE_ENV === "production" ? "https" : req.protocol;
  const serverUrl = `${protocol}://${req.get("host")}`;
  const bindingToken = crypto.randomBytes(32).toString("hex");

  state.bindingTokens.set(bindingToken, {
    userId: null,
    expires: Date.now() + 5 * 60 * 1000,
    callbackPort: port,
    serverUrl,
  });

  const safeToken = encodeURIComponent(JSON.stringify(bindingToken));
  const safeServerUrl = encodeURIComponent(serverUrl);
  const safePort = port;

  res.send(`
    <!DOCTYPE html>
    <html lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ربط العميل المحلي - BlackMoon</title>
      <style>
        body{background:#0a0a0a;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}
        .container{background:#1e1e1e;padding:30px;border-radius:12px;text-align:center;max-width:400px;}
        button{padding:10px 20px;margin:10px;border-radius:6px;border:none;background:#4caf50;color:white;cursor:pointer;font-size:16px;}
        .error{color:#f44336;}
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🔗 ربط العميل المحلي</h2>
        <p>الرجاء تسجيل الدخول أولاً ثم النقر على زر الربط.</p>
        <div id="status"></div>
        <button id="bindBtn">ربط العميل</button>
      </div>
      <script>
        (function(){
          const bindingToken = JSON.parse(decodeURIComponent('${safeToken}'));
          const callbackPort = ${safePort};
          const serverUrl = decodeURIComponent('${safeServerUrl}');
          
          const bindBtn = document.getElementById('bindBtn');
          const statusDiv = document.getElementById('status');

          async function checkLogin() {
            try {
              const res = await fetch('/api/auth/me', { credentials: 'include' });
              const data = await res.json();
              if (data.success) {
                statusDiv.innerHTML = '<span style="color:#4caf50">✅ تم تسجيل الدخول كـ ' + data.user.email + '</span>';
                return true;
              } else {
                statusDiv.innerHTML = '<span style="color:#ff9800">⚠️ لم تسجل الدخول. سيتم فتح نافذة تسجيل الدخول.</span>';
                return false;
              }
            } catch(e) {
              statusDiv.innerHTML = '<span class="error">❌ خطأ في الاتصال</span>';
              return false;
            }
          }

          bindBtn.onclick = async function() {
            const loggedIn = await checkLogin();
            if (!loggedIn) {
              window.open('/login', '_blank');
              alert('سجل الدخول ثم اضغط على الربط مرة أخرى');
              return;
            }
            const tokenRes = await fetch('/api/agent/binding-token', { credentials: 'include' });
            const tokenData = await tokenRes.json();
            if (!tokenData.success) {
              statusDiv.innerHTML = '<span class="error">فشل الحصول على رمز الربط</span>';
              return;
            }
            const finalToken = tokenData.token;
            // استخراج secret من الرابط وإرساله مع callback
            const secret = new URLSearchParams(window.location.search).get('secret') || '';
            window.location.href = 'http://localhost:' + callbackPort + '/callback?sessionToken=' + encodeURIComponent(finalToken) + '&serverUrl=' + encodeURIComponent(serverUrl) + '&secret=' + encodeURIComponent(secret);
          };

          checkLogin();
        })();
      </script>
    </body>
    </html>
  `);
});
app.get("/api/agent/binding-token", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = crypto.randomBytes(32).toString("hex");
    state.bindingTokens.set(token, {
      userId,
      expires: Date.now() + 5 * 60 * 1000,
    });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/agent/exchange-binding", async (req, res) => {
  try {
    const { bindingToken, machineId } = req.body; // استلام machineId
    const data = state.bindingTokens.get(bindingToken);
    if (!data || data.expires < Date.now())
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired binding token" });
    state.bindingTokens.delete(bindingToken);

    // تحديث machineId للمستخدم إذا تم إرساله
    if (machineId && data.userId) {
      await User.findByIdAndUpdate(data.userId, { machineId: machineId });
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    await AgentSession.create({
      token: sessionToken,
      userId: data.userId,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    let wsProtocol = process.env.NODE_ENV === "production" ? "wss" : "ws";
    const wsUrl = `${wsProtocol}://${req.headers.host}/agent`;
    res.json({ success: true, sessionToken, wsUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ بدء الخادم ================
server.listen(PORT, "0.0.0.0", () => {
  logger.info(`✅ السيرفر يعمل على المنفذ ${PORT}`);
  logger.info(`🎵 الصوت عبر Cloudinary`);
  logger.info(`🎬 الفيديو عبر Cloudinary`);
  logger.info(`🖥️ دعم العميل المحلي لتنفيذ الكيبورد الحقيقي عبر /agent`);
});

setInterval(() => {
  state.cleanup();

  // تنظيف إضافي
  if (state.userTikTokConnections.size > 200) {
    const now = Date.now();
    for (const [userId, conn] of state.userTikTokConnections) {
      if (!conn.isLive && now - (conn.lastActivity || 0) > 600000) {
        deleteTikTokConnection(userId);
      }
    }
  }

  // تنظيف الكاش الخاص بالمستخدمين غير النشطين
  const keys = state.cache.keys();
  let count = 0;
  for (const key of keys) {
    if (key.startsWith("gifts:") || key.startsWith("interactions:")) {
      const userId = key.split(":")[1];
      if (
        !state.userTikTokConnections.has(userId) &&
        !state.userLocalAgents.has(userId)
      ) {
        state.delCache(key);
        count++;
      }
    }
  }
  if (count > 0) logger.info(`🧹 تم تنظيف ${count} مفتاح كاش غير مستخدم`);
}, CLEANUP_INTERVAL);
