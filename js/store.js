// ============================================================
// js/store.js - نواة إدارة حالة ذكية (بدون أي اعتماد على DOM)
// تُغلف أي كائن حالة بـ Proxy تفاعلي وتوفر:
//   اشتراكات بالتغيير، حسابات مشتقة مع كاش، منع تدافع النداءات
//   (inflight dedupe)، ومثابرة اختيارية في localStorage.
// ============================================================

// منع التسريب: كل الخرائط هنا تحتفظ بمراجع دوال يعيد المستخدم إلغاؤها
// عبر الدوال الراجعة، والخرائط الداخلية لا تنمو إلا بعدد المستخدمين الفعليين.

/**
 * إنشاء مخزن تفاعلي حول كائن هدف
 * @param {object} rawTarget الكائن الذي سيُحاط بالـ Proxy
 */
export function createStore(rawTarget) {
  /** @type {Map<string, Set<Function>>} مشتركون لكل مفتاح */
  const keyListeners = new Map();
  /** @type {Set<Function>} مشتركون بكل التغييرات */
  const anyListeners = new Set();
  /** @type {Map<string, {deps: string[], fn: Function}>} حسابات مشتقة */
  const computedDefs = new Map();
  /** @type {Map<string, any>} كاش قيم الحسابات المشتقة */
  const computedCache = new Map();
  /** @type {Map<string, Promise<any>>} نداءات غير متزامنة جارية */
  const inflight = new Map();
  /** @type {Set<string>} مفاتيح تُحفظ في localStorage */
  const persistedKeys = new Set();
  let persistNamespace = null;
  let persistTimer = null;

  // ---------- الإشعارات ----------
  function notify(changedKey, newVal, oldVal) {
    // 1) إبطال الحسابات المشتقة المعتمدة على هذا المفتاح
    for (const [name, def] of computedDefs) {
      if (def.deps.includes(changedKey)) computedCache.delete(name);
    }
    // 2) مشتركو المفتاح
    const subs = keyListeners.get(changedKey);
    if (subs) {
      for (const fn of [...subs]) {
        try {
          fn(newVal, oldVal);
        } catch (e) {
          console.warn(`[Store] خطأ في مشترك "${changedKey}":`, e);
        }
      }
    }
    // 3) مشتركو الكل
    for (const fn of [...anyListeners]) {
      try {
        fn(changedKey, newVal, oldVal);
      } catch (e) {
        console.warn("[Store] خطأ في مستمع onAny:", e);
      }
    }
    // 4) المثابرة (مجدولة)
    if (persistedKeys.has(changedKey) && persistNamespace) {
      schedulePersist();
    }
  }

  // ---------- المثابرة ----------
  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        if (typeof localStorage === "undefined") return;
        const snapshot = {};
        for (const k of persistedKeys) snapshot[k] = rawTarget[k];
        localStorage.setItem(
          `sm_store:${persistNamespace}`,
          JSON.stringify(snapshot),
        );
      } catch (e) {
        /* الحصة ممتلئة أو التخزين معطل — لا نكسر التطبيق */
      }
    }, 500);
  }

  function restorePersisted() {
    try {
      if (typeof localStorage === "undefined" || !persistNamespace) return;
      const raw = localStorage.getItem(`sm_store:${persistNamespace}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const k of persistedKeys) {
        if (k in data && !(k in rawTarget)) rawTarget[k] = data[k];
      }
    } catch (e) {
      /* بيانات تالفة — تجاهل */
    }
  }

  // ---------- الوكيل التفاعلي ----------
  const proxy = new Proxy(rawTarget, {
    set(target, prop, value) {
      const key = String(prop);
      const old = target[prop];
      if (Object.is(old, value)) {
        target[prop] = value;
        return true;
      }
      target[prop] = value;
      notify(key, value, old);
      return true;
    },
    deleteProperty(target, prop) {
      const key = String(prop);
      const old = target[prop];
      delete target[prop];
      notify(key, undefined, old);
      return true;
    },
    get(target, prop) {
      return target[prop];
    },
  });

  // ---------- الواجهة العامة ----------
  const Store = {
    /** قراءة قيمة (مع بديل اختياري) */
    get(key, fallback) {
      const v = rawTarget[key];
      return v === undefined ? fallback : v;
    },

    /** كتابة قيمة — تُشعل الاشتراكات (أو بصمت مع silent) */
    set(key, value, opts = {}) {
      if (opts && opts.silent) {
        rawTarget[key] = value;
      } else {
        proxy[key] = value;
      }
      return value;
    },

    /** تحديث قيمة بدالة — update("counter", (v) => (v || 0) + 1) */
    update(key, fn) {
      return Store.set(key, fn(rawTarget[key]));
    },

    /** إثبات تغيير يدوي بعد تعديل متداخل مباشرة (كائنات/مصفوفات) */
    touch(key) {
      notify(String(key), rawTarget[key], rawTarget[key]);
    },

    /**
     * اشتراك بتغييرات مفتاح — يرجع دالة إلغاء الاشتراك
     * @returns {Function} unsubscribe
     */
    subscribe(key, fn) {
      const k = String(key);
      if (!keyListeners.has(k)) keyListeners.set(k, new Set());
      keyListeners.get(k).add(fn);
      return () => keyListeners.get(k)?.delete(fn);
    },

    /** اشتراك يُنفذ مرة واحدة عند أول تغيير */
    subscribeOnce(key, fn) {
      const off = Store.subscribe(key, (nv, ov) => {
        off();
        fn(nv, ov);
      });
      return off;
    },

    /** اشتراك بكل التغييرات — fn(key, newVal, oldVal) */
    onAny(fn) {
      anyListeners.add(fn);
      return () => anyListeners.delete(fn);
    },

    /** اشتراك بعدة مفاتيح معاً */
    watch(keys, fn) {
      const list = Array.isArray(keys) ? keys : [keys];
      const offs = list.map((k) => Store.subscribe(k, () => fn(Store)));
      return () => offs.forEach((off) => off());
    },

    /**
     * قيمة مشتقة مع كاش تُبطل تلقائياً عند تغير أي اعتمادية
     * Store.computed("canAdd", ["plan", "count"], (s) => ...)
     */
    computed(name, deps, fn) {
      computedDefs.set(String(name), { deps: deps.map(String), fn });
      computedCache.delete(String(name));
    },

    /** قراءة قيمة مشتقة (تُحسب مرة واحدة فقط بعد آخر تغيير) */
    read(name) {
      const def = computedDefs.get(String(name));
      if (!def) return undefined;
      if (computedCache.has(String(name)))
        return computedCache.get(String(name));
      const value = def.fn(Store);
      computedCache.set(String(name), value);
      return value;
    },

    /**
     * منع تدافع النداءات: عدة نداءات متزامنة لنفس المفتاح تتشارك
     * نفس الـPromise (كتحميل الهدايا عند فتح كروت متعددة معاً)
     * @param {string} key
     * @param {Function} promiseFactory () => Promise
     */
    inflight(key, promiseFactory) {
      const k = String(key);
      if (inflight.has(k)) return inflight.get(k);
      const p = promiseFactory().finally(() => inflight.delete(k));
      inflight.set(k, p);
      return p;
    },

    /** هل هناك نداء جاري لهذا المفتاح؟ */
    isInflight(key) {
      return inflight.has(String(key));
    },

    /**
     * مثابرة اختيارية: تُسترجع القيم عند الإقلاع وتُحفظ تلقائياً عند التغيير
     * @param {string[]} keys
     * @param {string} namespace
     */
    persist(keys, namespace) {
      persistNamespace = namespace;
      for (const k of keys) persistedKeys.add(String(k));
      restorePersisted();
    },

    /** لقطة كاملة للقراءة/التصحيح */
    snapshot() {
      return { ...rawTarget };
    },

    /** إحصاءات المخزن — لمراقبة الذاكرة */
    stats() {
      return {
        keyListeners: [...keyListeners.values()].reduce(
          (a, s) => a + s.size,
          0,
        ),
        anyListeners: anyListeners.size,
        computed: computedDefs.size,
        computedCached: computedCache.size,
        inflight: inflight.size,
        persisted: persistedKeys.size,
      };
    },
  };

  return { proxy, store: Store, raw: rawTarget };
}

export default createStore;
