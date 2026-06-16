// =============================================================================
// EncryptionSystem.jsx — المكوّن الرئيسي للتطبيق (App Shell)
// =============================================================================
// هذا هو الـ component الرئيسي الذي يجمع كل شيء.
// مسؤولياته:
//   1. مراقبة حالة المصادقة (Firebase onAuthStateChanged)
//   2. إذا لم يكن هناك مستخدم → عرض AuthScreen
//   3. إذا كان هناك مستخدم → عرض واجهة التطبيق الكاملة
//   4. إدارة التنقل بين التبويبات الخمسة
//   5. إدارة قفل سجل العمليات (History PIN)
// =============================================================================

import { useEffect, useState } from 'react';
import { LogOut, Shield, Clock } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../FirebaseAuth';
import { TabBtn } from '../components/UIComponents';
import AuthScreen from '../auth/AuthScreen';
import TextFileCryptoPanel  from '../panels/TextFileCryptoPanel';
import TextAreaCryptoPanel  from '../panels/TextAreaCryptoPanel';
import ImageCryptoPanel     from '../panels/ImageCryptoPanel';
import DatasetCryptoPanel   from '../panels/DatasetCryptoPanel';
import { HistoryPanel }     from '../HistoryPanel';
import AccountManager from '../core/AccountManager';
import { FileText, Image, Type, Database, Box } from 'lucide-react';

const accountManager = new AccountManager();

// ---------------------------------------------------------------------------
// TABS — تعريف التبويبات
// ---------------------------------------------------------------------------
// كل تبويب له: id فريد، label يظهر للمستخدم، icon من lucide-react
const TABS = [
  { id: 'file',     label: 'Text Files', icon: FileText },  // ملفات .txt
  { id: 'textarea', label: 'Plain Text', icon: Type     },  // نص مباشر
  { id: 'image',    label: '2D Images',  icon: Image    },  // صور 2D
  { id: 'model',    label: '3D Models',  icon: Box      },  // نماذج 3D
  { id: 'dataset',  label: 'Datasets',   icon: Database },  // ملفات CSV/XLSX
];

// وصف كل تبويب (يظهر أسفل العنوان)
const TAB_DESCRIPTIONS = {
  file:     'Encrypt or decrypt .txt files. Supports all characters including special symbols.',
  textarea: 'Encrypt or decrypt any text directly in the browser.',
  image:    'Encrypt or decrypt 2D image files (PNG, JPEG).',
  model:    'Encrypt or decrypt 3D model files (.obj, .stl) with visual distortion.',
  dataset:  'Encrypt or decrypt dataset files (.csv, .xlsx). Preview your data before encrypting.',
  history:  'View a timeline of all your encryption and decryption activities.',
};

// عنوان كل تبويب (يظهر داخل الـ panel)
const TAB_TITLES = {
  file:     'Text File Encryption',
  textarea: 'Plain Text Encryption',
  image:    '2D Image Encryption',
  model:    '3D Model Encryption',
  dataset:  'Dataset Encryption',
  history:  'Activity History',
};

// ---------------------------------------------------------------------------
// HistoryLock — شاشة إدخال PIN لفتح سجل العمليات
// ---------------------------------------------------------------------------
/**
 * يُعرض عندما يحاول المستخدم فتح History Tab وعنده historyPin.
 * يطلب إدخال الـ PIN قبل عرض السجل.
 */
