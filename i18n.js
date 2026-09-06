/* ============================================================
   i18n.js — نظام اللغة: الإنجليزية افتراضياً + مبدل للعربية
   - القاموس: عربي → إنجليزي (نصوص ثابتة + رسائل)
   - عند lang=en: تُترجم عُقد الصفحة والخصائص وتُقلب الاتجاه LTR
   - عند lang=ar: النصوص الأصلية كما هي واتجاه RTL
   - التبديل: زر اللغة يخزن الاختيار ويعيد تحميل الصفحة
   ============================================================ */
(function () {
  "use strict";

  var lang = localStorage.getItem("sm_lang") || "en";

  /* قاموس النصوص الدقيقة (بعد تطبيع المسافات) */
  var EXACT = {
    /* ===== عناصر عامة وأزرار ===== */
    "تسجيل الدخول": "Login",
    "إنشاء حساب": "Sign Up",
    "تسجيل الخروج": "Logout",
    "حذف الحساب": "Delete Account",
    "حذف البروفايل": "Delete Profile",
    "اضافه البروفايل": "Add Profile",
    "استيراد أوامر من ملف JSON": "Import commands from JSON file",
    "نسخ البروفايل": "Export Profile",
    "تصدير الأوامر إلى ملف JSON": "Export commands to JSON file",
    "اشتراك فى خطه": "Subscribe to a Plan",
    "البريد الإلكتروني": "Email",
    "كلمة المرور": "Password",
    "تأكيد كلمة المرور": "Confirm Password",
    "دخول": "Sign In",
    "تسجيل": "Register",
    "إنشاء حساب جديد": "Create New Account",
    "إظهار / إخفاء كلمة المرور": "Show / Hide Password",
    "نعم": "Yes",
    "لا": "No",
    "إلغاء": "Cancel",
    "تأكيد": "Confirm",
    "حفظ الإعدادات": "Save Settings",
    "حفظ الاختصار": "Save Shortcut",
    "تحديث الاختصار": "Update Shortcut",
    "لم يتم التعيين": "Not set",
    "اختر مفتاح": "Select Key",
    "تعيين زر كيبورد": "Set Keyboard Key",
    "إلغاء الاختصار": "Clear Shortcut",
    "الكل": "All",
    "تحديد الكل": "Select All",
    "الوجهة:": "Destination:",
    "استبدال": "Replace",
    "استبدال الكل": "Replace All",
    "اختيار": "Select",
    "الاسم": "Name",
    "الامر": "Command",
    "الأمر": "Command",
    "الأمر / Webhook": "Command / Webhook",
    "الشاشة": "Screen",
    "التكرار": "Repeat",
    "الفاصل": "Interval",
    "تأخير": "Delay",
    "صوت": "Sound",
    "فيديو": "Video",
    "صوت الفيديو": "Video Sound",
    "المدة": "Duration",
    "الحالة": "Status",
    "النوع": "Type",
    "الهدية": "Gift",
    "إجراء": "Action",
    "اسم الأمر": "Command Name",
    "المفتاح": "Key",
    "المفتاح:": "Key:",
    "الأمر:": "Command:",
    "مفعل": "Enabled",
    "فعال": "Active",
    "متوقف": "Disabled",
    "تعديل": "Edit",
    "حذف": "Delete",
    "حذف الأمر": "Delete Command",
    "حذف الاختصار": "Delete Shortcut",
    "حذف الصوت": "Delete Audio",
    "حذف الفيديو": "Delete Video",
    "إزالة الصوت": "Remove Audio",
    "إزالة الفيديو": "Remove Video",
    "رفع صوت من الكمبيوتر": "Upload audio from computer",
    "اختر صوت...": "Choose audio...",
    "اختر صوتاً": "Choose an audio",
    "ابحث عن صوت...": "Search audio...",
    "انقر على أي صوت لاختياره، أو استخدم زر الاستماع لتجربته": "Click any audio to select it, or use the play button to preview it",
    "تجربة الصوت": "Preview audio",
    "إلغاء الرفع": "Cancel Upload",
    "جاري تحميل البيانات...": "Loading data...",
    "جاري تحميل الاختصارات...": "Loading shortcuts...",
    "جاري تحميل الروابط...": "Loading links...",
    "جاري تحميل روابط الشاشات...": "Loading screen links...",
    "جاري تحميل الرابط...": "Loading link...",
    "تحميل...": "Loading...",
    "تحميل": "Download",
    "جاري الحفظ...": "Saving...",
    "جاري الخروج...": "Logging out...",
    "جارٍ المعالجة...": "Processing...",
    "جارٍ تسجيل الدخول...": "Logging in...",
    "جارٍ إنشاء الحساب...": "Creating account...",
    "جاري رفع الصوت...": "Uploading audio...",
    "جاري رفع الفيديو...": "Uploading video...",
    "جاري تنفيذ الأمر...": "Executing command...",
    "انتظار انتهاء رفع الملفات قبل الحفظ...": "Waiting for uploads to finish before saving...",
    "تم الحفظ": "Saved",
    "تم الحفظ تلقائيًا": "Saved automatically",
    "تم النسخ!": "Copied!",
    "نسخ": "Copy",
    "نسخ الرابط": "Copy Link",
    "تم نسخ رابط OBS": "OBS link copied",
    "تم نسخ رابط العداد لـ OBS": "Counter OBS link copied",
    "تم نسخ البصمة": "Device fingerprint copied",
    "اضغط للنسخ": "Click to copy",
    "خطأ في النسخ": "Copy error",
    "خطأ في الاتصال": "Connection error",
    "خطأ في الاتصال بالخادم": "Server connection error",
    "خطأ في الاتصال بالسيرفر": "Server connection error",
    "خطأ غير معروف": "Unknown error",
    "خطأ أثناء الحذف": "Error while deleting",
    "خطأ أثناء الحفظ": "Error while saving",
    "خطأ أثناء تنفيذ الأمر": "Error while executing command",
    "خطأ أثناء حذف الصوت": "Error deleting audio",
    "خطأ أثناء حذف الفيديو": "Error deleting video",
    "خطأ: زر الحفظ غير موجود": "Error: save button not found",
    "فشل الحفظ": "Save failed",
    "فشل الحذف": "Delete failed",
    "فشل التجديد": "Renewal failed",
    "فشل التعديل: ": "Edit failed: ",
    "فشل الحذف: ": "Delete failed: ",
    "فشل تبديل البروفايل": "Profile switch failed",
    "فشل تحديث الأمر": "Command update failed",
    "فشل تحديث الاسم": "Name update failed",
    "فشل تحديث الحالة": "Status update failed",
    "فشل تحميل الأوامر": "Failed to load commands",
    "فشل تحميل الإعدادات": "Failed to load settings",
    "فشل تحميل الاختصارات": "Failed to load shortcuts",
    "فشل تنفيذ الأمر — راجع الكونسول": "Command execution failed — check the console",
    "فشل حفظ الاختصار": "Shortcut save failed",
    "فشل حفظ الإعدادات على السيرفر": "Failed to save settings on server",
    "فشل حفظ الإعدادات: ": "Settings save failed: ",
    "فشل حذف الاختصار": "Shortcut delete failed",
    "فشل حذف الصوت: ": "Audio delete failed: ",
    "فشل حذف الفيديو: ": "Video delete failed: ",
    "فشل رفع الصوت: ": "Audio upload failed: ",
    "فشل رفع الفيديو: ": "Video upload failed: ",
    "فشل قطع الاتصال: ": "Disconnect failed: ",
    "فشلت العملية": "Operation failed",
    "فشلت العملية: ": "Operation failed: ",
    "فشل الإرسال: ": "Send failed: ",
    "فشل الحصول على التوكن": "Failed to get token",
    "فشل تصدير البروفايل: ": "Profile export failed: ",
    "فشل تصدير الملف: ": "File export failed: ",
    "فشل استيراد الأوامر الجديدة: ": "Failed to import new commands: ",
    "فشل استيراد الأوامر المكررة: ": "Failed to import duplicate commands: ",
    "فشل استيراد الاختصارات: ": "Failed to import shortcuts: ",
    "فشل استيراد البروفايل المشترك: ": "Failed to import shared profile: ",
    "خطأ في الاتصال أثناء الاستيراد": "Connection error during import",
    "خطأ في الاتصال أثناء الاستيراد المشترك": "Connection error during shared import",
    "خطأ في الاتصال أثناء التصدير": "Connection error during export",
    "خطأ في الاتصال أثناء قراءة الملف": "Connection error while reading file",
    "خطأ في الاتصال، جاري استعادة الحالة السابقة": "Connection error, restoring previous state",
    "خطأ في الاتصال، جاري الاستعادة": "Connection error, restoring",
    "فشل حفظ الترتيب، جاري استعادة الحالة السابقة": "Order save failed, restoring previous state",
    "فشل حفظ الترتيب، جاري الاستعادة": "Order save failed, restoring",
    "تم حفظ الترتيب الجديد": "New order saved",
    "تم نقل الأمر لأعلى": "Command moved up",
    "تم نقل الأمر لأسفل": "Command moved down",
    "هذا الأمر في الأعلى بالفعل": "Command is already at the top",
    "هذا الأمر في الأسفل بالفعل": "Command is already at the bottom",
    "أمر غير موجود في البروفايل": "Command not found in profile",
    "أمر محذوف": "Deleted command",
    "لم يتم العثور على السطر": "Row not found",
    "لم يتم العثور على الاختصار": "Shortcut not found",
    "معرف الأمر غير صالح": "Invalid command ID",
    "لا يمكن حفظ أمر بدون ID": "Cannot save a command without ID",
    "لا يوجد بروفايل محدد": "No profile selected",
    "لم يتم تحديد بروفايل": "No profile selected",
    "اختر بروفايل أولاً": "Select a profile first",
    "لازم تختار Profile قبل الحذف": "Select a Profile before deleting",
    "لازم تحط اسم للأمر قبل الحفظ": "You must give the command a name before saving",
    "يرجى إدخال اسم الإجراء": "Please enter the action name",
    "يرجى اختيار أمر من القائمة": "Please choose a command from the list",
    "يرجى اختيار مفتاح": "Please select a key",
    "يرجى اختيار مفتاح من لوحة المفاتيح": "Please select a key from the keyboard",
    "يرجى اختيار مفتاح من لوحة المفاتيح أولاً": "Please select a key from the keyboard first",
    "يرجى اختيار هدية": "Please choose a gift",
    "لم تختر أي أمر": "You did not select any command",
    "لا توجد نتائج": "No results",
    "لا توجد هدايا": "No gifts",
    "لا توجد أصوات - ارفع ملفاً": "No audios — upload a file",
    "لا توجد أوامر في هذا البروفايل لنسخها": "No commands in this profile to copy",
    "لا توجد اختصارات مسجلة في هذا البروفايل": "No shortcuts registered in this profile",
    "لا توجد أسماء — أضف أسماء في الحقل أعلاه": "No names — add names in the field above",
    "الاختصار المطلوب تعديله غير موجود": "The shortcut to edit was not found",
    "الأمر غير موجود في القائمة (ربما محذوف)": "Command not in the list (maybe deleted)",
    "الأمر متوقف لأنه غير مفعل": "Command is disabled because it is inactive",
    "الأمر غير موجود بالفعل (تم حذفه محلياً)": "Command already gone (deleted locally)",
    "تم حذف الأمر محلياً، جاري المزامنة مع الخادم...": "Command deleted locally, syncing with server...",
    "تم حذف الأمر نهائياً": "Command deleted permanently",
    "تم حذف الصوت نهائياً": "Audio deleted permanently",
    "تم حذف الفيديو نهائياً": "Video deleted permanently",
    "تم إزالة الصوت من الأمر": "Audio removed from command",
    "تم إزالة الفيديو من الأمر": "Video removed from command",
    "تم إزالة الصوت من حسابك (يبقى في السحابة)": "Audio removed from your account (stays in cloud)",
    "تم إزالة الفيديو من حسابك (يبقى في السحابة)": "Video removed from your account (stays in cloud)",
    "تم إضافة الأمر": "Command added",
    "تم تحديث الأمر": "Command updated",
    "تم تغيير نوع الأمر بنجاح": "Command type changed successfully",
    "تم تحديث اسم البروفايل": "Profile name updated",
    "تم قطع الاتصال": "Disconnected",
    "رابط الصوت غير متوفر، تأكد من رفعه بنجاح": "Audio link unavailable, make sure it uploaded successfully",
    "عناصر الواجهة غير موجودة": "UI elements not found",
    "حدث خطأ غير متوقع: ": "An unexpected error occurred: ",
    "كلمتا المرور غير متطابقتين": "Passwords do not match",
    "كلمة المرور قوية": "Strong password",
    "أضف حرفاً صغيراً (a-z)": "Add a lowercase letter (a-z)",
    "أضف رقماً (0-9)": "Add a digit (0-9)",
    "أضف رمزاً خاصاً (!@#$%...)": "Add a special character (!@#$%...)",
    "أضف حرفاً كبيراً (A-Z)": "Add an uppercase letter (A-Z)",
    "يجب أن تكون 8 أحرف على الأقل": "Must be at least 8 characters",
    "فشل إنشاء الحساب": "Account creation failed",
    "فشل تسجيل الدخول": "Login failed",
    "فشل حذف الحساب": "Account deletion failed",
    "الجهاز محظور": "Device blocked",
    "مباشر": "LIVE",
    "غير متصل": "Offline",
    "نشط": "Active",
    "منتهي/غير نشط": "Expired/Inactive",
    "مسجل الدخول": "Logged in",
    "مدفوع": "Paid",
    "مجاني": "Free",
    "مدفوع (منتهي)": "Paid (Expired)",
    "مدير": "Admin",
    "مستخدم": "User",
    "مكرر — سيُستبدل": "Duplicate — will be replaced",
    "ملف غير صالح": "Invalid file",
    "افتراضي": "Default",
    "بدون اسم": "Unnamed",
    "تفاعل": "Interaction",
    "هدية": "Gift",
    "لايك": "Like",
    "متابعة": "Follow",
    "تعليق": "Comment",
    "مشاركة": "Share",
    "تفعيل": "Enable",
    "إلغاء تفعيل": "Disable",
    "ثانية": "seconds",
    "دقيقة": "minutes",
    "ساعة": "hour",
    "غير محدد": "Unspecified",
    "غير معروف": "Unknown",
    "تم (راجع السجل)": "Done (check log)",
    "إضافة": "Add",
    "إغلاق": "Close",
    "استماع": "Play",
    "تحميل البلوجن — نسخة مربوطة بحسابك تلقائياً": "Download plugin — auto-paired with your account",
    "ربط البلوجن": "Plugin Pairing",
    "ربط": "Pair",
    "فك الربط": "Unpair",
    "غير مقترن": "Not paired",
    "مقترن": "Paired",
    "تم فك الربط": "Unpaired",
    "البلوجن مقترن بحسابك": "Plugin is paired with your account",
    "تم فك الربط — اضغط Send ببيانات مطابقة لإعادة الربط تلقائياً": "Unpaired — press Send with matching data to re-pair automatically",
    "حمّل البلوجن من هنا فقط وضعه في مجلد": "Download the plugin only from here and put it in the",
    "بالسيرفر — أول تشغيل يربطه بحسابك": "folder of the server — first run pairs it with your account",
    "تلقائياً بدون أي كود": "automatically without any code",
    "بانتظار الربط التلقائي… تأكد أنك استخدمت النسخة المحمّلة من الزر بالأعلى (أو أن بيانات ماين كرافت مطابقة للسيرفر ثم اضغط": "Waiting for automatic pairing... make sure you used the version downloaded from the button above (or that the Minecraft data matches the server then press",
    "في حالات الفشل النادرة فقط: اكتب": "In rare failure cases only: type",
    "في كونسول السيرفر وانسخ الكود هنا:": "in the server console and copy the code here:",
    "كود الربط (مثل A7K-9MX)": "Pairing code (e.g. A7K-9MX)",
    "اختر خطة الاشتراك": "Choose a Subscription Plan",
    "شهري": "Monthly",
    "سنوي": "Yearly",
    "لمدة 30 يوم": "For 30 days",
    "توفير 30%": "Save 30%",
    "جميع المزايا": "All features",
    "لا حد للأوامر": "Unlimited commands",
    "جميع البروفايلات": "All profiles",
    "أولوية الدعم": "Priority support",
    "خصم 30%": "30% discount",
    "اختر خطة أولاً": "Choose a plan first",
    "حدث خطأ أثناء الدفع. حاول مرة أخرى.": "An error occurred during payment. Try again.",
    "تأكيد التجديد": "Confirm Renewal",
    "تأكيد الترقية": "Confirm Upgrade",
    "تأكيد إلغاء الاشتراك": "Confirm Unsubscription",
    "تم التجديد بنجاح": "Renewed successfully",
    "تم تفعيل الاشتراك بنجاح! سيتم تحديث الصفحة.": "Subscription activated successfully! The page will refresh.",
    "فشل تفعيل الاشتراك: ": "Subscription activation failed: ",
    "تم تحديث حالة الاشتراك": "Subscription status updated",
    "تم تحديث حالة اشتراكك": "Your subscription status was updated",
    "تمت الترقية": "Upgraded",
    "تمت إزالة الترقية": "Upgrade removed",
    "تمت إزالة صلاحية المدير": "Admin privileges removed",
    "فشلت الترقية": "Upgrade failed",
    "إزالة الترقية وجعل المستخدم مجانياً؟": "Remove upgrade and make the user free?",
    "ترقية المستخدم إلى مدير؟": "Promote user to admin?",
    "تأكيد إزالة المدير": "Confirm Admin Removal",
    "هل أنت متأكد من إزالة صلاحية المدير عن هذا المستخدم؟": "Are you sure you want to remove admin privileges from this user?",
    "تأكيد حظر الجهاز": "Confirm Device Block",
    "تأكيد فك الحظر": "Confirm Unblock",
    "تم حظر الجهاز": "Device blocked",
    "تم فك الحظر": "Device unblocked",
    "فشل حظر الجهاز": "Device block failed",
    "فشل فك الحظر": "Unblock failed",
    "سيتم فك الحظر عن هذا الجهاز وسيتمكن من دخول الموقع مرة أخرى. هل تريد المتابعة؟": "This device will be unblocked and can access the site again. Continue?",
    "حذف المستخدم وجميع أوامره؟ هذا الإجراء لا يمكن التراجع عنه.": "Delete the user and all their commands? This cannot be undone.",
    "تعذر العثور على الإشعار — أعد تحميل اللوحة": "Notification not found — reload the panel",
    "تم إرسال الإشعار بنجاح": "Notification sent successfully",
    "تم تعديل الإشعار": "Notification edited",
    "تم حذف الإشعار": "Notification deleted",
    "أدخل نص الإشعار": "Enter notification text",
    "النص مطلوب": "Text is required",
    "نص الإشعار...": "Notification text...",
    "هل أنت متأكد من حذف هذا الإشعار نهائياً؟": "Are you sure you want to permanently delete this notification?",
    "بحث بالبريد الإلكتروني...": "Search by email...",
    "بحث ببصمة الجهاز...": "Search by device fingerprint...",
    "بحث بـ TikTok Username...": "Search by TikTok Username...",
    "بحث عن هدية...": "Search for a gift...",
    "إجمالي المستخدمين": "Total Users",
    "إجمالي الأوامر": "Total Commands",
    "مشتركين مدفوعين": "Paid Subscribers",
    "مستخدمين مجانيين": "Free Users",
    "بثوث حية الآن": "Live Streams Now",
    "كونكت اليوم": "Connects Today",
    "هدايا اليوم": "Gifts Today",
    "هدايا الشهر": "Gifts This Month",
    "لوحة التحكم - المشرف": "Admin Dashboard",
    "إحصائيات النظام وإدارة المستخدمين": "System stats & user management",
    "لوحة التحكم": "Control Panel",
    "لوحة تحكم القائمة الأولى": "List 1 Control Panel",
    "لوحة تحكم القائمة الثانية": "List 2 Control Panel",
    "لوحة تحكم العداد": "Counter Control Panel",
    "شاشات OBS الخاصة بك": "Your OBS Screens",
    "استخدم الروابط التالية كمصدر متصفح (Browser Source) في OBS": "Use the following links as a Browser Source in OBS",
    "الروابط تعمل من جهازك أثناء فتح البرنامج — أبقِ البرنامج مفتوحاً أثناء البث": "Links work from your device while the app is open — keep the app open while streaming",
    "تعليمات الإضافة في OBS:": "OBS setup instructions:",
    "أضف مصدر جديد من نوع": "Add a new source of type",
    "متصفح (Browser)": "Browser",
    "الصق أي رابط من الروابط أعلاه": "Paste any of the links above",
    "اضبط العرض:": "Set width:",
    "والارتفاع:": "and height:",
    "استخدام معدل إطارات مخصص": "Use custom frame rate",
    "إطار/ثانية": "fps",
    "ستظهر الشاشة شفافة وتعرض محتوى الفيديو والصوت تلقائياً": "The screen will appear transparent and display video and audio automatically",
    "إعدادات الاختصار (Hotkey)": "Hotkey Settings",
    "اختر مفتاحاً وأمراً لتنفيذه عند الضغط على المفتاح.": "Choose a key and a command to execute when pressed.",
    "قائمة الاختصارات المسجلة": "Registered Shortcuts",
    "اختر اختصار لوحة المفاتيح": "Choose a Keyboard Shortcut",
    "المفتاح المحدد:": "Selected key:",
    "لوحة المفاتيح — جميع الأزرار": "Keyboard — all keys",
    "انقر على أي مفتاح لاختياره. يمكنك دمج Ctrl/Alt/Shift.": "Click any key to select it. You can combine Ctrl/Alt/Shift.",
    "اختصارات البروفايل": "Profile Shortcuts",
    "اختصارات البروفايل — حدد ما يُضمَّن في الملف": "Profile shortcuts — choose what to include in the file",
    "اختصارات الملف — حدد ما تريد استيراده": "File shortcuts — choose what to import",
    "اختر الأوامر": "Select Commands",
    "أوامر هدايا مكررة - اختر الاستبدال": "Duplicate gift commands - choose replacement",
    "هل تريد حذف كل الأوامر؟": "Delete all commands?",
    "هل تريد قطع الاتصال بالبث المباشر؟": "Disconnect from the live stream?",
    "هل أنت متأكد؟": "Are you sure?",
    "هل أنت متأكد من حذف حسابك؟ هذا الإجراء لا يمكن التراجع عنه.": "Are you sure you want to delete your account? This cannot be undone.",
    "هل أنت متأكد من حذف هذا الأمر؟": "Are you sure you want to delete this command?",
    "جاري رفع ملف حالياً. هل تريد إلغاء الرفع وإغلاق النافذة؟ سيتم فقد كل ما تم رفعه.": "A file is currently uploading. Cancel the upload and close? Everything uploaded will be lost.",
    "هل تريد إغلاق النافذة؟ سيتم فقد أي تغييرات غير محفوظة.": "Close the window? Unsaved changes will be lost.",
    "سيتم فك ارتباط البلوجن بحسابك الحالي، وسيرتبط تلقائياً مجدداً عند الضغط على Send ببيانات مطابقة. هل تريد المتابعة؟": "The plugin will be unpaired from your current account, and will re-pair automatically when you press Send with matching data. Continue?",
    "لقد وصلت للحد الأقصى للأوامر — قم بالترقية أو عطّل أوامر أخرى لإضافة المزيد.": "You reached the command limit — upgrade or disable other commands to add more.",
    "مساحة الصوت": "Audio Storage",
    "مساحة الفيديو": "Video Storage",
    "0 / 50 ميجا": "0 / 50 MB",
    "0 / 500 ميجا": "0 / 500 MB",
    "تم رفع الصوت بنجاح": "Audio uploaded successfully",
    "تم رفع الفيديو بنجاح": "Video uploaded successfully",
    "تم التحميل إلى مجلد التنزيلات": "Downloaded to the downloads folder",
    "تم تحميل البروفايل المشفر (.tfc)": "Encrypted profile loaded (.tfc)",
    "تم تحميل الملف المشفر — أرسله لمن تريد، لا يُفتح إلا داخل التطبيق": "Encrypted file loaded — send it to anyone, it opens only inside the app",
    "تم الاستيراد بنجاح": "Imported successfully",
    "تم استيراد البروفايل المشترك بنجاح (مع رفع الوسائط)": "Shared profile imported successfully (with media upload)",
    "استيراد الأوامر": "Import Commands",
    "تصدير الأوامر": "Export Commands",
    "تم حل CAPTCHA، استئناف العمل": "CAPTCHA solved, resuming",
    "تم اكتشاف CAPTCHA، يرجى حلها في النافذة المنبثقة": "CAPTCHA detected, please solve it in the popup",
    "الحساب غير متصل أو ليس لايف": "Account is not connected or not live",
    "أدخل مدة صحيحة": "Enter a valid duration",
    "تنسيق غير صحيح للهدايا من الخادم": "Invalid gifts format from server",
    "فشل تحميل الرابط — تأكد من تسجيل الدخول": "Failed to load link — make sure you are logged in",
    "الرابط لم يجهز بعد — جاري الاتصال، جرّب بعد لحظات": "Link not ready yet — connecting, try again in a moment",
    "لوحات الـ Overlay": "Overlay Panels",
    "قائمة الأساطير": "Legends List",
    "كبار الداعمين": "Top Supporters",
    "عداد الفوز/الخسارة": "Win/Loss Counter",
    "القائمة الأولى": "List 1",
    "القائمة الثانية": "List 2",
    "العنوان": "Title",
    "الأسماء (كل اسم في سطر)": "Names (one per line)",
    "اكتب الأسماء...": "Write names...",
    "تحديد التاج": "Crown Selection",
    "الثيم": "Theme",
    "التوهج": "Glow",
    "الأرقام": "Numbers",
    "العرض (px)": "Width (px)",
    "الارتفاع (px)": "Height (px)",
    "العرض (px):": "Width (px):",
    "مسح الأسماء": "Clear Names",
    "تم مسح الأسماء": "Names cleared",
    "خطأ في المسح": "Clear error",
    "تم حفظ إعدادات الأوفرلاي": "Overlay settings saved",
    "رابط OBS:": "OBS Link:",
    "رابط OBS (الصقه في المتصفح داخل OBS):": "OBS Link (paste in the browser inside OBS):",
    "اسم خانة الفوز": "Win box name",
    "اسم خانة الخسارة": "Loss box name",
    "اختر الشكل:": "Choose style:",
    "إطار دراع بلايستيشن": "PlayStation Frame",
    "إطار سماعة جيمنج": "Gaming Headset Frame",
    "إطار درع الحرب": "War Shield Frame",
    "جيمنج نيون": "Neon Gaming",
    "التنين الأحمر": "Red Dragon",
    "سام نيون": "Toxic Neon",
    "إطار ماوس جيمنج": "Gaming Mouse Frame",
    "فخامة VIP": "VIP Royale",
    "نار وثلج": "Fire & Ice",
    "ريترو أركيد": "Retro Arcade",
    "إطار القطة كيتي": "Kitty Frame",
    "إطار الأرنب": "Bunny Frame",
    "النجمة السحرية": "Magic Star",
    "بنفسجي تويتش": "Twitch Purple",
    "مينيمال بسيط": "Minimal",
    "نيون سايبر": "Cyber Neon",
    "VIP ذهبي": "VIP Gold",
    "بنفسجي": "Purple",
    "تصفير العداد": "Reset Counter",
    "معاينة حية": "Live Preview",
    "لم يتم تحميل بعض البيانات:": "Failed to load some data:",
    "تم ضغط زر اختيار مفتاح": "Key select button pressed",
    "الاختصارات النشطة": "Active shortcuts",
    "فشل تسجيل الاختصارات في النظام": "Failed to register shortcuts in the system",
    "لا توجد اختصارات نشطة": "No active shortcuts",
    "تم تعيين الاختصار: ": "Shortcut set: ",
    "تم اختيار المفتاح: ": "Key selected: ",
    "المفتاح ": "Key ",
    "مستخدم بالفعل": "already in use",
    "مستخدم بالفعل مع أمر آخر": "already used by another command",
    "هذا الأمر مستخدم بالفعل مع المفتاح ": "This command is already used with key ",
    "تم تحديث الاختصار: ": "Shortcut updated: ",
    "تم حذف الاختصار ": "Shortcut deleted ",
    "تم تعيين الاختصار: ": "Shortcut set: ",
    "تم تحديث الاختصار من ": "Shortcut updated from ",
    "إلى ": "to ",
    "تم تحميل بيانات الاختصار ": "Shortcut data loaded ",
    "للتعديل. اضغط ": "for editing. Press ",
    "تم تحديث الاختصار من \"": "Shortcut updated from \"",
    "تم التبديل إلى ": "Switched to ",
    "تم نقل أوامر ": "Moved commands of ",
    "جاري تثبيت التحديث (": "Installing update (",
    "يتوفر تحديث جديد (": "New update available (",
    "جارٍ إنشاء الحساب...": "Creating account...",
    "أمر النام باد": "Numpad key",
    /* ===== لوحة الأدمن ===== */
    "إجراءات": "Actions",
    "إدارة الإشعارات العاجلة": "Urgent Notifications",
    "إدارة شاملة — تتحدث تلقائياً بدون إعادة تشغيل": "Full management — updates automatically without restart",
    "إرسال الإشعار": "Send Notification",
    "إزالة المدير": "Remove Admin",
    "اشتراك سنه": "Yearly subscription",
    "اشتراك شهر": "Monthly subscription",
    "الأجهزة المحظورة": "Blocked Devices",
    "البريد": "Email",
    "الخطة": "Plan",
    "الدور": "Role",
    "الشبكات (IP)": "Networks (IP)",
    "الغاء الاشتراك": "Cancel Subscription",
    "النص": "Text",
    "بصمة الجهاز": "Device Fingerprint",
    "تاريخ الانتهاء": "Expiry Date",
    "تاريخ التسجيل": "Registration Date",
    "تاريخ الحظر": "Block Date",
    "ترقية مدير": "Promote to Admin",
    "تعديل الإشعار": "Edit Notification",
    "تنتهي في": "Expires in",
    "عدد الأوامر": "Commands Count",
    "لا توجد أجهزة محظورة": "No blocked devices",
    "لا توجد إشعارات": "No notifications",
    "لا توجد نتائج مطابقة": "No matching results",
    "لوحة تحكم Stream Moon": "Stream Moon Dashboard",
    "مسح": "Clear",
    "حظر الجهاز": "Block Device",
    "الوحدة": "Unit",
    "حظر": "Block",
    "إلغاء الحظر": "Unblock",
    "ترقية": "Upgrade",
    "إشعار": "Notification",
    "بحث عن مستخدم...": "Search for a user...",
    "كل تعديل يُحفظ تلقائياً — اضغط خارج النافذة للإغلاق": "Every change saves automatically — click outside to close",
    "سنة": "year",
    "يوم": "day",
    "لايف": "LIVE",
    "أوفلاين": "OFFLINE",
    "الاسطورة": "Legend",
    "استعادة الافتراضي": "Restore Defaults",
    "تمت استعادة الإعدادات الافتراضية": "Default settings restored",
    "خطأ في الاستعادة": "Restore error",
    "Webhook URL يمكنك وضع عدة روابط في سطور منفصلة مع دعم or و delay": "Webhook URL — multiple links on separate lines (supports or and delay)",
    "يمكنك وضع عدة اوامر في سطور منفصلة مع دعم or و delay": "Multiple commands on separate lines (supports or and delay)",
    "إظهار تراكب على الشاشة": "Show overlay on screen",
    "جاري تحميل الروابط...": "Loading links...",
    "اختر الشكل:": "Choose style:",
    "نص التراكب": "Overlay text",
    "/Command (ضع أمرًا في كل سطر)": "/Command (one command per line)",
    "التأخير قبل التنفيذ": "Delay before execution",
    "الفاصل بالمللي ثانية": "Interval in milliseconds",
    "النص الذي سيظهر تحت اسم الداعم": "Text shown under the supporter name",
    "رقم الشاشة": "Screen number",
    "مثال: all أو username": "e.g.: all or username",
  };

  const EN2AR = {"Write a comment to execute the command or leave the field blank for all comments": "اكتب تعليقاً ليتم تنفيذه أو اتركه فارغاً لكل التعليقات", "Webhook URL": "عنوان ويب هوك", "Action": "الاوامر", "Active": "مفعل", "Admin": "لوحه التحكم", "All": "الكل", "Choose a voice": "اختر صوتاً", "Close": "إغلاق", "Command": "الأمر", "Comment": "تعليق", "Connect to TikTok LIVE": "اتصال ببث تيك توك", "Count": "العدد", "Create Action": "إنشاء الامر", "Delay": "التأخير", "Disconnected": "غير متصل", "Display duration (seconds)": "مدة العرض (ثواني)", "Enter a username or leave it as all": "أدخل اسم مستخدم أو اتركه للجميع", "Follow": "متابعة", "Gift": "هدية", "Hotkey": "ربط الازرار", "Interaction": "تفاعل", "Interval": "الفاصل", "Like": "لايك", "Name": "الاسم", "Name Action": "اسم الامر", "Number of likes": "عدد اللايكات", "One-time execution in live": "تنفيذ مرة واحدة في البث", "Options": "خيارات", "Overlays": "روابط الشاشه", "Profile:": "البروفايل:", "Save": "حفظ", "Screen": "الشاشة", "Screens": "الشاشات", "Select File": "اختر ملفاً", "Send": "إرسال", "Share": "مشاركة", "Sound": "صوت", "Sound Volume": "مستوى الصوت", "Start": "الاعدادات", "Stream Moon": "Stream Moon", "Video": "فيديو", "Video Volume": "صوت الفيديو", "Vol": "الصوت", "Your TikTok Username": "اسم مستخدم تيك توك", "delay Before (ms)": "التأخير قبل التنفيذ (ms)", "interval (ms)": "الفاصل (ms)", "Password": "كلمة المرور", "Player Name": "اسم اللاعب", "Port": "البورت", "Login": "تسجيل الدخول", "Logout": "تسجيل الخروج", "Sign Up": "إنشاء حساب", "Delete Account": "حذف الحساب", "Delete Profile": "حذف البروفايل", "Add Profile": "إضافة بروفايل", "Export Profile": "تصدير البروفايل", "Subscribe to a Plan": "الاشتراك في خطة", "Plugin Pairing": "ربط البلوجن", "Pair": "ربط", "Unpair": "فك الربط", "Not paired": "غير مقترن", "Download plugin — auto-paired with your account": "تحميل البلوجن — مربوط بحسابك تلقائياً", "Control Panel": "لوحة التحكم", "Upload audio from computer": "رفع صوت من الكمبيوتر", "Copy Link": "نسخ الرابط", "Loading...": "جاري التحميل..."};

  /* قواعد النصوص المتغيرة — [regex, replacement أو دالة] */
  var PATTERNS = [
    [/^تم التبديل إلى (.+)$/, "Switched to $1"],
    [/^تم تعيين الاختصار: (.+)$/, "Shortcut set: $1"],
    [/^تم اختيار المفتاح: (.+)$/, "Key selected: $1"],
    [/^تم تحديث الاختصار: (.+)$/, "Shortcut updated: $1"],
    [/^تم حذف الاختصار (.+)$/, "Shortcut deleted $1"],
    [/^تم تحميل بيانات الاختصار "(.+)" للتعديل\. اضغط "تحديث الاختصار" لتطبيق التغييرات\.$/, 'Shortcut "$1" loaded for editing. Press "Update Shortcut" to apply.'],
    [/^تم تحديث الاختصار من "(.+)" إلى "(.+)"$/, 'Shortcut updated from "$1" to "$2"'],
    [/^المفتاح "(.+)" مستخدم بالفعل$/, 'Key "$1" is already in use'],
    [/^المفتاح "(.+)" مستخدم بالفعل مع أمر آخر$/, 'Key "$1" is already used by another command'],
    [/^هذا الأمر مستخدم بالفعل مع المفتاح "(.+)"$/, 'This command is already used with key "$1"'],
    [/^(تفعيل|إلغاء تفعيل) الاختصار (.+)$/, function (m) { return "Shortcut " + m[2] + (m[1] === "تفعيل" ? " enabled" : " disabled"); }],
    [/^المفتاح "(.+)" غير مدعوم$/, 'Key "$1" is not supported'],
    [/^تم قراءة (.+) أمر من الملف$/, "Read $1 commands from the file"],
    [/^خطأ أثناء الحفظ: (.*)$/, "Error while saving: $1"],
    [/^خطأ أثناء حذف الأمر: (.*)$/, "Error deleting command: $1"],
    [/^فشل تعيين اسم المستخدم: (.*)$/, "Failed to set username: $1"],
    [/^فشل رفع الصوت: (.*)$/, "Audio upload failed: $1"],
    [/^فشل رفع الفيديو: (.*)$/, "Video upload failed: $1"],
    [/^فشل حذف الصوت: (.*)$/, "Audio delete failed: $1"],
    [/^فشل حذف الفيديو: (.*)$/, "Video delete failed: $1"],
    [/^فشل قطع الاتصال: (.*)$/, "Disconnect failed: $1"],
    [/^فشل تصدير البروفايل: (.*)$/, "Profile export failed: $1"],
    [/^فشل استيراد الأوامر الجديدة: (.*)$/, "Failed to import new commands: $1"],
    [/^(تفعيل|إلغاء تفعيل) الاختصار (.+)$/, function (m) { return "Shortcut " + m[2] + (m[1] === "تفعيل" ? " enabled" : " disabled"); }],
    [/^الاختصارات النشطة: (.+)$/, "Active shortcuts: $1"],
    [/^تم حذف أوامر (.+?) — (.+)$/, "Deleted commands of $1 — $2"],
    [/^تم تعديل الاختصار من "(.+)" إلى "(.+)"$/, 'Shortcut edited from "$1" to "$2"'],
    [/^تم نسخ (.+)$/, "Copied $1"],
    [/^فشل تحميل الروابط: (.+)$/, "Failed to load links: $1"],
    [/^فشل تحميل بيانات لوحة التحكم: (.+)$/, "Failed to load dashboard data: $1"],
  ];

  /* تطبيع المسافات للمقارنة */
  function norm(s) {
    return String(s).replace(/\s+/g, " ").trim();
  }

  function t(s) {
    if (!s) return s;
    var str = String(s);
    var prefix = "";
    var m = str.match(/^((?:<i[\s\S]*?<\/i>\s*)+)/);
    var body = str;
    if (m) {
      prefix = m[1];
      body = str.slice(m[1].length);
    }
    var key = norm(body);
    var dict = lang === "en" ? EXACT : EN2AR;
    if (dict[key] !== undefined) return prefix + dict[key];
    for (var i = 0; i < PATTERNS.length; i++) {
      var r = PATTERNS[i][0];
      if (lang === "en" && r.test(key)) {
        var rep = PATTERNS[i][1];
        return prefix + (typeof rep === "function" ? key.replace(r, rep) : key.replace(r, rep));
      }
    }
    return str;
  }

  /* ترجمة عُقد الصفحة الثابتة + الخصائص */
  function applyDOM() {
    // يعمل في الاتجاهين: en يترجم العربي، ar يترجم الإنجليزي
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
    );
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var s = n.nodeValue;
      if (!s || !s.trim()) return;
      var tr = t(s);
      if (tr !== s) {
        // الحفاظ على المسافات البادئة/التابعة — بدونها تلتصق الكلمات بالعناصر المجاورة
        var lead = s.match(/^\s*/)[0];
        var trail = s.match(/\s*$/)[0];
        n.nodeValue = lead + tr + trail;
      }
    });
    ["placeholder", "title"].forEach(function (attr) {
      document.querySelectorAll("[" + attr + "]").forEach(function (el) {
        var v = el.getAttribute(attr);
        if (!v) return;
        var tr = t(v);
        if (tr !== v) el.setAttribute(attr, tr);
      });
    });
    document.querySelectorAll("input[type=text][value], input[type=password][value]").forEach(function (el) {
      var v = el.getAttribute("value");
      if (!v) return;
      var tr = t(v);
      if (tr !== v) el.setAttribute("value", tr);
    });
  }

  /* الاتجاه واللغة على مستوى الصفحة */
  if (lang === "en") {
    document.documentElement.setAttribute("dir", "ltr");
    document.documentElement.classList.add("lang-en");
  } else {
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.classList.remove("lang-en");
  }

  /* زر التبديل */
  function setupToggle() {
    var btn = document.getElementById("langToggle");
    if (!btn) return;
    var label = btn.querySelector("#langToggleLabel");
    if (label) label.textContent = lang === "en" ? "عربي" : "English";
    btn.addEventListener("click", function () {
      localStorage.setItem("sm_lang", lang === "en" ? "ar" : "en");
      location.reload();
    });
  }

  function boot() {
    applyDOM();
    setupToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* ===== حماية دائمة: منع ظهور وسوم الأيقونات كنص حرفي =====
     أي إسناد عبر textContent لقيمة تحتوي وسوم أيقونات FA يُعرض كأيقونات
     حقيقية (ومترجمة في الوضع الإنجليزي) بدل نص خام — يمنع هذه الفئة
     من الأخطاء في أي مكان بالمشروع نهائياً */
  try {
    var tcDesc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    if (tcDesc && tcDesc.set) {
      Object.defineProperty(Node.prototype, "textContent", {
        get: tcDesc.get,
        set: function (v) {
          if (
            typeof v === "string" &&
            v.indexOf("<i ") !== -1 &&
            /<i\s+class=["'][^"']*\bfa[-srb]/.test(v)
          ) {
            if (window.AppI18n && AppI18n.lang === "en") v = AppI18n.t(v);
            this.innerHTML = v;
            return;
          }
          tcDesc.set.call(this, v);
        },
        configurable: true,
      });
    }
  } catch (e) {}

  window.AppI18n = { lang: lang, t: t, applyDOM: applyDOM };
})();
