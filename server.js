// server.js - نسخة خفيفة ومحسنة (بدون واجهة أمامية)
// إعدادات RCON و TikTok منفصلة لكل مستخدم

require("dotenv").config();
const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL && process.env.NODE_ENV === "production") {
  console.error("❌ FRONTEND_URL must be set in production");
  process.exit(1);
}

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

// ================ تهيئة Cloudinary ================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ================ إعدادات المتغيرات البيئية ================
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

// إعدادات RCON الافتراضية
const DEFAULT_RCON_HOST = process.env.RCON_HOST || "127.0.0.1";
const DEFAULT_RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const DEFAULT_RCON_PASSWORD = process.env.RCON_PASSWORD || "change_me";
const DEFAULT_RCON_PLAYER = process.env.RCON_PLAYER || "Player";

// إعدادات أخرى
const MAX_PROFILES = 20;
const DEFAULT_COMMAND_DELAY_MS = 100;
const GIFT_MAX_BURST = parseInt(process.env.GIFT_MAX_BURST || "50", 10);
const LIKE_MAX_DELTA = 500;
const PROCESSED_TTL_MS = 60 * 1000;
const GIFT_STREAK_TTL_MS = 15 * 1000;

// ================ حدود التخزين ================
const MAX_AUDIO_MB = 100;
const MAX_VIDEO_MB = 1000;

// ================ إعدادات الاشتراكات ================
const WARNING_HOURS = 24;
const GRACE_HOURS = 48;

// ================ المتغيرات العامة ================
let userTikTokConnections = new Map();
let userRconInstances = new Map();
let pluginSockets = new Set();
let executedOncePerLive = new Map();
let likeCounters = new Map();
let followExecutedUsers = new Map();
let lastLikeCount = new Map();
let giftStreakState = new Map();

// الكاش
let giftCommandsCache = new Map();
let interactionCommandsCache = new Map();

// لتخزين اتصالات العملاء المحليين
let userLocalAgents = new Map(); // key: userId (string), value: socket
let agentRegistrationTokens = new Map(); // key: token, value: { userId, expires }
let bindingTokens = new Map(); // key: token, value: { userId, expires }
let agentSessions = new Map(); // تخزين رموز جلسات العملاء (صلاحية طويلة)

// ================ إعدادات السجلات (خفيفة) ================
const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "error" : "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

// تقليل التسجيل في بيئة الإنتاج
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

// ================ دالة تنفيذ كيستروك حقيقية باستخدام node-key-sender ================
async function executeNativeKeystroke(keys, repeat = 1, intervalMs = 500) {
  if (!keySenderReady) {
    logger.error("node-key-sender غير جاهز");
    return false;
  }
  const nircmdPath = path.join(__dirname, "nircmd.exe");
  let nircmdKeys = keys.toLowerCase().replace(/\+/g, "+");
  const sendOnce = () => {
    return new Promise((resolve) => {
      exec(`"${nircmdPath}" sendkeypress ${nircmdKeys}`, (error) => {
        if (error) {
          logger.error(`فشل تنفيذ nircmd: ${error.message}`);
          resolve(false);
        } else {
          logger.info(`⌨️ تم تنفيذ كيستروك: ${keys}`);
          resolve(true);
        }
      });
    });
  };
  if (repeat === 1) {
    await sendOnce();
  } else {
    for (let i = 0; i < repeat; i++) {
      setTimeout(() => sendOnce(), i * intervalMs);
    }
  }
  return true;
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

// ================ إعدادات الحماية ================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "تم تجاوز حد المحاولات، حاول لاحقاً" },
  keyGenerator: (req) => req.ip,
});

// ================ إعدادات Express ================
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, credentials: true },
  allowEIO3: true,
  transports: ["websocket", "polling"],
});

// Middleware
app.use(compression());
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  }),
);
app.options("*", cors({ origin: FRONTEND_URL, credentials: true }));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  req.setTimeout(30 * 1000);
  next();
});

// ================ حذف خدمة الملفات الثابتة الخاصة بالواجهة الأمامية ================
// لم نعد نخدم public أو images لأن الواجهة منفصلة

// ================ Middleware للمصادقة ================
const authenticateToken = (req, res, next) => {
  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers["authorization"];
    token = authHeader && authHeader.split(" ")[1];
  }
  if (!token)
    return res.status(401).json({ success: false, message: "لا يوجد توكن" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ success: false, message: "توكن غير صالح" });
    req.user = user;
    next();
  });
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

// ================ الاتصال بقاعدة البيانات (محسن) ================
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
      // إنشاء الفهارس اللازمة
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await db
        .collection("users")
        .createIndex({ screenToken: 1 }, { unique: true, sparse: true });
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
      const p = g.profile;
      if (!giftMapByProfile.has(p)) giftMapByProfile.set(p, new Map());
      giftMapByProfile.get(p).set(String(g.giftId), g);
    }
    const interactionMapByProfile = new Map();
    for (const ic of interactions) {
      const p = ic.profile;
      if (!interactionMapByProfile.has(p)) interactionMapByProfile.set(p, []);
      interactionMapByProfile.get(p).push(ic);
    }
    for (let p = 1; p <= MAX_PROFILES; p++) {
      const key = `${userId}:${p}`;
      giftCommandsCache.set(key, giftMapByProfile.get(p) || new Map());
      interactionCommandsCache.set(key, interactionMapByProfile.get(p) || []);
    }
    logger.info(`♻️ تم تحديث الكاش للمستخدم ${userId}`);
  } catch (err) {
    logger.error("❌ خطأ في تحديث الكاش:", err.message);
  }
}

function getGiftCommandForProfile(userId, profile, giftIdStr) {
  const key = `${userId}:${profile}`;
  const map = giftCommandsCache.get(key);
  if (!map) return null;
  const keyStr = String(giftIdStr);
  let result = map.get(keyStr);
  if (!result) {
    const num = Number(giftIdStr);
    if (Number.isFinite(num) && map.has(String(num)))
      result = map.get(String(num));
  }
  return result;
}

function getInteractionCommandsForProfile(userId, profile) {
  const key = `${userId}:${profile}`;
  return interactionCommandsCache.get(key) || [];
}

// ================ وظائف RCON ================
async function getUserRcon(userId) {
  const user = await User.findById(userId);
  if (!user || !user.rconConfig) return null;
  const config = user.rconConfig;
  const key = userId.toString();
  let instance = userRconInstances.get(key);
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
  userRconInstances.set(key, { rcon, config, connected: true });
  return rcon;
}

function replacePlaceholders(cmd, playerName, rconPlayer) {
  const safePlayer = rconPlayer.includes(" ") ? `"${rconPlayer}"` : rconPlayer;
  const safeUser =
    playerName && playerName.includes(" ")
      ? `"${playerName}"`
      : playerName || safePlayer;
  let finalCmd = cmd
    .replace(/{player}/g, safePlayer)
    .replace(/{nickname}/g, safeUser);
  if (finalCmd.startsWith("/")) finalCmd = finalCmd.slice(1);
  return finalCmd.trim();
}

async function sendRconCommand(userId, command, playerName = null) {
  if (pluginSockets.size > 0) {
    for (const sock of pluginSockets) {
      sock.emit("execute", { command, player: playerName || "console" });
    }
    logger.info(`📡 أرسل إلى البلوجن: ${command}`);
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
    playerName,
    user.rconConfig.player,
  );
  try {
    rcon.send(final);
  } catch (err) {
    logger.error("❌ فشل إرسال أمر RCON:", err.message);
  }
}

