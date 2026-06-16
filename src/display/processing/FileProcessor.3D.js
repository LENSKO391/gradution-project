// =============================================================================
// FileProcessor.3D.js — معالجة وتشفير النماذج ثلاثية الأبعاد
// =============================================================================
// هذا الملف مسؤول عن تشفير وفك تشفير ملفات 3D.
//
// كل صيغة 3D لها بنية مختلفة، لذا لكل منها طريقة تشويه مختلفة:
//
// ┌─────────┬─────────────────────────────────────────────────────────────┐
// │ الصيغة │ طريقة التشويه وإخفاء البيانات                              │
// ├─────────┼─────────────────────────────────────────────────────────────┤
// │   STL   │ تشويه vertices + إخفاء البيانات في attribute bytes          │
// │   OBJ   │ تشويه إحداثيات vertices النصية + إلحاق CVLT payload         │
// │   GLB   │ XOR على BIN chunk (الجيومتري والتكستشر)                     │
// │  GLTF   │ تشويه الـ base64 buffers في JSON                            │
// │ الباقي  │ إلحاق CVLT payload في نهاية الملف                          │
// └─────────┴─────────────────────────────────────────────────────────────┘
//
// Magic Bytes: 'CVLT' (0x43, 0x56, 0x4C, 0x54)
// يُستخدم لتحديد موقع البيانات المخفية في الملف المشفر.
// =============================================================================

import CryptoEngine from '../core/CryptoEngine';

// ===========================================================================
// SECTION 1 — تشفير ملفات STL
// ===========================================================================
// بنية STL Binary:
//   [80 bytes header] [4 bytes triangle_count] [triangle_count × 50 bytes]
//   كل مثلث: [12 bytes normal] [36 bytes vertices (3×12)] [2 bytes attribute]

/**
 * يُشوّه نموذج STL بصرياً باستخدام keystream مشتق من الـ password.
 * يُعدّل إحداثيات الـ vertices بإضافة ضجيج عشوائي ≤ ±30% من القيمة الأصلية.
 *
 * @param {Uint8Array} bytes    - بيانات ملف STL الأصلية
 * @param {string} password     - كلمة السر للاشتقاق
 * @returns {Promise<Uint8Array>} STL مشوّه
 */
/**
 * Validates that an STL file is binary (not ASCII) and structurally sound.
 * Throws a descriptive error if the file is ASCII, too small, or has a
 * triangle count that doesn't match the actual file size.
 */
const validateBinarySTL = (bytes) => {
  // Must have at least 84 bytes for the header + triangle count field
  if (bytes.length < 84) {
    throw new Error('STL file is too small or corrupt (must be at least 84 bytes).');
  }

  const view     = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expected = 84 + triCount * 50;

  // If the size formula doesn't match, this is likely an ASCII STL or a corrupt file.
  // NOTE: Do NOT use header text ("solid") to detect ASCII — many binary exporters
  // (Blender, Fusion 360, etc.) also write "solid <name>" in their 80-byte header.
  if (expected !== bytes.length) {
    // Check if it looks like a text file (ASCII STL)
    const sample = new TextDecoder().decode(bytes.slice(0, 256));
    if (sample.toLowerCase().includes('solid') && sample.includes('facet')) {
      throw new Error(
        'ASCII STL format detected. Please re-export your model as Binary STL (available in Blender, Fusion 360, MeshLab, etc.).'
      );
    }
    // Some binary files have extra trailing bytes — allow up to 84 extra
    if (expected > bytes.length) {
      throw new Error(
        `STL file appears truncated or corrupt. Triangle count field says ${triCount} triangles ` +
        `(needs ${expected} bytes) but file is only ${bytes.length} bytes.`
      );
    }
    // expected < bytes.length means there are trailing bytes — that's fine, proceed
  }

  if (triCount === 0) {
    throw new Error('STL file contains no triangles.');
  }

  return triCount;
};

