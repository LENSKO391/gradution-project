// =============================================================================
// FileProcessor.2D.js — معالجة وتشفير الصور ثنائية الأبعاد
// =============================================================================
// هذا الملف مسؤول عن تشفير وفك تشفير الصور 2D باستخدام تقنية Steganography.
//
// الفكرة الأساسية (PNG Steganography):
//   - عند التشفير: البيانات المشفرة تُخبَّأ داخل chunk خاص في ملف PNG،
//     بينما البيكسلات تُشوَّه بصرياً باستخدام keystream مشتق من الـ password.
//   - عند فك التشفير: نبحث عن الـ chunk الخاص ونستخرج البيانات منه.
//
// هذا يعني أن الملف الناتج:
//   ✓ يبدو صورة مشوشة لا معنى لها (لحماية المحتوى)
//   ✓ يحتوي على البيانات المشفرة مخفية داخله
//   ✓ يمكن فتحه كصورة PNG عادية في أي برنامج
// =============================================================================

import CryptoEngine from '../core/CryptoEngine';

// ===========================================================================
// SECTION 1 — مساعدات PNG (CRC, Adler, Chunks)
// ===========================================================================
// ملف PNG يتكون من: signature (8 bytes) + chunks
// كل chunk له: length(4) + type(4) + data + CRC(4)

/** جدول CRC32 محسوب مسبقاً (لحساب checksum كل chunk) */
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++)
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

/** يحسب CRC32 لمجموعة bytes — يُستخدم لـ PNG chunk checksum */
const _crc32 = (buf, offset = 0, length = buf.length - offset) => {
  let crc = 0xFFFFFFFF;
  for (let i = offset; i < offset + length; i++)
    crc = _crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

/** يحسب Adler-32 checksum — يُستخدم لـ zlib footer */
const _adler32 = (buf) => {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

/** يحوّل عدد 32-bit إلى 4 bytes بترتيب Big-Endian (مطلوب في PNG) */
const _u32be = (n) => [
  (n >>> 24) & 0xFF,
  (n >>> 16) & 0xFF,
  (n >>> 8) & 0xFF,
  n & 0xFF
];

/**
 * يبني PNG chunk صحيح البنية.
 * البنية: [length(4)] [type(4)] [data] [CRC(4)]
 */
const _chunk = (type, data) => {
  const typeBytes = [...type].map(c => c.charCodeAt(0));
  const crcInput  = new Uint8Array([...typeBytes, ...data]);
  return new Uint8Array([
    ..._u32be(data.length), // طول البيانات
    ...typeBytes,            // نوع الـ chunk (4 أحرف)
    ...data,                 // البيانات
    ..._u32be(_crc32(crcInput)) // CRC checksum
  ]);
};

/**
 * يضغط البيانات بـ zlib store mode (بدون ضغط فعلي — فقط تغليف).
 * نستخدمه لأن Web Crypto API لا يدعم ضغط zlib مباشرة.
 */
const _zlibStore = (raw) => {
  const BSIZE = 65535;
  const parts = [new Uint8Array([0x78, 0x01])]; // zlib header
  for (let i = 0; i < raw.length || i === 0; i += BSIZE) {
    const slice = raw.slice(i, i + BSIZE);
    const last  = (i + BSIZE >= raw.length) ? 1 : 0;
    // deflate block header: BFINAL + LEN + ~LEN
    parts.push(new Uint8Array([
      last,
      slice.length & 0xFF, (slice.length >> 8) & 0xFF,
      (~slice.length) & 0xFF, ((~slice.length) >> 8) & 0xFF
    ]), slice);
  }
  parts.push(new Uint8Array(_u32be(_adler32(raw)))); // Adler-32 footer
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

// ===========================================================================
// SECTION 2 — بناء وتحليل PNG
// ===========================================================================

/**
 * يبني PNG صحيح البنية من أبعاد وبيانات بيكسلات RGBA.
 * يستخدم color type 2 (RGB بدون alpha) لتجنب مشاكل premultiplied alpha.
 */
const _buildPNG = (width, height, rgbaPixels) => {
  const sig  = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
  const ihdr = new Uint8Array([..._u32be(width), ..._u32be(height), 8, 2, 0, 0, 0]);
  const rowBytes = width * 3; // RGB = 3 bytes per pixel
  const rawRows  = new Uint8Array(height * (1 + rowBytes)); // +1 لـ filter byte

  for (let y = 0; y < height; y++) {
    rawRows[y * (1 + rowBytes)] = 0; // filter type = None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4; // RGBA source
      const dst = y * (1 + rowBytes) + 1 + x * 3; // RGB destination
      rawRows[dst]     = rgbaPixels[src];
      rawRows[dst + 1] = rgbaPixels[src + 1];
      rawRows[dst + 2] = rgbaPixels[src + 2];
      // نتجاهل قناة alpha (src+3)
    }
  }

  const chunks = [
    sig,
    _chunk('IHDR', Array.from(ihdr)),
    _chunk('IDAT', Array.from(_zlibStore(rawRows))),
    _chunk('IEND', [])
  ];

  const png = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of chunks) { png.set(c, off); off += c.length; }
  return png;
};

/**
 * يبني PNG بدون chunk IEND (لأننا سنُضيف chunks مخصصة قبله).
 * نفس _buildPNG لكن يتوقف قبل IEND.
 */
const _buildPNGNoEnd = (width, height, rgbaPixels) => {
  const sig  = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array([..._u32be(width), ..._u32be(height), 8, 2, 0, 0, 0]);
  const rowBytes = width * 3;
  const rawRows  = new Uint8Array(height * (1 + rowBytes));

  for (let y = 0; y < height; y++) {
    rawRows[y * (1 + rowBytes)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + rowBytes) + 1 + x * 3;
      rawRows[dst]     = rgbaPixels[src];
      rawRows[dst + 1] = rgbaPixels[src + 1];
      rawRows[dst + 2] = rgbaPixels[src + 2];
    }
  }

  const parts = [sig, _chunk('IHDR', Array.from(ihdr)), _chunk('IDAT', Array.from(_zlibStore(rawRows)))];
  const len   = parts.reduce((s, c) => s + c.length, 0);
  const out   = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

// ===========================================================================
// SECTION 3 — التشفير: encodeToDistortedPng
// ===========================================================================

/**
 * يُشفّر بيانات ويخبئها داخل صورة PNG مشوّهة.
 *
 * الخطوات:
 *   1. يشتق keystream من الـ password (للتشويه البصري)
 *   2. يُحمّل الصورة الأصلية ويستخرج بيكسلاتها
 *   3. يُطبّق XOR بين البيكسلات والـ keystream (تشويه بصري)
 *   4. يبني PNG مع chunk مخصص 'enCr' يحتوي البيانات المشفرة
 *
 * لماذا XOR البيكسلات؟
 *   - يجعل الصورة تبدو مشوّشة بصرياً (لا يمكن رؤية المحتوى)
 *   - لكن البيانات الفعلية محفوظة في chunk منفصل (لا يُمسّ بضغط PNG)
 *
 * @param {Uint8Array} dataBytes    - البيانات المشفرة (JSON payload)
 * @param {File} originalFile       - الصورة الأصلية (لأخذ أبعادها وبيكسلاتها)
 * @param {string} password         - كلمة السر
 * @returns {Promise<Blob>}         - PNG مشوّه يحتوي البيانات مخفية
 */
const encodeToDistortedPng = async (dataBytes, originalFile, password) => {
  // الخطوة 1: اشتقاق مفتاح للتشويه البصري (iterations منخفض لأنه للبصر فقط)
  const distortionSalt = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const distortionKey  = await CryptoEngine.deriveKey({ password, salt: distortionSalt, iterations: 1000 });

  // الخطوة 2: قراءة بيكسلات الصورة الأصلية
  let width, height, rgba;
  if (originalFile) {
    const img = await new Promise((res) => {
      const i = new window.Image();
      i.onload = () => res(i);
      i.src = URL.createObjectURL(originalFile);
    });
    width  = img.width;
    height = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  } else {
    // إذا لم تكن هناك صورة، نستخدم canvas 256×256 رمادي
    width = 256; height = 256;
    rgba = new Uint8Array(width * height * 4).fill(128);
  }

  // الخطوة 3: توليد keystream وتشويه البيكسلات بـ XOR
  const zeroArray = new Uint8Array(Math.max(65536, width * height * 4));
  const keystream = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, distortionKey, zeroArray)
  );

  for (let p = 0; p < width * height; p++) {
    const ri = p * 4;
    const ki = p % keystream.length;
    rgba[ri]     ^= keystream[ki];           // Red
    rgba[ri + 1] ^= keystream[(ki + 1) % keystream.length]; // Green
    rgba[ri + 2] ^= keystream[(ki + 2) % keystream.length]; // Blue
    // Alpha لا يُمسّ
  }

  // الخطوة 4: بناء PNG مع chunk 'enCr' يحتوي البيانات المشفرة
  // 'enCr' = اسم chunk خاص (أحرف صغيرة تعني "private/ancillary chunk" في PNG spec)
  const pngWithoutEnd = _buildPNGNoEnd(width, height, rgba);
  const enCrChunk     = _chunk('enCr', Array.from(dataBytes)); // chunk سري بالبيانات
  const iend          = _chunk('IEND', []); // نهاية الملف

  const total = pngWithoutEnd.length + enCrChunk.length + iend.length;
  const out   = new Uint8Array(total);
  out.set(pngWithoutEnd, 0);
  out.set(enCrChunk, pngWithoutEnd.length);
  out.set(iend, pngWithoutEnd.length + enCrChunk.length);

  return new Blob([out], { type: 'image/png' });
};