// ================ وظيفة Webhook (معدلة لدعم localhost عبر العميل المحلي) ================
async function sendWebhook(webhookUrl, data, userId = null) {
  if (!webhookUrl || !webhookUrl.trim()) return;
  const isLocalhost =
    webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");
  if (isLocalhost && userId) {
    const agentSocket = userLocalAgents.get(userId);
    if (agentSocket && agentSocket.connected) {
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
    } else {
      logger.warn(
        `⚠️ لا يوجد عميل محلي متصل للمستخدم ${userId} لتوجيه webhook إلى localhost`,
      );
      return;
    }
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
function playAudio(file, volume = 100, targetUserId = null) {
  Audio.findOne({ file })
    .then((audio) => {
      let audioUrl = file;
      if (audio && audio.cloudinaryUrl) {
        audioUrl = audio.cloudinaryUrl;
      } else {
        audioUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${encodeURIComponent(file)}`;
      }
      const payload = {
        filename: audioUrl,
        volume: Math.min(100, Math.max(0, parseInt(volume) || 100)),
        timestamp: Date.now(),
      };
      if (targetUserId) {
        io.to(`user-${targetUserId}`).emit("play-sound", payload);
      } else {
        io.emit("play-sound", payload);
      }
    })
    .catch((err) => {
      logger.error("❌ خطأ في استرجاع رابط الصوت:", err.message);
      const payload = {
        filename: file,
        volume: Math.min(100, Math.max(0, parseInt(volume) || 100)),
        timestamp: Date.now(),
      };
      if (targetUserId) {
        io.to(`user-${targetUserId}`).emit("play-sound", payload);
      } else {
        io.emit("play-sound", payload);
      }
    });
}

// ================ الوظيفة الرئيسية لتنفيذ الإجراء (بما فيها الكيستروك) ================
async function executeAction(cmdObj, triggerUser = "Unknown", userId) {
  if (!cmdObj.active) {
    logger.info(`🚫 الأمر غير مفعل: ${cmdObj.name || cmdObj._id}`);
    return;
  }
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
  } = cmdObj;
  if (oncePerLive && _id && userId) {
    const idStr = `${userId}:${String(_id)}`;
    if (executedOncePerLive.has(idStr)) {
      logger.info(`⏭️ الأمر ${name} تم تنفيذه مرة واحدة في هذا اللايف - تخطي`);
      return;
    }
    executedOncePerLive.add(idStr);
  }
  if (delayBefore > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayBefore));
  }
  if (keystrokeText) {
    const agentSocket = userLocalAgents.get(userId);
    for (let i = 0; i < repeat; i++) {
      if (i > 0 && interval > 0)
        await new Promise((r) => setTimeout(r, interval));
      if (agentSocket && agentSocket.connected) {
        agentSocket.emit("execute-keys", {
          command: keystrokeText,
          repeat: 1,
          interval: 0,
          combo,
        });
        logger.info(
          `⌨️ تم إرسال keystroke إلى العميل المحلي: ${keystrokeText}`,
        );
      } else if (keySenderReady) {
        await executeNativeKeystroke(keystrokeText, 1, 0);
      } else {
        logger.warn(
          `⚠️ لا يمكن تنفيذ keystroke: لا عميل محلي ولا node-key-sender`,
        );
      }
    }
  }
  if (playSound && audio) playAudio(audio, volume, userId);
  if (playVideo && video && userId) {
    const room = `user-${userId}`;
    const videoUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${encodeURIComponent(video)}`;
    io.to(room).emit("gift-video", {
      videoId: videoUrl,
      user: triggerUser,
      screen,
      volume: videoVolume,
    });
  }
  if (command && command.trim()) {
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
        } else {
          currentGroup.push(line);
        }
      }
      if (currentGroup.length) groups.push(currentGroup);
      const selectedGroup = groups.length
        ? groups[Math.floor(Math.random() * groups.length)]
        : [];
      let cumulativeDelay = 0;
      for (const cmdLine of selectedGroup) {
        if (cmdLine.toLowerCase().startsWith("delay ")) {
          const sec = parseFloat(cmdLine.split(/\s+/)[1]);
          if (!isNaN(sec)) cumulativeDelay += sec * 1000;
          continue;
        }
        setTimeout(() => {
          for (let i = 0; i < repeat; i++) {
            if (interval === 0) sendRconCommand(userId, cmdLine, triggerUser);
            else
              setTimeout(
                () => sendRconCommand(userId, cmdLine, triggerUser),
                i * interval,
              );
          }
        }, cumulativeDelay);
        cumulativeDelay += DEFAULT_COMMAND_DELAY_MS;
      }
    } else {
      const singleCmd = lines[0];
      for (let i = 0; i < repeat; i++) {
        if (interval === 0) sendRconCommand(userId, singleCmd, triggerUser);
        else
          setTimeout(
            () => sendRconCommand(userId, singleCmd, triggerUser),
            i * interval,
          );
      }
    }
  }
  if (webhookUrl && webhookUrl.trim()) {
    const webhookData = {
      name: name || "",
      user: triggerUser,
      type: cmdObj.type || "keyboard",
      timestamp: new Date().toISOString(),
      profile: cmdObj.profile || 1,
      event: "webhook_execution",
      repeat,
      interval,
    };
    for (let i = 0; i < repeat; i++) {
      if (i > 0 && interval > 0)
        await new Promise((r) => setTimeout(r, interval));
      await sendWebhook(webhookUrl, webhookData, userId);
    }
  }
}

// ================ دوال مساعدة لأحداث TikTok ================
function resetOncePerLiveForUser(userId) {
  const toDelete = [];
  for (const key of executedOncePerLive.keys()) {
    if (key.startsWith(`${userId}:`)) toDelete.push(key);
  }
  toDelete.forEach((k) => executedOncePerLive.delete(k));
  const likeKeyPrefix = `${userId}:`;
  for (const key of likeCounters.keys()) {
    if (key.startsWith(likeKeyPrefix)) likeCounters.delete(key);
  }
  const followKeyPrefix = `${userId}:`;
  for (const key of followExecutedUsers.keys()) {
    if (key.startsWith(followKeyPrefix)) followExecutedUsers.delete(key);
  }
  logger.info(`♻️ تم إعادة تعيين حالة oncePerLive للمستخدم ${userId}`);
}

function getSenderFromEvent(data) {
  if (!data) return "Unknown";
  const user = data.user || {};
  const candidates = [
    user.uniqueId,
    user.unique_id,
    user.username,
    user.nickName,
    user.nickname,
    user.displayName,
    user.display_name,
    user.userId,
    user.id,
    data.uniqueId,
    data.unique_id,
    data.username,
    data.userId,
    data.user_id,
    data.id,
    data.uid,
    data.sender,
  ];
  for (let c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return "Unknown";
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

// ================ إدارة اتصالات TikTok ================
async function connectUser(userId, username) {
  if (userTikTokConnections.has(userId)) {
    const existing = userTikTokConnections.get(userId);
    if (existing.connection) {
      try {
        existing.connection.disconnect();
      } catch (e) {}
    }
  }
  const connection = new TikTokLiveConnection(username, {
    apiKey: BLACKMOON_KEY,
  });
  connection.on(WebcastEvent.GIFT, async (data) => {
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
      if (giftType === 1) {
        const streakKey =
          data.repeatId ??
          data.repeat_id ??
          data.comboId ??
          `${userId}:${sender}:${giftIdStr}`;
        const now = Date.now();
        const st = giftStreakState.get(streakKey) || { lastRepeat: 0, ts: now };
        const prev = st.lastRepeat;
        let delta = 0;
        if (repeatCount > prev) delta = repeatCount - prev;
        else if (repeatCount < prev) delta = repeatCount;
        st.lastRepeat = Math.max(prev, repeatCount);
        st.ts = now;
        giftStreakState.set(streakKey, st);
        if (repeatEnd) {
          if (delta > 0)
            await processGiftDelta({
              userId,
              sender,
              giftIdStr,
              delta,
              newRepeat: repeatCount,
            });
          giftStreakState.delete(streakKey);
          return;
        }
        if (delta <= 0) return;
        await processGiftDelta({
          userId,
          sender,
          giftIdStr,
          delta,
          newRepeat: repeatCount,
        });
      } else {
        await processGiftDelta({
          userId,
          sender,
          giftIdStr,
          delta: repeatCount,
          newRepeat: repeatCount,
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
  }) {
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
      if (giftCmd && (giftCmd.command || giftCmd.webhookUrl || giftCmd.combo)) {
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
          await executeAction(cmdObj, sender, userId);
        }
      }
      const giftInteractions = getInteractionCommandsForProfile(
        userId,
        userProfile,
      ).filter((i) => i.type === "gift");
      for (const ic of giftInteractions) {
      } // يمكن إضافة منطق لاحقاً
    } catch (err) {
      logger.error("❌ processGiftDelta error:", err.message);
    }
  }
  connection.on(WebcastEvent.CHAT, async (data) => {
    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      const comment = (data.comment || "").toString();
      if (!comment) return;
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
        if (cmd.keyword && cmd.keyword.trim()) {
          if (comment.toLowerCase().includes(cmd.keyword.trim().toLowerCase()))
            await executeAction(addKeystrokeToCommand(cmd), sender, userId);
        } else {
          await executeAction(addKeystrokeToCommand(cmd), sender, userId);
        }
      }
    } catch (err) {
      logger.error("❌ CHAT handler error:", err.message);
    }
  });
  connection.on(WebcastEvent.FOLLOW, async (data) => {
    try {
      const sender = normalizeUser(getSenderFromEvent(data));
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
        if (cmd.oncePerLive) {
          const key = `${userId}:follow:${String(cmd._id)}:${sender}`;
          if (followExecutedUsers.has(key)) continue;
          await executeAction(addKeystrokeToCommand(cmd), sender, userId);
          followExecutedUsers.add(key);
        } else {
          await executeAction(addKeystrokeToCommand(cmd), sender, userId);
        }
      }
    } catch (err) {
      logger.error("❌ FOLLOW handler error:", err.message);
    }
  });
  connection.on(WebcastEvent.LIKE, async (data) => {
    try {
      const sender = normalizeUser(getSenderFromEvent(data));
      let delta =
        parseInt(
          String(data.likeCount ?? data.like_count ?? data.count ?? 1).replace(
            /\D/g,
            "",
          ),
          10,
        ) || 1;
      if (delta > LIKE_MAX_DELTA) delta = LIKE_MAX_DELTA;
      if (delta <= 0) return;
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
        const threshold = parseInt(cmd.threshold || 0, 10) || 0;
        const keyUser = `${userId}:${String(cmd._id)}:${sender}`;
        likeCounters.set(keyUser, (likeCounters.get(keyUser) || 0) + delta);
        if (threshold <= 0) {
          await executeAction(addKeystrokeToCommand(cmd), sender, userId);
          continue;
        }
        const current = likeCounters.get(keyUser);
        const times = Math.floor(current / threshold);
        if (times <= 0) continue;
        let cmdObj = addKeystrokeToCommand(cmd);
        cmdObj.repeat = Math.max(1, (cmdObj.repeat || 1) * times);
        await executeAction(cmdObj, sender, userId);
        likeCounters.set(keyUser, current - times * threshold);
        if (likeCounters.get(keyUser) < 0) likeCounters.delete(keyUser);
      }
    } catch (err) {
      logger.error("❌ LIKE handler error:", err.message);
    }
  });
  connection.on(WebcastEvent.SHARE, async (data) => {
    try {
      const sender = normalizeUser(getSenderFromEvent(data));
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
        await executeAction(addKeystrokeToCommand(cmd), sender, userId);
      }
    } catch (err) {
      logger.error("❌ SHARE handler error:", err.message);
    }
  });
  connection.on(WebcastEvent.ROOM_UPDATE, (data) => {
    const prev = userTikTokConnections.get(userId)?.isLive;
    const newRoomId = data?.roomId ?? data?.room_id ?? null;
    const newIsLive =
      typeof data?.isLive === "boolean" ? data.isLive : !!newRoomId;
    if (!prev && newIsLive) resetOncePerLiveForUser(userId);
    if (prev && !newIsLive) resetOncePerLiveForUser(userId);
    if (userTikTokConnections.has(userId)) {
      const conn = userTikTokConnections.get(userId);
      conn.isLive = newIsLive;
      conn.roomId = newIsLive ? newRoomId : null;
      userTikTokConnections.set(userId, conn);
    }
  });
  connection.on(WebcastEvent.DISCONNECTED, () => {
    if (userTikTokConnections.has(userId)) {
      const conn = userTikTokConnections.get(userId);
      conn.isLive = false;
      conn.roomId = null;
      userTikTokConnections.set(userId, conn);
    }
    resetOncePerLiveForUser(userId);
    logger.info(`⚠️ تم قطع الاتصال بـ TikTok للمستخدم ${userId}`);
  });
  connection.on(WebcastEvent.ERROR, (err) => {
    if (err?.message?.includes("illegal tag")) return;
    logger.error(`❌ خطأ في اتصال TikTok للمستخدم ${userId}:`, err.message);
    if (userTikTokConnections.has(userId)) {
      const conn = userTikTokConnections.get(userId);
      conn.isLive = false;
      conn.roomId = null;
      userTikTokConnections.set(userId, conn);
    }
  });
  try {
    await connection.connect();
    userTikTokConnections.set(userId, {
      connection,
      username,
      isLive: true,
      roomId: null,
    });
    logger.info(`✅ متصل بحساب @${username} للمستخدم ${userId}`);
    return true;
  } catch (err) {
    logger.info(`⚠️ الحساب @${username} ليس لايف حالياً للمستخدم ${userId}`);
    userTikTokConnections.set(userId, {
      connection,
      username,
      isLive: false,
      roomId: null,
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
      secure: NODE_ENV === "production",
      sameSite: "lax",
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
      secure: NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, token });
  } catch (err) {
    logger.error("❌ خطأ في تسجيل الدخول:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ مسارات الشاشات ================
app.get("/my-screens", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send("User not found");
    const token = user.screenToken;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    let screens = [];
    for (let i = 1; i <= 10; i++) {
      screens.push({
        number: i,
        url: `${baseUrl}/screens/${token}/${i}.html`,
        description: `شاشة ${i} الخاصة بك – لا تشارك الرابط مع أي شخص آخر`,
      });
    }
    const html = `<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>شاشات OBS الخاصة بك - Black Moon</title><style>body { font-family: 'Open Sans', sans-serif; background: #0a0a0a; color: #fff; margin: 0; padding: 30px; } .container { max-width: 1200px; margin: 0 auto; } h1 { color: #4caf50; margin-bottom: 10px; } .subtitle { color: #888; margin-bottom: 30px; } .screens-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; } .screen-card { background: #1a1a1a; border-radius: 12px; padding: 20px; border: 1px solid #333; } .screen-card:hover { border-color: #4caf50; } .screen-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; } .screen-number { background: #4caf50; color: white; width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; } .url-box { background: #0a0a0a; padding: 12px; border-radius: 6px; border: 1px solid #333; word-break: break-all; color: #4caf50; font-size: 13px; } .copy-btn { background: #333; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; transition: 0.2s; } .copy-btn:hover { background: #4caf50; } .instructions { background: #1e3a2e; padding: 20px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #4caf50; } .warning { background: #3a1a1a; padding: 15px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #f44336; }</style></head><body><div class="container"><h1>🎬 شاشات OBS الخاصة بك</h1><div class="subtitle">لديك 10 شاشات فريدة – لا تشارك الروابط مع أي شخص آخر</div><div class="screens-grid">${screens.map((screen) => `<div class="screen-card"><div class="screen-header"><div class="screen-number">${screen.number}</div><button class="copy-btn" onclick="copyUrl('${screen.url}')">📋 نسخ الرابط</button></div><div class="url-box">${screen.url}</div><div style="margin-top: 10px; color: #888;">${screen.description}</div></div>`).join("")}</div><div class="instructions"><h3>📌 كيفية الإضافة في OBS:</h3><ol style="color: #ddd; line-height: 1.8;"><li>أضف مصدر <strong>متصفح (Browser)</strong> جديد</li><li>الصق أي رابط من الروابط أعلاه</li><li>اضبط العرض: <strong>1920</strong> والارتفاع: <strong>1080</strong></li><li>فعّل ✅ "استخدام معدل إطارات مخصص" = 60 إطار/ثانية</li><li>الشاشة شفافة، وستعرض محتواك الخاص تلقائياً</li></ol></div><div class="warning">⚠️ <strong>هام:</strong> هذه الروابط خاصة بك فقط. لا تشاركها مع أي شخص آخر، لأن أي شخص لديه الرابط يمكنه مشاهدة محتوى شاشتك.</div></div><script>function copyUrl(url) { navigator.clipboard.writeText(url).then(() => { const btn = event.currentTarget; btn.textContent = '✅ تم النسخ!'; btn.style.background = '#4caf50'; setTimeout(() => { btn.textContent = '📋 نسخ الرابط'; btn.style.background = '#333'; }, 2000); }); }</script></body></html>`;
    res.send(html);
  } catch (err) {
    logger.error("❌ Error loading my-screens:", err);
    res.status(500).send("خطأ في تحميل الصفحة");
  }
});