const HistoryLock = ({ user, onUnlock }) => {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin === user.historyPin) {
      onUnlock(); // PIN صحيح → افتح السجل
    } else {
      setErr('Incorrect PIN. Please try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <div className="w-14 h-14 rounded-full bg-cyan-500/10 flex items-center justify-center">
        <Clock className="text-cyan-400" size={28} />
      </div>
      <div className="text-center">
        <h3 className="text-white font-semibold text-lg">History Locked</h3>
        <p className="text-slate-400 text-sm mt-1">Enter your PIN to view activity history</p>
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-3">
        {err && <p className="text-red-400 text-xs text-center">{err}</p>}
        <input
          type="password"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter PIN"
          className="w-full text-center text-2xl font-mono tracking-widest py-3 px-4
                     bg-slate-900 border border-slate-600 text-cyan-400 rounded-lg
                     focus:ring-2 focus:ring-cyan-500 focus:outline-none"
          autoFocus
        />
        <button
          type="submit"
          className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg
                     hover:from-cyan-500 font-semibold transition-all text-sm"
        >
          Unlock History
        </button>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// EncryptionSystem — المكوّن الرئيسي
// ---------------------------------------------------------------------------
const EncryptionSystem = () => {

  const [user, setUser]                 = useState(null);   // بيانات المستخدم
  const [isAuth, setIsAuth]             = useState(false);  // مسجّل دخول؟
  const [activeTab, setActiveTab]       = useState('file'); // التبويب النشط
  const [historyUnlocked, setHistoryUnlocked] = useState(false); // تم فتح السجل؟
  const [showChangePwd, setShowChangePwd]     = useState(false); // إظهار modal تغيير كلمة السر

  // ---------------------------------------------------------------------------
  // مراقبة حالة المصادقة (Firebase)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    /**
     * onAuthStateChanged يُستدعى:
     *   - عند بدء التطبيق (للتحقق من وجود session نشطة)
     *   - عند تسجيل الدخول/الخروج
     *
     * إذا firebaseUser موجود → استعد الـ session المحلية وأظهر التطبيق
     * إذا firebaseUser = null → أظهر صفحة تسجيل الدخول
     */
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // حاول استعادة الـ session المحلية (تحتوي name, historyPin, etc.)
        const s = accountManager.getSession();
        if (s && s.email === firebaseUser.email) {
          setUser(s);
        } else {
          setUser({
            email:      firebaseUser.email,
            name:       firebaseUser.displayName || firebaseUser.email.split('@')[0],
            historyPin: ''
          });
        }
        setIsAuth(true);
      } else {
        setUser(null);
        setIsAuth(false);
      }
    });

    // إلغاء الاشتراك عند unmount الـ component
    return () => unsubscribe();
  }, []);

  // ---------------------------------------------------------------------------
  // معالجة تسجيل الدخول والخروج
  // ---------------------------------------------------------------------------

  const handleLogin = (loggedUser) => {
    setUser(loggedUser);
    setIsAuth(true);
  };

  const handleLogout = () => {
    accountManager.clearSession(); // مسح الجلسة المحلية
    auth.signOut();                // تسجيل الخروج من Firebase
    setUser(null);
    setIsAuth(false);
    setActiveTab('file');
    setHistoryUnlocked(false);
  };

  // ---------------------------------------------------------------------------
  // Render: شاشة تسجيل الدخول
  // ---------------------------------------------------------------------------
  if (!isAuth) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  // ---------------------------------------------------------------------------
  // Render: واجهة التطبيق الرئيسية
  // ---------------------------------------------------------------------------
  const currentTab = [...TABS, { id: 'history' }].find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Shield className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">CipherVault</h1>
              <p className="text-xs text-slate-400">Welcome, {user?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* زر سجل العمليات */}
            <button
              onClick={() => { setActiveTab('history'); setHistoryUnlocked(false); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
                ${activeTab === 'history'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-300'}`}
            >
              <Clock size={14} /> History
            </button>
            {/* زر تسجيل الخروج */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/50 text-slate-400
                         hover:bg-slate-700 hover:text-slate-300 rounded-lg text-xs font-medium transition-all"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>

        {/* ── Tab Bar ────────────────────────────────────────────────────── */}
        <div className="flex gap-1.5 p-1.5 bg-slate-800/60 rounded-xl border border-slate-700/50 mb-6 flex-wrap">
          {TABS.map(tab => (
            <TabBtn
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              icon={tab.icon}
            >
              {tab.label}
            </TabBtn>
          ))}
        </div>

        {/* ── Panel Card ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/60 p-6">

          {/* عنوان ووصف التبويب الحالي */}
          {activeTab !== 'history' && (
            <div className="mb-5">
              <h2 className="text-lg font-bold text-white">{TAB_TITLES[activeTab]}</h2>
              <p className="text-slate-400 text-xs mt-1">{TAB_DESCRIPTIONS[activeTab]}</p>
            </div>
          )}

          {/* ── Panels ──────────────────────────────────────────────────── */}

          {/* تشفير ملفات .txt */}
          {activeTab === 'file'     && <TextFileCryptoPanel  user={user} />}

          {/* تشفير نص مباشر */}
          {activeTab === 'textarea' && <TextAreaCryptoPanel  user={user} />}

          {/* تشفير صور 2D — forcedDimension="2d" يقفل الـ panel على وضع 2D */}
          {activeTab === 'image'    && <ImageCryptoPanel user={user} forcedDimension="2d" />}

          {/* تشفير نماذج 3D — forcedDimension="3d" يقفل الـ panel على وضع 3D */}
          {activeTab === 'model'    && <ImageCryptoPanel user={user} forcedDimension="3d" />}

          {/* تشفير ملفات CSV/XLSX */}
          {activeTab === 'dataset'  && <DatasetCryptoPanel  user={user} />}

          {/* سجل العمليات — يتحقق من PIN أولاً */}
          {activeTab === 'history'  && (
            user.historyPin && !historyUnlocked
              ? <HistoryLock user={user} onUnlock={() => setHistoryUnlocked(true)} />
              : <HistoryPanel user={user} />
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          MTI University · AES-256-GCM · PBKDF2-SHA256
        </p>
      </div>
    </div>
  );
};

export default EncryptionSystem;