// ===========================================================================
// SECTION 4 — فك التشفير: decodeFromDistortedPng
// ===========================================================================

/**
 * يستخرج البيانات المشفرة من صورة PNG مشوّهة.
 *
 * الخطوات:
 *   1. يتحقق من PNG signature
 *   2. يمشي عبر chunks باحثاً عن 'enCr'
 *   3. يستخرج البيانات من الـ chunk المخصص
 *
 * @param {File} file - ملف PNG المشوّه
 * @returns {Promise<Uint8Array>} البيانات المشفرة (JSON payload bytes)
 * @throws إذا لم يوجد chunk 'enCr' (ليس ملف مشفر بهذا التطبيق)
 */
const decodeFromDistortedPng = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // التحقق من PNG signature
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++)
    if (bytes[i] !== sig[i]) throw new Error('Not a valid PNG file.');

  // المشي عبر chunks للبحث عن 'enCr'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8; // نبدأ بعد الـ signature

  while (off + 12 <= bytes.length) {
    const len  = view.getUint32(off); off += 4;
    const type = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]); off += 4;

    if (type === 'enCr') {
      // وجدنا الـ chunk! نُعيد البيانات
      return bytes.slice(off, off + len);
    }

    off += len + 4; // نتخطى data + CRC
  }

  throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
};

export {
  encodeToDistortedPng,
  decodeFromDistortedPng,
  // مُصدَّرة للاستخدام الداخلي في FileProcessor.3D.js أيضاً
  _chunk, _buildPNG, _buildPNGNoEnd, _crc32, _adler32, _u32be, _zlibStore
};
