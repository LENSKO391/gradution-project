// =============================================================================
// utils.js — Utility Helpers
// =============================================================================
// هذا الملف يحتوي على دوال مساعدة صغيرة تُستخدم في كل أنحاء التطبيق.
// لا تعتمد على أي ملف آخر في المشروع (zero dependencies).
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Password Generator
// -----------------------------------------------------------------------------
// مجموعة الأحرف المسموح بها في الـ password المولّد:
// - 26 حرف كبير + 26 حرف صغير + 10 أرقام + 12 رمز خاص = 74 حرف إجمالاً
const PRNG_CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+';

/**
 * يولّد password عشوائي آمن بطول محدد (افتراضي 24 حرف).
 *
 * الخطوات:
 *  1. يملأ مصفوفة ببايتات عشوائية عبر crypto.getRandomValues()
 *     (هذا هو الـ CSPRNG — مولّد أرقام عشوائية مشفّر في المتصفح)
 *  2. لكل بايت، يحسب بقية القسمة على طول الـ charset للحصول على index
 *  3. يُضيف الحرف المقابل للـ index إلى الـ password
 *
 * القوة: 74^24 ≈ 2^145 احتمال — أقوى بكثير من أي password بشري.
 *
 * @param {number} length - طول الـ password المطلوب (افتراضي: 24)
 * @returns {string} password عشوائي قوي
 */
const generateRandomKey = (length = 24) => {
  // نولّد ضعف العدد المطلوب من البايتات لضمان الحصول على length حرف صالح
  const arr = new Uint8Array(length * 2);
  crypto.getRandomValues(arr); // ← CSPRNG من المتصفح (Web Crypto API)

  let key = '';
  for (let i = 0; i < arr.length && key.length < length; i++) {
    // نستخدم كل بايت كـ index في الـ charset (بعد % لتجنب تجاوز الحدود)
    const idx = arr[i] % PRNG_CHARSET.length;
    key += PRNG_CHARSET[idx];
  }
  return key;
};

// -----------------------------------------------------------------------------
// 2. Base64 Helpers
// -----------------------------------------------------------------------------
// المشكلة: دوال التشفير (Web Crypto API) تُرجع ArrayBuffer (بيانات ثنائية),
// لكننا نحتاج تخزينها كـ string (في JSON مثلاً).
// الحل: نحوّلها إلى Base64 — تمثيل نصي للبيانات الثنائية.

/**
 * يحوّل ArrayBuffer أو Uint8Array إلى string بتنسيق Base64.
 * يُستخدم عند تخزين: ciphertext, salt, iv في الـ JSON payload.
 *
 * @param {ArrayBuffer|Uint8Array} buf - البيانات الثنائية
 * @returns {string} Base64 string
 */
const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const C = 8192; // نُقسّم البيانات على chunks لتجنب stack overflow في btoa
  for (let i = 0; i < bytes.length; i += C)
    bin += String.fromCharCode(...bytes.subarray(i, i + C));
  return btoa(bin); // btoa = Binary To ASCII (Base64)
};

/**
 * يحوّل Base64 string إلى Uint8Array (بيانات ثنائية).
 * يُستخدم عند قراءة: ciphertext, salt, iv من الـ JSON payload لفك التشفير.
 *
 * @param {string} str - Base64 string
 * @returns {Uint8Array} بيانات ثنائية
 */
const fromB64 = (str) => {
  // نُزيل أي حرف غير صالح في Base64 ونُضيف padding إذا لزم
  const c = str.replace(/[^A-Za-z0-9+/]/g, '');
  return Uint8Array.from(
    atob(c + '='.repeat((4 - (c.length % 4)) % 4)), // atob = ASCII To Binary
    (ch) => ch.charCodeAt(0)
  );
};

export { PRNG_CHARSET, generateRandomKey, toB64, fromB64 };