const distortSTL = async (bytes, password) => {
  const triCount  = validateBinarySTL(bytes); // validates bounds before any DataView access
  const view      = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const distorted = new Uint8Array(bytes.subarray(0, 84 + triCount * 50));

  // اشتقاق keystream من الـ password
  const salt        = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const key         = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
  const keystreamLen = Math.max(65536, triCount * 36 + 1); // +1 guards against triCount=0
  const keystream   = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(keystreamLen))
  );

  let keystreamPos = 0;

  for (let t = 0; t < triCount; t++) {
    const triOffset = 84 + t * 50;

    // تشويه إحداثيات الـ vertices (3 vertices × 3 مركبات × 4 bytes لكل float)
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const floatOffset = triOffset + 12 + v * 12 + c * 4;
        const origFloat   = view.getFloat32(floatOffset, true);

        // ضجيج في النطاق [-0.3, +0.3] نسبة للقيمة الأصلية
        const noiseVal  = (keystream[keystreamPos % keystream.length] / 255) * 0.6 - 0.3;
        const newFloat  = Math.max(-1000, Math.min(1000, origFloat + origFloat * noiseVal));

        // كتابة القيمة المشوّهة
        const fb = new Uint8Array(4);
        new DataView(fb.buffer).setFloat32(0, newFloat, true);
        for (let b = 0; b < 4; b++) distorted[floatOffset + b] = fb[b];

        keystreamPos++;
      }
    }
  }

  return distorted;
};

/**
 * يُخفي البيانات في ملف STL ويُشوّهه بصرياً.
 *
 * إذا كان الـ payload صغيراً بما يكفي:
 *   → يُخزّنه في attribute bytes (2 bytes لكل مثلث)
 *   → يكتب magic 'CV' في أول مثلث + length في الثاني
 *
 * إذا كان كبيراً:
 *   → fallback: يُلحق CVLT payload في نهاية الملف
 */
const encodeToStlWithEmbeddedData = async (originalBytes, dataBytes, password) => {
  const originalTriCount = validateBinarySTL(originalBytes); // safe bounds check first
  const view             = new DataView(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);
  const maxPayloadBytes  = originalTriCount * 2; // 2 bytes attribute لكل مثلث

  if (dataBytes.length + 8 <= maxPayloadBytes) {
    // الطريقة 1: تخزين في attribute bytes
    const distorted = new Uint8Array(originalBytes.length);
    distorted.set(originalBytes);

    let dataPos = 0;
    for (let t = 0; t < originalTriCount && dataPos < dataBytes.length + 4; t++) {
      const attrOffset = 84 + t * 50 + 48; // موقع attribute bytes
      if (t === 0) {
        // Magic bytes: 'CV'
        distorted[attrOffset] = 0x43; // 'C'
        distorted[attrOffset + 1] = 0x56; // 'V'
        dataPos = 2;
      } else if (t === 1) {
        // طول البيانات (2 bytes)
        distorted[attrOffset]     = (dataBytes.length >> 8) & 0xFF;
        distorted[attrOffset + 1] = dataBytes.length & 0xFF;
        dataPos += 2;
      } else {
        const remaining    = dataBytes.length - (dataPos - 4);
        const bytesToWrite = Math.min(2, remaining);
        for (let i = 0; i < bytesToWrite; i++) {
          distorted[attrOffset + i] = dataBytes[dataPos - 4 + i];
          dataPos++;
        }
      }
    }

    // التشويه البصري للـ vertices
    if (password) {
      const salt      = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
      const key       = await CryptoEngine.deriveKey({ password, salt, iterations: 500 });
      const keystream = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(65536))
      );
      let kpos = 0;
      for (let t = 0; t < originalTriCount; t++) {
        const triOffset = 84 + t * 50;
        for (let v = 0; v < 3; v++) {
          for (let c = 0; c < 3; c++) {
            const floatOffset = triOffset + 12 + v * 12 + c * 4;
            const origFloat   = view.getFloat32(floatOffset, true);
            const factor      = 0.5 + (keystream[kpos % keystream.length] / 255);
            const fb = new Uint8Array(4);
            new DataView(fb.buffer).setFloat32(0, origFloat * factor, true);
            for (let b = 0; b < 4; b++) distorted[floatOffset + b] = fb[b];
            kpos++;
          }
        }
      }
    }

    return new Blob([distorted], { type: 'application/sla' });
  } else {
    // الطريقة 2 (fallback): إلحاق CVLT في نهاية الملف
    return appendCVLTPayload(originalBytes, dataBytes);
  }
};