app.get("/screens/:token/:screenNumber", async (req, res) => {
  try {
    const { token, screenNumber } = req.params;
    const screenNum = parseInt(screenNumber.replace(".html", ""), 10);
    if (isNaN(screenNum) || screenNum < 1 || screenNum > 10)
      return res.status(404).send("Screen not found");
    const user = await User.findOne({ screenToken: token });
    if (!user) return res.status(404).send("Invalid screen token");
    const html = `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Screen ${screenNum} - ${user.email}</title><style>html,body{ margin:0;padding:0;width:100%;height:100%; background:transparent; overflow:hidden; } video{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:transparent; display:none; }</style></head><body><video id="videoPlayer" autoplay playsinline></video><script src="https://cdn.socket.io/4.7.1/socket.io.min.js"></script><script>(function(){ const SCREEN_NUMBER = ${screenNum}; const USER_TOKEN = '${token}'; console.log('🎬 Screen ' + SCREEN_NUMBER + ' loaded for user ' + USER_TOKEN); const socket = io(window.location.origin, { query: { token: USER_TOKEN }, transports: ['websocket', 'polling'] }); let audioUnlocked = false; let currentAudioElement = null; function getAudioElement(){ if (currentAudioElement) { currentAudioElement.pause(); currentAudioElement.currentTime = 0; currentAudioElement.src = ''; currentAudioElement.load(); } const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous'; a.onended = () => { a.src = ''; a.load(); if (currentAudioElement === a) currentAudioElement = null; }; currentAudioElement = a; return a; } async function tryUnlockAudio(){ if(audioUnlocked) return true; try { if (typeof AudioContext !== 'undefined') { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0; o.connect(g); g.connect(ctx.destination); o.start(0); setTimeout(()=>{ try{ o.stop(); ctx.close(); }catch(e){} }, 50); } const silent = getAudioElement(); silent.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='; silent.volume = 0; await silent.play().catch(()=>{}); silent.pause(); silent.src = ''; audioUnlocked = true; return true; } catch (e) { console.warn('audio unlock failed', e); return false; } } window.addEventListener('load', ()=>{ tryUnlockAudio(); }); socket.on('play-sound', async (payload) => { try { if (!payload || !payload.filename) return; if (!audioUnlocked) await tryUnlockAudio(); const filename = payload.filename; const vol100 = typeof payload.volume !== 'undefined' ? Number(payload.volume) : 100; const vol = Math.min(100, Math.max(0, vol100)) / 100; const a = getAudioElement(); a.src = filename; a.volume = vol; a.currentTime = 0; a.play().catch(err => console.warn('audio play blocked', err)); } catch (err) { console.error('play-sound handler error', err); } }); const video = document.getElementById('videoPlayer'); const videoQueue = []; let isPlaying = false; let videoVolume = 1; function playNextVideo(){ if (isPlaying || videoQueue.length === 0) return; const src = videoQueue.shift(); isPlaying = true; video.src = src; video.volume = videoVolume; video.style.display = 'block'; video.muted = false; video.play().catch(e => console.warn('video autoplay blocked', e)); video.onended = () => { isPlaying = false; video.style.display = 'none'; video.src = ''; playNextVideo(); }; } socket.on('gift-video', (data) => { try { if (data.screen !== SCREEN_NUMBER) return; if (data.volume !== undefined) { videoVolume = Math.min(1, Math.max(0, Number(data.volume) / 100)); } const vidName = data.videoId; console.log('🎬 Screen ' + SCREEN_NUMBER + ' playing:', vidName); videoQueue.push(vidName); playNextVideo(); } catch (err) { console.error('gift-video handler error', err); } }); socket.on('connect_error', (err) => console.warn('socket connect_error', err)); socket.on('connect', () => console.log('✅ Socket connected')); })();</script></body></html>`;
    res.send(html);
  } catch (err) {
    logger.error("❌ Error serving screen:", err.message);
    res.status(500).send("Internal server error");
  }
});

