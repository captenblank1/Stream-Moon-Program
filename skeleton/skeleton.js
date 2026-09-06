/* ============================================================
   skeleton/skeleton.js — وحدة السكيلتون (مجلد مستقل بذاته)
   ============================================================
   - hideAppSkeleton(): تُخفى صفحة السكيلتون الافتتاحية بتلاشٍ سلس
     (يستدعيها main.js فور جهوز البيانات)
   - lines(n) / cards(n) / formRows(n) / tableRows(n): مولدات كتل
     سكيلتون جاهزة تحاكي شكل المحتوى الحقيقي (بطاقات/نماذج/جداول)
   - شبكة أمان: لو تعطل أي مسار تحميل تُخفى الصفحة تلقائياً بعد 20 ثانية */

(function () {
  "use strict";

  var FADE_MS = 450;
  var AUTO_HIDE_MS = 20000;
  var hidden = false;

  function hideAppSkeleton() {
    if (hidden) return;
    hidden = true;
    var el = document.getElementById("appSkeleton");
    if (!el) return;
    el.classList.add("sk-hide");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, FADE_MS + 60);
  }

  // شبكة أمان — لا يعلق المستخدم على السكيلتون مهما حدث في main.js
  setTimeout(hideAppSkeleton, AUTO_HIDE_MS);

  /* مولد كتل سكيلتون عامة: عناصر HTML جاهزة للإدراج مكان نصوص التحميل */
  function lines(n, widths) {
    var count = n || 3;
    var wrap = document.createElement("div");
    wrap.className = "sk-inline";
    for (var i = 0; i < count; i++) {
      var line = document.createElement("div");
      line.className = "sk-line";
      var w = widths && widths[i] ? widths[i] : 70 + ((i * 13) % 25) + "%";
      line.style.width = w;
      wrap.appendChild(line);
    }
    return wrap;
  }

  function cards(n) {
    var count = n || 3;
    var grid = document.createElement("div");
    grid.className = "sk-grid";
    for (var i = 0; i < count; i++) {
      var card = document.createElement("div");
      card.className = "sk-card";
      card.appendChild(lines(2));
      grid.appendChild(card);
    }
    return grid;
  }

  /* صفوف نموذج — تحاكي «تسمية + حقل» مثل نموذج إعدادات الهوت كي */
  function formRows(n) {
    var count = n || 3;
    var wrap = document.createElement("div");
    wrap.className = "sk-form";
    for (var i = 0; i < count; i++) {
      var row = document.createElement("div");
      row.className = "sk-frow";
      var label = document.createElement("div");
      label.className = "sk-pill";
      label.style.width = "84px";
      label.style.height = "30px";
      var field = document.createElement("div");
      field.className = "sk-field";
      field.appendChild(lines(1, ["100%"]));
      row.appendChild(label);
      row.appendChild(field);
      wrap.appendChild(row);
    }
    var btn = document.createElement("div");
    btn.className = "sk-pill sk-fbtn";
    wrap.appendChild(btn);
    return wrap;
  }

  /* جدول — رأس بأعمدة ثم صفوف بيانات، مثل جداول الأوامر والاختصارات */
  function tableRows(n) {
    var count = n || 4;
    var t = document.createElement("div");
    t.className = "sk-table";
    var head = document.createElement("div");
    head.className = "sk-thead";
    for (var h = 0; h < 5; h++) {
      var hc = document.createElement("div");
      hc.className = "sk-cell";
      hc.appendChild(lines(1, ["80%"]));
      head.appendChild(hc);
    }
    t.appendChild(head);
    for (var i = 0; i < count; i++) {
      var r = document.createElement("div");
      r.className = "sk-tr";
      for (var c = 0; c < 5; c++) {
        var cell = document.createElement("div");
        cell.className = "sk-cell";
        cell.appendChild(lines(1, [55 + ((i * 17 + c * 11) % 40) + "%"]));
        r.appendChild(cell);
      }
      t.appendChild(r);
    }
    return t;
  }

  /* جدول الأكشنز — يطابق جدول الأوامر الحقيقي: 13 عموداً بنفس الترتيب
     (سحب/تفعيل/أزرار/اسم/أمر/شاشة/تكرار/فاصل/تأخير/صوت/فيديو/مستويان)
     وارتفاع صف 51px — حتى لا تظهر فروقات عند الظهور والاختفاء */
  function commandsTable(n) {
    var count = n || 8;
    var wrap2 = document.createElement('div');
    wrap2.className = 'sk-ctablewrap';

    var title = document.createElement('div');
    title.className = 'sk-line';
    title.style.width = '200px';
    title.style.height = '20px';
    title.style.marginBottom = '16px';
    wrap2.appendChild(title);

    var t = document.createElement('div');
    t.className = 'sk-ctable';

    var mk = function (cls) {
      var el = document.createElement('div');
      el.className = cls;
      return el;
    };

    var head = document.createElement('div');
    head.className = 'sk-chead';
    for (var h = 0; h < 13; h++) head.appendChild(mk('sk-hline'));
    t.appendChild(head);

    for (var i = 0; i < count; i++) {
      var r = document.createElement('div');
      r.className = 'sk-crow';
      var drag = mk('sk-cdrag');
      drag.appendChild(mk('sk-sq'));
      drag.appendChild(mk('sk-sq'));
      r.appendChild(drag);
      r.appendChild(mk('sk-sq sk-cb'));
      var btns = mk('sk-cbtns');
      btns.appendChild(mk('sk-sq'));
      btns.appendChild(mk('sk-sq'));
      btns.appendChild(mk('sk-sq'));
      r.appendChild(btns);
      r.appendChild(mk('sk-in'));
      r.appendChild(mk('sk-in sk-inwide'));
      r.appendChild(mk('sk-in sk-innum'));
      r.appendChild(mk('sk-in sk-innum'));
      r.appendChild(mk('sk-in sk-innum'));
      r.appendChild(mk('sk-in sk-innum'));
      r.appendChild(mk('sk-sq sk-cb'));
      r.appendChild(mk('sk-sq sk-cb'));
      r.appendChild(mk('sk-rng'));
      r.appendChild(mk('sk-rng'));
      t.appendChild(r);
    }
    wrap2.appendChild(t);
    return wrap2;
  }

  /* سكيلتون صفحة الهوت كي — يطابق بنيتها: عنوان 61px + نموذج إعدادات
     374px (3 صفوف حقل + زر حفظ) + قسم قائمة بعنوان وجدول 7 أعمدة صف 46px */
  function hotkeyPage() {
    var w = document.createElement('div');
    w.className = 'sk-hkwrap';

    var h1 = document.createElement('div');
    h1.className = 'sk-line';
    h1.style.width = '300px';
    h1.style.height = '24px';
    w.appendChild(h1);

    var form = document.createElement('div');
    form.className = 'sk-hkform';
    for (var i = 0; i < 3; i++) {
      var row = document.createElement('div');
      row.className = 'sk-hkrow';
      var lbl = document.createElement('div');
      lbl.className = 'sk-pill';
      lbl.style.width = '80px';
      lbl.style.height = '26px';
      var fld = document.createElement('div');
      fld.className = 'sk-hkfield';
      row.appendChild(lbl);
      row.appendChild(fld);
      form.appendChild(row);
    }
    var save = document.createElement('div');
    save.className = 'sk-pill sk-hksave';
    form.appendChild(save);
    w.appendChild(form);

    var h2 = document.createElement('div');
    h2.className = 'sk-line';
    h2.style.width = '220px';
    h2.style.height = '18px';
    h2.style.marginTop = '28px';
    w.appendChild(h2);

    var t = document.createElement('div');
    t.className = 'sk-hktable';
    var head = document.createElement('div');
    head.className = 'sk-hkhead';
    for (var c = 0; c < 7; c++) {
      var hc = document.createElement('div');
      hc.className = 'sk-hkhcell';
      head.appendChild(hc);
    }
    t.appendChild(head);
    for (var r2 = 0; r2 < 4; r2++) {
      var tr = document.createElement('div');
      tr.className = 'sk-hktr';
      for (var c2 = 0; c2 < 7; c2++) {
        var cell = document.createElement('div');
        cell.className = 'sk-hkcell';
        tr.appendChild(cell);
      }
      t.appendChild(tr);
    }
    w.appendChild(t);
    return w;
  }

  /* سكيلتون لوحة الأدمن — يطابق بنيتها: رأس فخم + شبكة بطاقات إحصائيات
     + قسم كبير + شريط بحث + قسم أصغر + جدول مستخدمين */
  function adminPage() {
    var w = document.createElement('div');
    w.className = 'sk-adwrap';

    var head = document.createElement('div');
    head.className = 'sk-adhead';
    var t1 = document.createElement('div');
    t1.className = 'sk-line';
    t1.style.width = '260px';
    t1.style.height = '26px';
    var t2 = document.createElement('div');
    t2.className = 'sk-line';
    t2.style.width = '180px';
    t2.style.height = '13px';
    head.appendChild(t1);
    head.appendChild(t2);
    w.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'sk-adgrid';
    for (var g = 0; g < 4; g++) {
      var card = document.createElement('div');
      card.className = 'sk-adcard';
      var num = document.createElement('div');
      num.className = 'sk-adnum';
      var lbl = document.createElement('div');
      lbl.className = 'sk-line';
      lbl.style.width = '70%';
      lbl.style.height = '11px';
      card.appendChild(num);
      card.appendChild(lbl);
      grid.appendChild(card);
    }
    w.appendChild(grid);

    var big = document.createElement('div');
    big.className = 'sk-adbig';
    var bt = document.createElement('div');
    bt.className = 'sk-line';
    bt.style.width = '200px';
    bt.style.height = '16px';
    bt.style.marginBottom = '14px';
    big.appendChild(bt);
    var chart = document.createElement('div');
    chart.className = 'sk-adchart';
    big.appendChild(chart);
    w.appendChild(big);

    var search = document.createElement('div');
    search.className = 'sk-adsearch';
    w.appendChild(search);

    var small = document.createElement('div');
    small.className = 'sk-adsmall';
    var st = document.createElement('div');
    st.className = 'sk-line';
    st.style.width = '160px';
    st.style.height = '14px';
    st.style.marginBottom = '10px';
    small.appendChild(st);
    var rowsWrap = document.createElement('div');
    rowsWrap.className = 'sk-ctable';
    for (var r3 = 0; r3 < 3; r3++) {
      var rr = document.createElement('div');
      rr.className = 'sk-crow';
      rr.style.minHeight = '42px';
      for (var c3 = 0; c3 < 5; c3++) {
        var cc = document.createElement('div');
        cc.className = 'sk-in';
        rr.appendChild(cc);
      }
      rowsWrap.appendChild(rr);
    }
    small.appendChild(rowsWrap);
    w.appendChild(small);
    return w;
  }

  /* جدول قائمة الهوت كي — 7 أعمدة وصف 46px مثل الجدول الحقيقي */
  function hotkeyTable(n) {
    var count = n || 5;
    var t = document.createElement('div');
    t.className = 'sk-hktable';
    var head = document.createElement('div');
    head.className = 'sk-hkhead';
    for (var h = 0; h < 7; h++) head.appendChild(mk2('sk-hkhcell'));
    t.appendChild(head);
    for (var i = 0; i < count; i++) {
      var tr = document.createElement('div');
      tr.className = 'sk-hktr';
      for (var c = 0; c < 7; c++) tr.appendChild(mk2('sk-hkcell'));
      t.appendChild(tr);
    }
    function mk2(cls) {
      var el = document.createElement('div');
      el.className = cls;
      return el;
    }
    return t;
  }

  // استبدال محتوى عنصر بسكيلتون حتى تجهز البيانات — ثم استرجاع المحتوى
  function wrap(el, options) {
    if (!el) return null;
    var opts = options || {};
    var placeholder =
      opts.type === "cards" ? cards(opts.count || 3) : lines(opts.count || 3);
    var saved = el.innerHTML;
    el.innerHTML = "";
    el.appendChild(placeholder);
    return {
      restore: function (html) {
        el.innerHTML = html !== undefined ? html : saved;
      },
    };
  }

  /* طبقة سكيلتون فوق قسم قائم أثناء تحميل بياناته — لا تمس محتوى القسم
     ولا عناصره (المحملات تجد عناصرها سليمة) وتُزال فور الاكتمال.
     opts.build: مولد بديل للطبقة (مثلاً نموذج+جدول لصفحة الهوت كي).
     تُرجع دالة إزالة الطبقة. */
  function overlay(el, opts) {
    if (!el) return function () {};
    // أي طبقة سابقة على نفس العنصر تُنهى فوراً قبل إنشاء الجديدة
    if (typeof el._skFinish === "function") {
      try { el._skFinish(); } catch (e) {}
    }
    var prevPosition = el.style.position;
    var addedPosition = false;
    if (window.getComputedStyle(el).position === "static") {
      el.style.position = "relative";
      addedPosition = true;
    }
    el.classList.add("sk-loading");
    el.querySelectorAll(":scope > .sk-overlay").forEach(function (old) {
      old.remove();
    });
    var layer = document.createElement("div");
    layer.className = "sk-overlay";
    var content =
      opts && typeof opts.build === "function" ? opts.build() : cards(6);
    if (content) layer.appendChild(content);
    el.appendChild(layer);

    var finished = false;
    var finish = function () {
      // طبقة أحدث حلّت محلنا على نفس العنصر — لا نلمس شيئاً
      if (finished || el._skFinish !== finish) return;
      finished = true;
      el._skFinish = null;
      if (addedPosition) el.style.position = prevPosition;
      el.classList.remove("sk-loading");
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    };
    el._skFinish = finish;
    return finish;
  }

  window.Skeleton = {
    version: "1.3",
    hideAppSkeleton: hideAppSkeleton,
    lines: lines,
    cards: cards,
    formRows: formRows,
    tableRows: tableRows,
    commandsTable: commandsTable,
    hotkeyPage: hotkeyPage,
    hotkeyTable: hotkeyTable,
    adminPage: adminPage,
    wrap: wrap,
    overlay: overlay,
  };
})();