// ===========================================================================
// SECTION 2 — تشفير ملفات OBJ
// ===========================================================================
// ملفات OBJ نصية — كل سطر يبدأ بـ 'v ' يحتوي vertex coordinates

/**
 * يُشوّه ملف OBJ بتعديل إحداثيات الـ vertices ثم يُلحق CVLT payload.
 * الضجيج المضاف: ±40% من القيمة الأصلية (مشتق من الـ password).
 */
const encodeToDistortedObj = async (originalBytes, dataBytes, password) => {
  const text  = new TextDecoder().decode(originalBytes);
  const lines = text.split('\n');

  // حساب عدد الـ vertices لتحديد حجم الـ keystream
  let vertexCount = 0;
  for (const line of lines)
    if (line.startsWith('v ') || line.startsWith('v\t')) vertexCount++;

  // اشتقاق keystream (3 floats × 4 bytes لكل vertex)
  const salt        = new Uint8Array([0xAB, 0xCD, 0xEF, 0x01]);
  const distKey     = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
  const keystreamLen = Math.max(65536, vertexCount * 12 + 16);
  const keystream   = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, distKey, new Uint8Array(keystreamLen))
  );

  // تشويه أسطر الـ vertices
  let kpos = 0;
  const distortedLines = lines.map(line => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('v ') && !trimmed.startsWith('v\t')) return line;
    const parts = trimmed.split(/\s+/); // ['v', x, y, z]
    if (parts.length < 4) return line;
    return parts.map((p, i) => {
      if (i === 0) return p; // نحافظ على 'v'
      const orig = parseFloat(p);
      if (isNaN(orig)) return p;
      const noise = (keystream[kpos++ % keystream.length] / 255) * 0.8 - 0.4;
      const val   = orig === 0 ? noise * 0.5 : orig + orig * noise;
      return val.toFixed(6);
    }).join(' ');
  });

  // إعادة تجميع الملف + إلحاق CVLT
  const distortedBytes = new TextEncoder().encode(distortedLines.join('\n'));
  return appendCVLTPayload(distortedBytes, dataBytes, 'application/octet-stream');
};

// ===========================================================================
// SECTION 3 — تشفير ملفات GLB
// ===========================================================================
// بنية GLB: [header(12)] [JSON chunk] [BIN chunk (optional)]
// الـ BIN chunk يحتوي الجيومتري (vertices, indices) والتكستشر

/**
 * يُطبّق XOR على الـ BIN chunk في ملف GLB لتشويه الجيومتري والتكستشر،
 * ثم يُلحق CVLT payload في نهاية الملف.
 */
const encodeGLB = async (bytes, dataBytes, password) => {
  const view    = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic   = view.getUint32(0, true);
  const version = view.getUint32(4, true);

  // التحقق من GLB signature (0x46546C67 = 'glTF')
  if (magic !== 0x46546C67)
    throw new Error('Not a valid GLB file');

  const result    = new Uint8Array(bytes);
  const jsonLen   = view.getUint32(12, true); // طول الـ JSON chunk
  const binStart  = 12 + 8 + jsonLen;          // بداية الـ BIN chunk

  if (binStart + 8 <= bytes.length) {
    const binLen = view.getUint32(binStart, true);
    const binDataStart = binStart + 8;

    // اشتقاق keystream لتشويه الـ BIN chunk
    const salt      = new Uint8Array([0xGL & 0xFF, 0xB0, 0xDA, 0xAA]); // salt خاص بـ GLB
    const key       = await CryptoEngine.deriveKey({ password, salt, iterations: 1000 });
    const keystream = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(Math.max(65536, binLen)))
    );

    // XOR على كل bytes الـ BIN chunk
    for (let i = 0; i < binLen && binDataStart + i < result.length; i++)
      result[binDataStart + i] ^= keystream[i % keystream.length];
  }

  return appendCVLTPayload(result, dataBytes);
};

// ===========================================================================
// SECTION 4 — CVLT Magic Signature (للصيغ العامة)
// ===========================================================================
// 'CVLT' = CipherVault (المشروع) — magic bytes لتحديد الـ payload في الملف

/**
 * يُلحق البيانات المشفرة في نهاية أي ملف باستخدام CVLT magic signature.
 * البنية: [الملف الأصلي] [CVLT(4)] [length(4)] [payload]
 */
