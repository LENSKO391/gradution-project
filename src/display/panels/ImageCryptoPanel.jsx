// =============================================================================
// ImageCryptoPanel.jsx — واجهة تشفير الصور (2D و 3D)
// =============================================================================
// هذا الـ component مسؤول عن واجهة تشفير وفك تشفير الملفات المرئية.
// يستقبل prop واحد مهم: forcedDimension
//   - forcedDimension="2d" → يتعامل مع صور 2D فقط (PNG steganography)
//   - forcedDimension="3d" → يتعامل مع نماذج 3D فقط (3D distortion)
//
// يُستخدم في تبويبين منفصلين في الـ App:
//   <ImageCryptoPanel user={user} forcedDimension="2d" />  ← تبويب "2D Images"
//   <ImageCryptoPanel user={user} forcedDimension="3d" />  ← تبويب "3D Models"
// =============================================================================

import { useState } from 'react';
import { Lock, Key, Eye, EyeOff, Copy, Check, Box } from 'lucide-react';
import { ModeToggle, Notice, SubmitBtn } from '../components/UIComponents';
import CryptoEngine from '../core/CryptoEngine';
import FileProcessorCore from '../processing/FileProcessor.core';
import { encodeToDistortedPng, decodeFromDistortedPng } from '../processing/FileProcessor.2D';
import { encodeToDistorted3D, decodeFromDistorted3D } from '../processing/FileProcessor.3D';
import { generateRandomKey } from '../core/utils';
import { HistoryStore } from '../HistoryStore';

/**
 * @param {Object} user             - بيانات المستخدم المسجّل دخوله
 * @param {string} forcedDimension  - '2d' أو '3d' (مُحدّد من الـ tab)
 */
