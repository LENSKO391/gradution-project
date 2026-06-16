// =============================================================================
// FileProcessor.core.js — معالج الملفات: الأساسيات
// =============================================================================
// هذا الملف يحتوي على الجزء الأساسي من FileProcessor class:
//   1. كشف نوع الملف (isText, isImage, is3D, ...)
//   2. توليد أسماء الملفات الناتجة عن التشفير/فك التشفير
//   3. تحميل الملفات للمستخدم (#triggerDownload)
//   4. قراءة محتوى الملفات
// =============================================================================

class FileProcessorCore {

  // ===========================================================================
  // SECTION 1 — كشف نوع الملف
  // ===========================================================================
  // كل دالة تأخذ File object وتُعيد true/false

  /** هل الملف نص؟ (.txt) */
  static isText(f) {
    return f && (f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt'));
  }

  /** هل الملف صورة 2D؟ (PNG, JPEG) */
  static isImage(f) {
    return f && (
      f.type === 'image/png' || f.type === 'image/jpeg' ||
      /\.(png|jpe?g)$/i.test(f.name)
    );
  }

  /**
   * هل الملف نموذج 3D؟
   * الامتدادات المدعومة: OBJ, STL
   */
  static is3D(f) {
    return f && /\.(obj|stl)$/i.test(f.name);
  }

  /** هل الملف CSV؟ */
  static isCsv(f) {
    return f && (f.type === 'text/csv' || f.name.toLowerCase().endsWith('.csv'));
  }

  /** هل الملف Excel؟ (.xlsx) */
  static isXlsx(f) {
    return f && (
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      f.name.toLowerCase().endsWith('.xlsx')
    );
  }

  /** هل الملف dataset? (CSV أو XLSX) */
  static isDataset(f) {
    return FileProcessorCore.isCsv(f) || FileProcessorCore.isXlsx(f);
  }

  // ===========================================================================
  // SECTION 2 — توليد أسماء الملفات الناتجة
  // ===========================================================================
  // قاعدة التسمية:
  //   encrypt: "document.txt"      → "document.txt.encrypted.txt"
  //   decrypt: "document.txt.encrypted.txt" → "document.txt.decrypted.txt"

  /** اسم ملف النص بعد فك التشفير */
  static decryptedName(name) {
    return name.endsWith('.encrypted.txt')
      ? `${name.replace('.encrypted.txt', '')}.decrypted.txt`
      : `${name}.decrypted.txt`;
  }

  /**
   * اسم الصورة بعد فك التشفير.
   * FIX: كان يستخدم replace() ويفترض أنها تُعيد string مختلف دائماً —
   * لكن replace() تُعيد النص الأصلي إذا لم يوجد match (وهو truthy دائماً).
   * الحل: نستخدم مقارنة صريحة.
   */
  static decryptedImageName(name) {
    const noExt = name.replace(/\.encrypted\.png$/i, '');
    if (noExt !== name) return `${noExt}.decrypted.png`;
    if (name.toLowerCase().endsWith('.png'))
      return `${name.slice(0, -4)}.decrypted.png`;
    return `${name}.decrypted.png`;
  }

  /** اسم ملف 3D بعد فك التشفير */
  static decrypted3DName(name) {
    if (name.includes('.encrypted.'))
      return name.replace('.encrypted.', '.decrypted.');
    return `${name}.decrypted`;
  }

  /** اسم ملف dataset بعد فك التشفير (يحافظ على الامتداد الأصلي) */
  static decryptedDatasetName(name, originalName = '') {
    if (originalName) {
      const extIdx = originalName.lastIndexOf('.');
      if (extIdx !== -1)
        return `${originalName.substring(0, extIdx)}.decrypted${originalName.substring(extIdx)}`;
      return `${originalName}.decrypted`;
    }
    if (name.endsWith('.encrypted.csv')) {
      const original = name.replace('.encrypted.csv', '');
      const dot = original.lastIndexOf('.');
      return dot !== -1
        ? `${original.substring(0, dot)}.decrypted${original.substring(dot)}`
        : `${original}.decrypted`;
    }
    return `${name}.decrypted`;
  }

  // ===========================================================================
  // SECTION 3 — تحميل الملفات
  // ===========================================================================

  /**
   * يُحمّل Blob للمستخدم باستخدام أفضل طريقة متاحة في المتصفح.
   *
   * الأولوية:
   *   1. File System Access API (Chrome/Edge الحديث) → يفتح نافذة "Save As"
   *   2. msSaveOrOpenBlob (IE/Edge القديم)
   *   3. إنشاء <a> مؤقت والضغط عليه (يعمل في كل المتصفحات)
   *
   * @private
   */
  static async #triggerDownload(blob, name) {
    // المحاولة الأولى: File System Access API
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name });
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
        return;
      } catch (err) {
        // AbortError = المستخدم ألغى → نتجاهله ونكمل
        if (err.name !== 'AbortError') console.error(err);
      }
    }

    // المحاولة الثانية: API قديم لـ IE/Edge
    if (window.navigator?.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, name);
      return;
    }

    // المحاولة الثالثة: object URL + رابط مؤقت
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: name,
      style: 'display:none'
    });
    document.body.appendChild(a);
    a.click(); // نُحرّك الضغط برمجياً
    // ننتظر قليلاً ثم نُنظّف الـ DOM والـ URL
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /** يُحمّل محتوى نصي كملف */
  static async download({ text, name, mimeType = 'text/plain;charset=utf-8' }) {
    return FileProcessorCore.#triggerDownload(new Blob([text], { type: mimeType }), name);
  }

  /** يُحمّل بيانات ثنائية (Uint8Array) كملف */
  static async downloadBytes({ bytes, name, mimeType = 'application/octet-stream' }) {
    return FileProcessorCore.#triggerDownload(new Blob([bytes], { type: mimeType }), name);
  }

  // ===========================================================================
  // SECTION 4 — قراءة الملفات
  // ===========================================================================

  /** يقرأ محتوى الملف كـ string (للملفات النصية) */
  static async readText(file) {
    return file.text(); // File API: يُعيد Promise<string>
  }

  /**
   * يقرأ محتوى الملف كـ ArrayBuffer (للملفات الثنائية: صور، نماذج 3D)
   * يستخدم FileReader لأن بعض المتصفحات القديمة لا تدعم file.arrayBuffer()
   */
  static async readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsArrayBuffer(file);
    });
  }
}

export default FileProcessorCore;