const appendCVLTPayload = (fileBytes, dataBytes, mimeType = 'application/octet-stream') => {
  const magic  = new TextEncoder().encode('CVLT');
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, dataBytes.length, true);

  const result = new Uint8Array(fileBytes.length + 4 + 4 + dataBytes.length);
  result.set(fileBytes, 0);
  result.set(magic, fileBytes.length);
  result.set(lenBuf, fileBytes.length + 4);
  result.set(dataBytes, fileBytes.length + 8);

  return new Blob([result], { type: mimeType });
};

// ===========================================================================
// SECTION 5 — فك التشفير: decodeFromDistorted3D
// ===========================================================================

/**
 * يستخرج البيانات المشفرة من ملف 3D مشوّه.
 *
 * يجرّب طريقتين:
 *   1. بالنسبة لـ STL: يبحث عن magic 'CV' في attribute bytes
 *   2. لكل الصيغ: يبحث عن magic 'CVLT' من نهاية الملف للخلف
 *
 * @param {File} file - الملف المشفر
 * @returns {Promise<Uint8Array>} البيانات المشفرة (JSON payload bytes)
 */
const decodeFromDistorted3D = async (file) => {
  const bytes    = new Uint8Array(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  // محاولة 1: STL مع embedded data في attribute bytes
  if (fileName.endsWith('.stl') || fileName.endsWith('.stlb')) {
    try {
      const view     = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const triCount = view.getUint32(80, true);
      const firstAttr = 84 + 48; // attribute bytes للمثلث الأول

      if (bytes[firstAttr] === 0x43 && bytes[firstAttr + 1] === 0x56) {
        // وجدنا magic 'CV' ← بيانات مضمّنة في attribute bytes
        const secondAttr = 84 + 50 + 48;
        const dataLength = (bytes[secondAttr] << 8) | bytes[secondAttr + 1];
        const payload    = new Uint8Array(dataLength);
        let payloadPos   = 0;

        for (let t = 2; t < triCount && payloadPos < dataLength; t++) {
          const attrOffset   = 84 + t * 50 + 48;
          const remaining    = dataLength - payloadPos;
          const bytesToRead  = Math.min(2, remaining);
          for (let i = 0; i < bytesToRead; i++)
            payload[payloadPos++] = bytes[attrOffset + i];
        }

        if (payloadPos === dataLength) return payload;
      }
    } catch (err) {
      console.warn('Embedded data extraction failed, trying CVLT method', err);
    }
  }

  // محاولة 2: البحث عن CVLT magic من نهاية الملف
  const magic    = [0x43, 0x56, 0x4C, 0x54]; // 'CVLT'
  let magicPos   = -1;

  for (let i = bytes.length - 8; i >= 0; i--) {
    if (bytes[i]   === magic[0] && bytes[i+1] === magic[1] &&
        bytes[i+2] === magic[2] && bytes[i+3] === magic[3]) {
      magicPos = i;
      break;
    }
  }

  if (magicPos === -1)
    throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');

  const dataLength = new DataView(bytes.buffer, bytes.byteOffset + magicPos + 4, 4).getUint32(0, true);
  const dataStart  = magicPos + 8;

  if (dataStart + dataLength > bytes.length)
    throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');

  return bytes.slice(dataStart, dataStart + dataLength);
};

/**
 * نقطة الدخول الرئيسية للتشفير 3D.
 * تختار الدالة المناسبة بحسب امتداد الملف.
 */
const encodeToDistorted3D = async (dataBytes, file, password) => {
  const bytes    = new Uint8Array(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.obj'))
    return encodeToDistortedObj(bytes, dataBytes, password);
  if (fileName.endsWith('.stl') || fileName.endsWith('.stlb'))
    return encodeToStlWithEmbeddedData(bytes, dataBytes, password);
  if (fileName.endsWith('.glb'))
    return encodeGLB(bytes, dataBytes, password);
  // GLTF, FBX, وغيرها: fallback بـ CVLT append
  return appendCVLTPayload(bytes, dataBytes, file.type || 'application/octet-stream');
};

export { encodeToDistorted3D, decodeFromDistorted3D };