const ImageCryptoPanel = ({ user, forcedDimension = null }) => {

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  const [mode, setMode] = useState('encrypt'); // 'encrypt' | 'decrypt'

  // البُعد محدّد من الـ prop ولا يتغير — نحوّله لـ const مباشرة
  const dimension = forcedDimension || '2d'; // '2d' | '3d'

  const [file, setFile]           = useState(null);    // الملف المختار
  const [fileInputKey, setFileInputKey] = useState(0); // لإعادة تعيين input الملف
  const [key, setKey]             = useState('');      // الـ password
  const [showKey, setShowKey]     = useState(false);   // إظهار/إخفاء الـ password
  const [error, setError]         = useState('');      // رسالة الخطأ
  const [success, setSuccess]     = useState('');      // رسالة النجاح
  const [processing, setProcessing] = useState(false); // جاري المعالجة؟
  const [preview, setPreview]     = useState(null);    // معاينة الصورة
  const [copied, setCopied]       = useState(false);   // تم نسخ الـ password؟

  const reset = () => { setError(''); setSuccess(''); };

  /** ينسخ الـ password للـ clipboard ويعرض ✓ لمدة ثانيتين */
  const handleCopyKey = () => {
    if (!key) return;
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ---------------------------------------------------------------------------
  // handleFile — معالجة اختيار الملف
  // ---------------------------------------------------------------------------
  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(null); setPreview(null); reset();
    if (!f) return;

    // التحقق من نوع الملف بحسب الـ mode والـ dimension
    if (mode === 'encrypt') {
      if (dimension === '2d' && !FileProcessorCore.isImage(f))
        return setError('Please select a 2D image file (PNG, JPEG).');
      if (dimension === '3d' && !FileProcessorCore.is3D(f))
        return setError('Please select a 3D model file (.obj, .stl).');
    } else {
      // عند فك التشفير: ملفات 2D يجب أن تكون PNG (الناتج دائماً PNG)
      if (dimension === '2d' && !f.name.toLowerCase().endsWith('.png'))
        return setError('Please select a PNG file (the encrypted output from this app).');
      // ملفات 3D تقبل أي امتداد لأن الملف المشفر يحتفظ بامتداده الأصلي
    }

    setFile(f);
    // معاينة الصورة عند التشفير بوضع 2D فقط
    if (mode === 'encrypt' && dimension === '2d')
      setPreview(URL.createObjectURL(f));
  };

  // ---------------------------------------------------------------------------
  // handleSubmit — تنفيذ التشفير أو فك التشفير
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault(); reset();
    if (!file) return setError('Please select a file.');
    if (!key)  return setError('Please enter a password.');
    setProcessing(true);

    try {
      if (mode === 'encrypt') {
        // ── التشفير ──────────────────────────────────────────────────────────

        // 1. قراءة بيانات الملف كـ bytes
        const plainBytes = new Uint8Array(await FileProcessorCore.readArrayBuffer(file));

        // 2. تشفير البيانات بـ AES-256-GCM
        const payload = await CryptoEngine.encrypt({ plainBytes, password: key });

        // 3. إضافة metadata للـ payload (للاستخدام عند فك التشفير)
        Object.assign(payload, { mimeType: file.type, originalName: file.name, dimension });

        // 4. تحويل الـ payload إلى JSON bytes
        const jsonPayload = new TextEncoder().encode(JSON.stringify(payload));

        if (dimension === '3d') {
          // ── تشفير 3D: تشويه هيكل الملف + إخفاء البيانات ──
          const distortedBlob = await encodeToDistorted3D(jsonPayload, file, key);
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const extension = file.name.split('.').pop();
          const outName = `${baseName}.encrypted.${extension}`;

          FileProcessorCore.downloadBytes({
            bytes: new Uint8Array(await distortedBlob.arrayBuffer()),
            name: outName,
            mimeType: file.type || 'application/octet-stream'
          });
          await HistoryStore.addRecord(user.email, {
            file: outName, action: 'Encrypt 3D Model',
            mimeType: file.type || 'application/octet-stream', data: distortedBlob
          });
          setSuccess(`Encrypted 3D model and saved as distorted "${outName}".`);

        } else {
          // ── تشفير 2D: PNG Steganography ──
          const pngBlob = await encodeToDistortedPng(jsonPayload, file, key);
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const outName  = `${baseName}.encrypted.png`;

          FileProcessorCore.downloadBytes({
            bytes: new Uint8Array(await pngBlob.arrayBuffer()),
            name: outName, mimeType: 'image/png'
          });
          await HistoryStore.addRecord(user.email, {
            file: outName, action: 'Encrypt Image', mimeType: 'image/png', data: pngBlob
          });
          setSuccess(`Encrypted and saved as PNG with hidden data.`);
        }

      } else {
        // ── فك التشفير ────────────────────────────────────────────────────────

        let jsonBytes, payload;

        if (dimension === '3d') {
          // استخراج البيانات من الملف 3D المشوّه
          jsonBytes = await decodeFromDistorted3D(file);
          // إيجاد حدود الـ JSON (قد تكون هناك bytes غير صالحة قبله أو بعده)
          const text  = new TextDecoder().decode(jsonBytes);
          const start = text.indexOf('{');
          const end   = text.lastIndexOf('}');
          if (start === -1 || end === -1)
            throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.');
          try { payload = JSON.parse(text.slice(start, end + 1)); }
          catch { throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.'); }

        } else {
          // استخراج البيانات من PNG chunk 'enCr'
          jsonBytes = await decodeFromDistortedPng(file, key);
        }

        if (!payload) {
          try { payload = JSON.parse(new TextDecoder().decode(jsonBytes)); }
          catch { throw new Error('Could not parse encrypted file. Make sure it was encrypted by this app.'); }
        }

        // التحقق من الخوارزمية
        if (payload.algorithm !== 'AES-256-GCM')
          throw new Error('Unsupported algorithm.');

        // فك التشفير — إذا كانت كلمة السر خاطئة ستُقذف استثناء هنا
        const plainBytes   = await CryptoEngine.decrypt({ payload, password: key });
        const mimeType     = payload.mimeType || (payload.dimension === '3d' ? 'application/octet-stream' : 'image/png');
        const originalName = payload.originalName || (
          payload.dimension === '3d'
            ? FileProcessorCore.decrypted3DName(file.name)
            : FileProcessorCore.decryptedImageName(file.name)
        );

        FileProcessorCore.downloadBytes({ bytes: plainBytes, name: originalName, mimeType });
        await HistoryStore.addRecord(user.email, {
          file: originalName,
          action: `Decrypt ${payload.dimension === '3d' ? '3D Model' : 'Image'}`,
          mimeType, data: plainBytes
        });
        setSuccess(`Decrypted ${payload.dimension === '3d' ? '3D model' : 'image'} and downloaded as "${originalName}".`);
      }

    } catch (err) {
      setError(err.message || 'Operation failed.');
    } finally {
      setProcessing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // JSX — واجهة المستخدم
  // ---------------------------------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* رسائل الخطأ والنجاح */}
      {error   && <Notice type="error">{error}</Notice>}
      {success && <Notice type="success">{success}</Notice>}

      {/* زرّي Encrypt / Decrypt */}
      <div className="flex flex-col gap-3">
        <ModeToggle
          value={mode}
          onChange={m => {
            setMode(m);
            setFile(null); setPreview(null);
            setKey(''); setShowKey(false);
            setFileInputKey(v => v + 1);
            reset();
          }}
        />
      </div>

      {/* اختيار الملف */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          {mode === 'encrypt'
            ? (dimension === '2d' ? 'Image File (PNG, JPEG)' : '3D Model File (.obj, .stl)')
            : (dimension === '2d' ? 'Encrypted Image File (.png)'   : 'Encrypted 3D File (any format encrypted by this app)')}
        </label>
        <input
          key={fileInputKey}
          type="file"
          accept={
            mode === 'encrypt'
              ? (dimension === '2d' ? 'image/png,image/jpeg,.png,.jpg,.jpeg' : '.obj,.stl')
              : (dimension === '2d' ? '.png'    : '.obj,.stl,.encrypted.*,*')
          }
          onChange={handleFile}
          className="w-full bg-slate-900 border border-slate-600/80 text-slate-300 rounded-lg p-3 text-sm
                     file:mr-3 file:py-1 file:px-3 file:rounded file:border-0
                     file:bg-cyan-700 file:text-white file:text-xs"
          required
        />
        {file && <p className="text-slate-500 text-xs mt-1.5">Selected: {file.name}</p>}

        {/* معاينة الملف المختار */}
        {mode === 'encrypt' && file && (
          <div className="mt-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 p-4 flex flex-col items-center justify-center gap-3">
            {dimension === '2d' && preview
              ? <img src={preview} alt="Preview" className="max-h-48 object-contain rounded" />
              : (
                <div className="py-8 flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-500">
                    <Box size={32} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-300">3D Model Selected</p>
                    <p className="text-xs text-slate-500">{file.name}</p>
                  </div>
                </div>
              )
            }
          </div>
        )}
      </div>

      {/* حقل الـ Password */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-300">Password</label>
          {/* زر توليد password عشوائي */}
          <button
            type="button"
            onClick={() => { setKey(generateRandomKey()); setShowKey(false); }}
            className="flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300
                       bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-all"
          >
            <Key size={12} /> Generate Password
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Enter password or generate one"
            className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-600/80 text-slate-200
                       rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm"
          />
          {/* زر نسخ الـ password */}
          <button type="button" onClick={handleCopyKey} className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 transition-colors">
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          {/* زر إظهار/إخفاء الـ password */}
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>

      {/* زر التشفير/فك التشفير */}
      <SubmitBtn
        processing={processing}
        mode={mode}
        label={`${mode === 'encrypt' ? 'Encrypt' : 'Decrypt'} ${dimension === '2d' ? 'Image' : '3D Model'} & Download`}
      />
    </form>
  );
};

export default ImageCryptoPanel;
