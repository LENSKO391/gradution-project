// =============================================================================
// CryptoEngine.js — محرك التشفير الرئيسي
// =============================================================================
// هذه الـ class هي قلب التطبيق. مسؤولة عن:
//   1. اشتقاق مفتاح AES من الـ password (PBKDF2)
//   2. تشفير البيانات (AES-256-GCM)
//   3. فك تشفير البيانات
//
// تعتمد فقط على: Web Crypto API (مدمجة في المتصفح) + utils.js
// لا تعتمد على أي مكتبة خارجية.
// =============================================================================

import { toB64, fromB64 } from './utils';

class CryptoEngine {

  // ---------------------------------------------------------------------------
  // عدد التكرارات في PBKDF2
  // ---------------------------------------------------------------------------
  // كلما زاد هذا الرقم، كلما استغرق المهاجم وقتاً أطول في Brute-force.
  // 250,000 تكرار = ~250ms على جهاز عادي → يجعل Brute-force غير عملي.
  static AES_ITERATIONS = 250000;

  // ---------------------------------------------------------------------------
  // deriveKey — اشتقاق مفتاح AES من الـ password
  // ---------------------------------------------------------------------------
  /**
   * يحوّل password (نص بشري) إلى مفتاح AES-256 حقيقي (256 بت).
   * يستخدم خوارزمية PBKDF2 (Password-Based Key Derivation Function 2).
   *
   * التدفق:
   *   password (string)
   *       ↓
   *   importKey → PBKDF2 key material
   *       ↓
   *   deriveKey (PBKDF2 × 250,000 iterations + SHA-256 + salt)
   *       ↓
   *   AES-256-GCM CryptoKey
   *
   * @param {string} password - كلمة السر المدخلة من المستخدم
   * @param {Uint8Array} salt  - قيمة عشوائية لمنع هجمات Rainbow Table
   * @param {number} iterations - عدد تكرارات PBKDF2 (افتراضي: 250,000)
   * @returns {Promise<CryptoKey>} مفتاح AES-256-GCM
   */
  static async deriveKey({ password, salt, iterations = CryptoEngine.AES_ITERATIONS }) {
    // الخطوة 1: نحوّل الـ password من string إلى PBKDF2 key material
    const base = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password), // نحوّل النص إلى bytes
      'PBKDF2',
      false,          // extractable = false (لا يمكن استخراج المفتاح الخام)
      ['deriveKey']   // الاستخدام المسموح: اشتقاق مفاتيح فقط
    );

    // الخطوة 2: نشتق مفتاح AES-256-GCM باستخدام PBKDF2
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,           // القيمة العشوائية (مختلفة لكل عملية تشفير)
        iterations,     // عدد التكرارات
        hash: 'SHA-256' // دالة الهاش المستخدمة
      },
      base,
      { name: 'AES-GCM', length: 256 }, // نوع المفتاح الناتج: AES-256
      false,             // المفتاح غير قابل للاستخراج
      ['encrypt', 'decrypt'] // الاستخدامات المسموحة
    );
  }

  // ---------------------------------------------------------------------------
  // encrypt — تشفير البيانات
  // ---------------------------------------------------------------------------
  /**
   * يشفّر بيانات ثنائية بـ AES-256-GCM.
   *
   * التدفق:
   *   plainBytes (الملف الأصلي)
   *       ↓
   *   salt = random 16 bytes ← مختلف في كل عملية تشفير
   *   iv   = random 12 bytes ← مختلف في كل عملية تشفير
   *   key  = deriveKey(password, salt)
   *       ↓
   *   AES-GCM Encrypt
   *       ↓
   *   { ciphertext, salt, iv, algorithm, kdf, iterations, version }
   *
   * لماذا نحفظ salt و iv مع الـ ciphertext؟
   * لأننا نحتاجهما لاحقاً لفك التشفير، ولا يُعدّان سرية.
   *
   * @param {Uint8Array} plainBytes - البيانات الأصلية
   * @param {string} password       - كلمة السر
   * @returns {Promise<Object>} payload يحتوي ciphertext + metadata
   */
  static async encrypt({ plainBytes, password }) {
    // نولّد قيم عشوائية فريدة لكل عملية تشفير
    const salt = crypto.getRandomValues(new Uint8Array(16)); // 16 bytes = 128 bits
    const iv   = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes = 96 bits (مثالي لـ GCM)

    // نشتق المفتاح من الـ password والـ salt
    const key = await CryptoEngine.deriveKey({ password, salt });

    // نُشفّر البيانات بـ AES-GCM
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);

    // نُعيد الـ payload كاملاً (كل ما نحتاجه لفك التشفير لاحقاً)
    return {
      ciphertext: toB64(cipher),      // البيانات المشفرة (Base64)
      salt:       toB64(salt),        // القيمة العشوائية (Base64)
      iv:         toB64(iv),          // الـ initialization vector (Base64)
      algorithm:  'AES-256-GCM',      // الخوارزمية المستخدمة
      kdf:        'PBKDF2-SHA256',    // دالة اشتقاق المفتاح
      iterations: CryptoEngine.AES_ITERATIONS, // عدد التكرارات
      version:    1                   // إصدار الـ payload (للتوافق المستقبلي)
    };
  }

  // ---------------------------------------------------------------------------
  // decrypt — فك تشفير البيانات
  // ---------------------------------------------------------------------------
  /**
   * يفك تشفير بيانات كانت مشفرة بـ AES-256-GCM.
   *
   * التدفق:
   *   { ciphertext, salt, iv } من الـ payload
   *       ↓
   *   key = deriveKey(password, salt) ← نفس الـ salt المحفوظ مع الملف
   *       ↓
   *   AES-GCM Decrypt
   *       ↓
   *   plainBytes (البيانات الأصلية)
   *
   * @param {Object} payload  - الـ payload الناتج من encrypt()
   * @param {string} password - كلمة السر (يجب أن تكون نفس التي استُخدمت للتشفير)
   * @returns {Promise<Uint8Array>} البيانات الأصلية
   * @throws إذا كانت كلمة السر خاطئة أو الملف تالف
   */
  static async decrypt({ payload, password }) {
    const { ciphertext, salt, iv, iterations } = payload;

    // التحقق من اكتمال الـ payload
    if (!ciphertext || !salt || !iv)
      throw new Error('Invalid payload: missing ciphertext, salt, or iv.');

    // نشتق نفس المفتاح بنفس الـ salt (يجب أن يطابق المفتاح الأصلي)
    const key = await CryptoEngine.deriveKey({
      password,
      salt: fromB64(salt),
      iterations: iterations || CryptoEngine.AES_ITERATIONS
    });

    // نفك التشفير — إذا كانت كلمة السر خاطئة، ستُقذف استثناء هنا
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext))
    );
  }
}

export default CryptoEngine;