app.get("/screens", authenticateToken, (req, res) => {
  res.redirect("/my-screens");
});
app.get("/api/user/screen-url", authenticateToken, async (req, res) => {
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
    const url = `${req.protocol}://${req.get("host")}/screens/${token}/1.html`;
    res.json({ success: true, url });
  } catch (err) {
    logger.error("❌ خطأ في جلب رابط الشاشة:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
app.get("/api/screens", authenticateToken, async (req, res) => {
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
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const screens = [];
    for (let i = 1; i <= 10; i++)
      screens.push({ number: i, url: `${baseUrl}/screens/${token}/${i}.html` });
    res.json({ success: true, total: screens.length, screens });
  } catch (err) {
    logger.error("❌ خطأ في جلب معلومات الشاشات:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ PayPal endpoints ================
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

// ================ حذف ملف صوتي وفيديو ================
app.delete("/api/audio/:filename", authenticateToken, async (req, res) => {
  try {
    const filename = req.params.filename;
    const audioDoc = await Audio.findOne({ file: filename });
    if (!audioDoc)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود" });
    if (audioDoc.userId.toString() !== req.user.id)
      return res
        .status(403)
        .json({ success: false, message: "غير مصرح لك بحذف هذا الملف" });
    const basePublicId = path.parse(filename).name;
    await cloudinary.uploader.destroy(`blackmoon_audio/${basePublicId}`, {
      resource_type: "raw",
    });
    const user = await User.findById(req.user.id);
    if (user) {
      user.audioUsedMB = Math.max(0, user.audioUsedMB - audioDoc.sizeMB);
      await user.save();
    }
    await Audio.deleteOne({ file: filename });
    res.json({ success: true, message: "تم حذف الصوت واسترجاع المساحة" });
  } catch (err) {
    logger.error("❌ خطأ في حذف الصوت:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
app.delete("/api/video/:filename", authenticateToken, async (req, res) => {
  try {
    const filename = req.params.filename;
    const videoDoc = await Video.findOne({ file: filename });
    if (!videoDoc)
      return res
        .status(404)
        .json({ success: false, message: "الملف غير موجود" });
    if (videoDoc.userId.toString() !== req.user.id)
      return res
        .status(403)
        .json({ success: false, message: "غير مصرح لك بحذف هذا الملف" });
    const basePublicId = path.parse(filename).name;
    await cloudinary.uploader.destroy(`blackmoon_videos/${basePublicId}`, {
      resource_type: "video",
    });
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
    res.json({ success: true, message: "تم حذف الفيديو واسترجاع المساحة" });
  } catch (err) {
    logger.error("❌ خطأ في حذف الفيديو:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ نقاط نهاية التخزين والاشتراك ================
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

// ================ نقاط نهاية المصادقة (باقي المسارات) ================
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
  res.clearCookie("token");
  res.json({ success: true, message: "تم تسجيل الخروج" });
});
app.delete("/api/auth/delete", authenticateToken, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    res.clearCookie("token");
    res.json({ success: true, message: "تم حذف الحساب" });
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
      secure: NODE_ENV === "production",
      sameSite: "lax",
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
    if (userTikTokConnections.has(userId)) {
      const conn = userTikTokConnections.get(userId);
      if (conn.connection) conn.connection.disconnect();
      userTikTokConnections.delete(userId);
    }
    const user = await User.findById(userId);
    await user.save();
    res.json({ success: true, message: "تم قطع الاتصال" });
  } catch (err) {
    logger.error("❌ خطأ في قطع الاتصال:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
app.delete("/api/tiktok-user", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    if (userTikTokConnections.has(userId)) {
      const conn = userTikTokConnections.get(userId);
      if (conn.connection) conn.connection.disconnect();
      userTikTokConnections.delete(userId);
    }
    const user = await User.findById(userId);
    await user.save();
    res.json({ success: true, message: "تم قطع الاتصال وحذف الاسم" });
  } catch (err) {
    logger.error("❌ خطأ في قطع الاتصال:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post("/api/tiktok-user", authenticateToken, async (req, res) => {
  const { username } = req.body;
  if (!username)
    return res
      .status(400)
      .json({ success: false, message: "اسم المستخدم مطلوب" });
  const userId = req.user.id;
  const user = await User.findById(userId);
  user.tiktokUsername = username;
  await user.save();
  await connectUser(userId, username);
  res.json({ success: true });
});

// ================ نقاط نهاية API العامة ================
app.get("/api/live-status", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const connection = userTikTokConnections.get(userId);
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
    const plan = await getUserPlan(req.user.id);
    if (plan === "free") {
      const currentTotal = await getTotalCommandsForUser(req.user.id);
      const newCommandsCount = commands.length;
      if (currentTotal + newCommandsCount > 7)
        return res.status(403).json({
          success: false,
          message: `لا يمكن استيراد ${newCommandsCount} أمر لأن الحد الأقصى للمجاني هو 7. لديك حاليًا ${currentTotal} أمر.`,
        });
    }
    const results = { added: 0, replaced: 0, skipped: 0, errors: [] };
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
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, results });
  } catch (err) {
    logger.error("❌ خطأ في استيراد الأوامر:", err.message);
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
      for (const cmd of giftCommands) {
        const newCmd = cmd.toObject();
        delete newCmd._id;
        newCmd.profile = targetId;
        newCmd.userId = req.user.id;
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
        await InteractionCommand.create(newCmd);
      }
      await refreshCachesForUser(req.user.id);
      res.json({
        success: true,
        message: `تم نسخ الأوامر من البروفايل ${sourceId} إلى البروفايل ${targetId}`,
      });
    } catch (err) {
      logger.error("❌ خطأ في نسخ البروفايل:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);
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
    const audios = await Audio.find({ userId: req.user.id }).sort({ name: 1 });
    res.json({ success: true, audios });
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
app.get("/api/streamer", async (req, res) => {
  res.json({ isLive: false });
});

// ================ نقاط نهاية API المحمية ================
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
  if (userRconInstances.has(key)) {
    try {
      userRconInstances.get(key).rcon.disconnect();
    } catch (e) {}
    userRconInstances.delete(key);
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

// ================ نقاط نهاية API للأوامر ================
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
        await executeAction(one, "ManualTest", req.user.id);
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
      const agentSocket = userLocalAgents.get(req.user.id);
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
        await executeAction(one, "ManualTest", req.user.id);
      }
      res.json({ success: true, message: "تم التنفيذ", count: timesToRun });
    } catch (err) {
      logger.error("❌ خطأ في تنفيذ أمر التفاعل:", err.message);
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
    const plan = await getUserPlan(req.user.id);
    if (plan === "free") {
      const total = await getTotalCommandsForUser(req.user.id);
      if (total >= 7)
        return res.status(403).json({
          success: false,
          message:
            "لقد وصلت للحد الأقصى للأوامر (7) في النسخة المجانية. قم بالترقية لإضافة المزيد.",
        });
    }
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
    });
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
        message: "لا يمكنك حذف أمر من بروفايل غير مصرح به",
      });
    await GiftCommand.findByIdAndDelete(req.params.id);
    await refreshCachesForUser(req.user.id);
    res.json({ success: true });
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
    const result = await GiftCommand.deleteMany({
      userId: req.user.id,
      profile,
    });
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, deletedCount: result.deletedCount, profile });
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
app.post("/api/interaction-commands", authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const user = await User.findById(req.user.id);
    const profile = Math.max(
      1,
      Math.min(
        MAX_PROFILES,
        parseInt(payload.profile || user.selectedProfile, 10) || 1,
      ),
    );
    const canAccess = await canAccessProfile(req.user.id, profile);
    if (!canAccess)
      return res.status(403).json({
        success: false,
        message:
          "لا يمكنك إنشاء أوامر لهذا البروفايل في النسخة المجانية. قم بالترقية.",
      });
    const plan = await getUserPlan(req.user.id);
    if (plan === "free") {
      const total = await getTotalCommandsForUser(req.user.id);
      if (total >= 7)
        return res.status(403).json({
          success: false,
          message:
            "لقد وصلت للحد الأقصى للأوامر (7) في النسخة المجانية. قم بالترقية لإضافة المزيد.",
        });
    }
    if (
      !payload.type ||
      !["follow", "like", "comment", "share", "gift", "all"].includes(
        payload.type,
      )
    )
      return res.status(400).json({
        success: false,
        message: `النوع غير مدعوم. الأنواع المسموحة: follow, like, comment, share, gift, all`,
      });
    if (payload.combo && payload.combo.trim() !== "") {
      const existingCombo = await InteractionCommand.findOne({
        userId: req.user.id,
        profile,
        combo: payload.combo.trim(),
      });
      if (existingCombo)
        return res.status(400).json({
          success: false,
          message: "هذا الاختصار موجود بالفعل في هذا البروفايل",
        });
    }
    payload.profile = profile;
    payload.repeat = parseInt(payload.repeat || 1, 10) || 1;
    payload.interval = parseInt(payload.interval || 500, 10) || 500;
    payload.delayBefore = parseInt(payload.delayBefore || 0, 10) || 0;
    payload.threshold = parseInt(payload.threshold || 0, 10) || 0;
    payload.volume = parseInt(payload.volume || 100, 10) || 100;
    payload.videoVolume = parseInt(payload.videoVolume || 100, 10) || 100;
    payload.screen = parseInt(payload.screen || 1, 10) || 1;
    payload.active = payload.active !== false;
    payload.playSound = payload.playSound !== false;
    payload.playVideo = payload.playVideo !== false;
    payload.oncePerLive = !!payload.oncePerLive;
    payload.userId = req.user.id;
    payload.combo =
      payload.combo && payload.combo.trim() !== ""
        ? payload.combo.trim()
        : null;
    const created = await InteractionCommand.create(payload);
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, command: created });
  } catch (err) {
    logger.error("❌ خطأ في إنشاء أمر التفاعل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
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
          message: "لا يمكنك حذف أمر من بروفايل غير مصرح به",
        });
      await InteractionCommand.findByIdAndDelete(req.params.id);
      await refreshCachesForUser(req.user.id);
      res.json({ success: true });
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
    const result = await InteractionCommand.deleteMany({
      userId: req.user.id,
      profile,
    });
    await refreshCachesForUser(req.user.id);
    res.json({ success: true, deletedCount: result.deletedCount, profile });
  } catch (err) {
    logger.error("❌ خطأ في حذف جميع أوامر التفاعل:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ نقطة نهاية تنفيذ الاختصار (keystroke) ================
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
    const agentSocket = userLocalAgents.get(req.user.id);
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

// ================ نقاط نهاية أخرى ================
app.post("/api/play-sound", authenticateToken, (req, res) => {
  const { filename, volume = 100 } = req.body;
  if (!filename)
    return res.status(400).json({ success: false, message: "اسم الملف مطلوب" });
  playAudio(filename, volume, req.user.id);
  res.json({ success: true });
});
app.post("/api/play-video", authenticateToken, (req, res) => {
  const { filename, screen = 1, user = "Manual", volume = 100 } = req.body;
  if (!filename)
    return res.status(400).json({ success: false, message: "اسم الملف مطلوب" });
  if (req.user.id) {
    const room = `user-${req.user.id}`;
    const videoUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${encodeURIComponent(filename)}`;
    io.to(room).emit("gift-video", { videoId: videoUrl, user, screen, volume });
  }
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
const videoStorage = multer.memoryStorage();
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) cb(null, true);
    else cb(new Error("امتداد غير مسموح"));
  },
});
const uploadTFC = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
      const plan = await getUserPlan(req.user.id);
      if (plan === "free") {
        const currentTotal = await getTotalCommandsForUser(req.user.id);
        if (currentTotal + commands.length > 7)
          return res.status(403).json({
            success: false,
            message: `لا يمكن استيراد ${commands.length} أمر لأن الحد الأقصى للمجاني هو 7. لديك حاليًا ${currentTotal} أمر.`,
          });
      }
      const results = { added: 0, replaced: 0, skipped: 0, errors: [] };
      const replace = req.body.replace === "true";
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
          } else
            results.errors.push({ command: cmd, error: "نوع أمر غير معروف" });
        } catch (err) {
          results.errors.push({ command: cmd, error: err.message });
        }
      }
      await refreshCachesForUser(req.user.id);
      res.json({ success: true, results });
    } catch (err) {
      logger.error("❌ خطأ في استيراد الملف:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

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
      const { giftId, screen = 1 } = req.body;
      if (giftId) {
        const gift = await GiftCommand.findOne({ userId: req.user.id, giftId });
        if (gift) {
          gift.video = filename;
          gift.screen = parseInt(screen, 10) || 1;
          await gift.save();
        } else
          await GiftCommand.create({
            giftId,
            video: filename,
            screen: parseInt(screen, 10) || 1,
            userId: req.user.id,
          });
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

// ================ نقاط نهاية API للإدارة ================
app.get("/api/admin/stats", authenticateToken, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({
      plan: "paid",
      subscriptionExpiry: { $gt: new Date() },
    });
    const totalGiftCommands = await GiftCommand.countDocuments();
    const totalInteractionCommands = await InteractionCommand.countDocuments();
    const activeLiveUsers = userTikTokConnections.size;
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
          userTikTokConnections.has(user._id.toString()) &&
          userTikTokConnections.get(user._id.toString())?.isLive,
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
      await GiftCommand.deleteMany({ userId: user._id });
      await InteractionCommand.deleteMany({ userId: user._id });
      await user.deleteOne();
      res.json({ success: true, message: "تم حذف المستخدم وجميع أوامره" });
    } catch (err) {
      logger.error("❌ خطأ في حذف المستخدم:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// ================ صفحة الداشبورد ================
app.get("/admin", authenticateToken, isAdmin, (req, res) => {
  res.send(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>لوحة تحكم Black Moon - Admin</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Cairo',sans-serif;background:#0a0a0a;color:#fff;padding:20px;}.container{max-width:1400px;margin:0 auto;}h1{color:#4caf50;margin-bottom:20px;border-right:4px solid #4caf50;padding-right:15px;}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px;}.stat-card{background:#1e1e1e;border-radius:12px;padding:20px;text-align:center;border:1px solid #333;}.stat-value{font-size:2.5rem;font-weight:bold;color:#4caf50;}.stat-label{color:#aaa;margin-top:8px;}.chart-container{background:#1e1e1e;border-radius:12px;padding:20px;margin-bottom:30px;border:1px solid #333;}canvas{max-height:300px;}.users-table{width:100%;border-collapse:collapse;background:#1e1e1e;border-radius:12px;overflow:hidden;}.users-table th,.users-table td{padding:12px;text-align:center;border-bottom:1px solid #333;}.users-table th{background:#2a2a2a;color:#4caf50;}.users-table tr:hover{background:#2a2a2a;}.btn{padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin:0 2px;}.btn-renew-monthly{background:#2196f3;color:white;}.btn-renew-yearly{background:#4caf50;color:white;}.btn-downgrade{background:#ff9800;color:white;}.btn-admin{background:#9c27b0;color:white;}.btn-delete{background:#f44336;color:white;}.badge{padding:4px 8px;border-radius:20px;font-size:12px;font-weight:bold;}.badge-free{background:#555;color:#fff;}.badge-paid{background:#4caf50;color:#fff;}.badge-admin{background:#ff9800;color:#fff;}.badge-user{background:#2196f3;color:#fff;}.status-live{color:#f44336;font-weight:bold;background:#3a1a1a;padding:2px 8px;border-radius:20px;display:inline-block;}.status-offline{color:#aaa;}.refresh-btn{background:#4caf50;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-bottom:20px;}.search-box{margin-bottom:20px;display:flex;gap:10px;align-items:center;}.search-box input{padding:8px;border-radius:6px;border:none;background:#2a2a2a;color:white;flex:1;max-width:300px;}.tiktok-user{color:#4caf50;font-weight:bold;}</style></head><body><div class="container"><h1>📊 لوحة تحكم Black Moon - Admin</h1><div class="search-box"><input type="text" id="searchEmail" placeholder="🔍 بحث بالبريد الإلكتروني..."><button class="refresh-btn" onclick="location.reload()">🔄 تحديث</button></div><div class="stats-grid" id="statsGrid"><div class="stat-card"><div class="stat-value" id="totalUsers">0</div><div class="stat-label">إجمالي المستخدمين</div></div><div class="stat-card"><div class="stat-value" id="paidUsers">0</div><div class="stat-label">مشتركين مدفوعين</div></div><div class="stat-card"><div class="stat-value" id="freeUsers">0</div><div class="stat-label">مستخدمين مجانيين</div></div><div class="stat-card"><div class="stat-value" id="totalCommands">0</div><div class="stat-label">إجمالي الأوامر</div></div><div class="stat-card"><div class="stat-value" id="activeLive">0</div><div class="stat-label">بثوث حية نشطة</div></div></div><div class="chart-container"><canvas id="usersChart"></canvas></div><h2>👥 قائمة المستخدمين</h2><div style="overflow-x:auto;"><table class="users-table" id="usersTable"><thead><tr><th>البريد الإلكتروني</th><th>الخطة</th><th>النوع</th><th>تاريخ الانتهاء</th><th>الدور</th><th>TikTok</th><th>الحالة</th><th>عدد الأوامر</th><th>تاريخ التسجيل</th><th>إجراءات</th></tr></thead><tbody></tbody></table></div></div><script>const API_BASE='';let allUsers=[];async function fetchWithAuth(url,options={}){const res=await fetch(url,{...options,credentials:"include"});if(res.status===401){alert("جلسة غير صالحة");window.location.href="/";return null;}return res.json();}async function loadStats(){const data=await fetchWithAuth(\`\${API_BASE}/api/admin/stats\`);if(data&&data.success){document.getElementById("totalUsers").textContent=data.stats.totalUsers;document.getElementById("paidUsers").textContent=data.stats.paidUsers;document.getElementById("freeUsers").textContent=data.stats.freeUsers;document.getElementById("totalCommands").textContent=data.stats.totalCommands;document.getElementById("activeLive").textContent=data.stats.activeLiveUsers;}}function renderUsersTable(users){const tbody=document.querySelector("#usersTable tbody");tbody.innerHTML="";users.forEach(user=>{const expiry=user.subscriptionExpiry?new Date(user.subscriptionExpiry).toLocaleDateString('ar-EG'):'غير محدد';const planBadge=user.plan==='paid'?'<span class="badge badge-paid">مدفوع</span>':'<span class="badge badge-free">مجاني</span>';const planType=user.planType?(user.planType==='monthly'?'شهري':'سنوي'):'—';const roleBadge=user.role==='admin'?'<span class="badge badge-admin">مدير</span>':'<span class="badge badge-user">مستخدم</span>';const liveStatusHtml=user.isLiveNow?'<span class="status-live">🟢 مباشر</span>':'<span class="status-offline">⚫ غير متصل</span>';const tiktokHtml=user.tiktokUsername?\`<span class="tiktok-user">@\${user.tiktokUsername}</span>\`:'—';const row=document.createElement("tr");row.innerHTML=\`<td>\${user.email}</td><td>\${planBadge}</td><td>\${planType}</td><td>\${expiry}</td><td>\${roleBadge}</td><td>\${tiktokHtml}</td><td>\${liveStatusHtml}</td><td>\${user.commandCount}</td><td>\${new Date(user.createdAt).toLocaleDateString('ar-EG')}</td><td><button class="btn btn-renew-monthly" data-id="\${user.id}" data-plan="monthly">شهري</button><button class="btn btn-renew-yearly" data-id="\${user.id}" data-plan="yearly">سنوي</button><button class="btn btn-downgrade" data-id="\${user.id}">إزالة الترقية</button><button class="btn btn-admin" data-id="\${user.id}">ترقية مدير</button><button class="btn btn-delete" data-id="\${user.id}">حذف</button></td>\`;tbody.appendChild(row);});document.querySelectorAll(".btn-renew-monthly, .btn-renew-yearly").forEach(btn=>{btn.addEventListener("click",async()=>{const id=btn.dataset.id;const plan=btn.dataset.plan;if(confirm(\`تجديد الاشتراك (\${plan==='monthly'?'شهري':'سنوي'})؟\`)){const res=await fetchWithAuth(\`\${API_BASE}/api/admin/user/\${id}/renew\`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({planType:plan})});if(res&&res.success)alert("تم التجديد بنجاح");else alert("فشل التجديد");loadUsers();}});});document.querySelectorAll(".btn-downgrade").forEach(btn=>{btn.addEventListener("click",async()=>{const id=btn.dataset.id;if(confirm("إزالة الترقية وجعل المستخدم مجانياً؟")){const res=await fetchWithAuth(\`\${API_BASE}/api/admin/user/\${id}/downgrade\`,{method:"POST"});if(res&&res.success)alert("تمت إزالة الترقية");else alert("فشلت العملية");loadUsers();}});});document.querySelectorAll(".btn-admin").forEach(btn=>{btn.addEventListener("click",async()=>{const id=btn.dataset.id;if(confirm("ترقية إلى مدير؟")){const res=await fetchWithAuth(\`\${API_BASE}/api/admin/user/\${id}/make-admin\`,{method:"POST"});if(res&&res.success)alert("تمت الترقية");else alert("فشلت الترقية");loadUsers();}});});document.querySelectorAll(".btn-delete").forEach(btn=>{btn.addEventListener("click",async()=>{const id=btn.dataset.id;if(confirm("حذف المستخدم وجميع أوامره؟")){const res=await fetchWithAuth(\`\${API_BASE}/api/admin/user/\${id}\`,{method:"DELETE"});if(res&&res.success)alert("تم الحذف");else alert("فشل الحذف");loadUsers();}});});}async function loadUsers(){const data=await fetchWithAuth(\`\${API_BASE}/api/admin/users\`);if(!data||!data.success)return;allUsers=data.users;renderUsersTable(allUsers);}function searchUsers(){const searchTerm=document.getElementById("searchEmail").value.toLowerCase().trim();if(searchTerm==="")renderUsersTable(allUsers);else{const filtered=allUsers.filter(user=>user.email.toLowerCase().includes(searchTerm));renderUsersTable(filtered);}}async function loadChart(){const data=await fetchWithAuth(\`\${API_BASE}/api/admin/users\`);if(!data||!data.success)return;const planCounts={free:0,paid:0};data.users.forEach(u=>{if(u.plan==='free')planCounts.free++;else planCounts.paid++;});new Chart(document.getElementById('usersChart'),{type:'pie',data:{labels:['مجاني','مدفوع'],datasets:[{data:[planCounts.free,planCounts.paid],backgroundColor:['#555','#4caf50'],borderWidth:0}]},options:{responsive:true,plugins:{legend:{position:'top',labels:{color:'#fff'}},title:{display:true,text:'نسبة المستخدمين المجانيين والمدفوعين',color:'#fff'}}}});}document.getElementById("searchEmail").addEventListener("input",searchUsers);loadStats();loadUsers();loadChart();setInterval(()=>{loadStats();loadUsers();},30000);</script></body></html>`,
  );
});

// ================ Socket.IO للبلوجن والشاشات ================
const pluginNamespace = io.of("/plugin");
pluginNamespace.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token === PLUGIN_SECRET) return next();
  return next(new Error("خطأ في المصادقة"));
});
pluginNamespace.on("connection", (socket) => {
  logger.info("✅ بلوجن ماينكرافت متصل:", socket.id);
  pluginSockets.add(socket);
  socket.emit("config", { player: "default" });
  socket.on("disconnect", () => {
    logger.info("❌ بلوجن ماينكرافت قطع الاتصال:", socket.id);
    pluginSockets.delete(socket);
  });
});

const agentNamespace = io.of("/agent");
agentNamespace.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Missing token"));
  const session = agentSessions.get(token);
  if (!session || session.expires < Date.now())
    return next(new Error("Invalid session"));
  socket.userId = session.userId;
  next();
});
agentNamespace.on("connection", (socket) => {
  const userId = socket.userId;
  logger.info(`🖥️ العميل المحلي للمستخدم ${userId} متصل`);
  userLocalAgents.set(userId, socket);
  socket.on("disconnect", () => {
    logger.info(`🖥️ العميل المحلي للمستخدم ${userId} قطع الاتصال`);
    userLocalAgents.delete(userId);
  });
  socket.on("error", (err) => {
    logger.error(`خطأ في العميل المحلي ${userId}:`, err.message);
  });
});

app.post("/api/agent/register", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const agentToken = crypto.randomBytes(32).toString("hex");
    agentRegistrationTokens.set(agentToken, {
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
  const token = socket.handshake.query.token;
  if (!token) return next(new Error("Missing token"));
  try {
    const user = await User.findOne({ screenToken: token });
    if (!user) return next(new Error("Invalid token"));
    socket.userId = String(user._id);
    next();
  } catch (err) {
    next(new Error("Authentication error: " + err.message));
  }
}).on("connection", (socket) => {
  if (socket.userId) {
    const room = `user-${socket.userId}`;
    socket.join(room);
    logger.info(
      `📱 شاشة متصلة للمستخدم ${socket.userId}، انضم إلى غرفة ${room}`,
    );
    socket.emit("connected", { room });
  } else {
    logger.info(`📱 عميل Socket.IO بدون userId: ${socket.id}`);
  }
  socket.on("disconnect", () => {
    logger.info("📱 عميل Socket.IO قطع الاتصال:", socket.id);
  });
});

app.post("/api/agent/binding-token", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = crypto.randomBytes(32).toString("hex");
    bindingTokens.set(token, { userId, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post("/api/agent/exchange-binding", async (req, res) => {
  try {
    const { bindingToken } = req.body;
    const data = bindingTokens.get(bindingToken);
    if (!data || data.expires < Date.now())
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired binding token" });
    bindingTokens.delete(bindingToken);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    agentSessions.set(sessionToken, {
      userId: data.userId,
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    let wsProtocol = "ws";
    if (process.env.NODE_ENV === "production") wsProtocol = "wss";
    const wsUrl = `${wsProtocol}://${req.headers.host}/agent`;
    res.json({ success: true, sessionToken, wsUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================ Cron Job لمراقبة الاشتراكات ================
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

// ================ صفحة ربط العميل المحلي (Agent) ================
app.get("/agent-auth", async (req, res) => {
  const { callbackPort } = req.query;
  const port = callbackPort || 3456;
  let protocol = req.protocol;
  if (process.env.NODE_ENV === "production") protocol = "https";
  const serverUrl = `${protocol}://${req.get("host")}`;
  const bindingToken = crypto.randomBytes(32).toString("hex");
  bindingTokens.set(bindingToken, {
    userId: null,
    expires: Date.now() + 5 * 60 * 1000,
    callbackPort: port,
    serverUrl,
  });
  res.send(
    `<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ربط العميل المحلي - BlackMoon</title><style>body{background:#0a0a0a;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.container{background:#1e1e1e;padding:30px;border-radius:12px;text-align:center;max-width:400px;}input,button{padding:10px;margin:10px;border-radius:6px;border:none;}input{width:80%;background:#333;color:white;}button{background:#4caf50;color:white;cursor:pointer;}.error{color:#f44336;}</style></head><body><div class="container"><h2>🔗 ربط العميل المحلي</h2><p>الرجاء تسجيل الدخول أولاً ثم النقر على زر الربط.</p><div id="status"></div><button id="bindBtn">ربط العميل</button></div><script>const bindBtn=document.getElementById('bindBtn');const statusDiv=document.getElementById('status');const bindingToken='${bindingToken}';const callbackPort=${port};const serverUrl='${serverUrl}';async function checkLogin(){try{const res=await fetch('/api/auth/me',{credentials:'include'});const data=await res.json();if(data.success){statusDiv.innerHTML='<span style="color:#4caf50">✅ تم تسجيل الدخول كـ '+data.user.email+'</span>';return true;}else{statusDiv.innerHTML='<span style="color:#ff9800">⚠️ لم تسجل الدخول. سيتم فتح نافذة تسجيل الدخول.</span>';return false;}}catch(e){statusDiv.innerHTML='<span class="error">❌ خطأ في الاتصال</span>';return false;}}bindBtn.onclick=async()=>{const loggedIn=await checkLogin();if(!loggedIn){window.open('/login','_blank');alert('سجل الدخول ثم اضغط على الربط مرة أخرى');return;}const tokenRes=await fetch('/api/agent/binding-token',{credentials:'include'});const tokenData=await tokenRes.json();if(!tokenData.success){statusDiv.innerHTML='<span class="error">فشل الحصول على رمز الربط</span>';return;}const finalToken=tokenData.token;window.location.href=\`http://localhost:\${callbackPort}/callback?sessionToken=\${finalToken}&serverUrl=\${serverUrl}\`;};checkLogin();</script></body></html>`,
  );
});
app.get("/api/agent/binding-token", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = crypto.randomBytes(32).toString("hex");
    bindingTokens.set(token, { userId, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post("/api/agent/exchange-binding", async (req, res) => {
  try {
    const { bindingToken } = req.body;
    const data = bindingTokens.get(bindingToken);
    if (!data || data.expires < Date.now())
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired binding token" });
    bindingTokens.delete(bindingToken);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    agentSessions.set(sessionToken, {
      userId: data.userId,
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    let wsProtocol = "ws";
    if (process.env.NODE_ENV === "production") wsProtocol = "wss";
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

// تنظيف دوري للذاكرة كل ساعة
setInterval(
  () => {
    if (giftCommandsCache.size > 1000) giftCommandsCache.clear();
    if (interactionCommandsCache.size > 1000) interactionCommandsCache.clear();
    if (executedOncePerLive.size > 1000) executedOncePerLive.clear();
    if (likeCounters.size > 1000) likeCounters.clear();
    if (followExecutedUsers.size > 1000) followExecutedUsers.clear();
    if (giftStreakState.size > 1000) giftStreakState.clear();
  },
  60 * 60 * 1000,
);
