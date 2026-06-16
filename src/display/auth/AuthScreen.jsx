// =============================================================================
// AuthScreen.jsx — شاشة تسجيل الدخول والتسجيل
// =============================================================================
// هذا الـ component هو أول ما يراه المستخدم عند فتح التطبيق.
// يدعم 3 وضعيات:
//   1. login  — تسجيل دخول بإيميل + password
//   2. signup — إنشاء حساب جديد
//   3. forgot — إعادة تعيين كلمة السر
//
// طرق تسجيل الدخول المدعومة:
//   ✓ Email/Password (Firebase Authentication)
//   ✓ Google Sign In (Firebase OAuth)
//
// بعد نجاح أي عملية مصادقة:
//   → يُستدعى onLogin(user) لتمرير بيانات المستخدم للـ App الرئيسي
//   → يُخزّن الـ session في localStorage عبر AccountManager
// =============================================================================

import { useState } from 'react';
import { Lock, User, Mail, Eye, EyeOff, Shield, Clock } from 'lucide-react';
import { Notice } from '../components/UIComponents';
import { googleSignIn, registerWithEmail, loginWithEmail, resetPassword } from '../FirebaseAuth';

// (يُنشأ مرة واحدة خارج الـ component لتجنب إعادة الإنشاء عند كل render)
import AccountManager from '../core/AccountManager';
const accountManager = new AccountManager();

/**
 * @param {Function} onLogin - callback يُستدعى عند نجاح المصادقة مع بيانات المستخدم
 */
const AuthScreen = ({ onLogin }) => {

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState({
    name:       '',
    email:      '',
    password:   '',
    historyPin: '' // PIN اختياري لقفل سجل العمليات
  });
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [loading, setLoading]   = useState(false);

  // ---------------------------------------------------------------------------
  // handleSubmit — معالجة نموذج تسجيل الدخول/الإنشاء
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);

    try {
      let user;

      if (authMode === 'login') {
        // ── تسجيل الدخول ──
        // Firebase يتحقق من الإيميل وكلمة السر
        const firebaseUser = await loginWithEmail(form.email, form.password);
        user = {
          email:      firebaseUser.email,
          name:       firebaseUser.displayName || firebaseUser.email.split('@')[0],
          historyPin: ''
        };

      } else {
        // ── إنشاء حساب جديد ──
        // Firebase ينشئ الحساب ويُرسل email تحقق
        const firebaseUser = await registerWithEmail(form.name, form.email, form.password);
        user = {
          email:      firebaseUser.email,
          name:       form.name,
          historyPin: form.historyPin
        };
      }

      // حفظ الجلسة محلياً وإرسال البيانات للـ App
      accountManager.persistSession({ user });
      onLogin(user);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // handleForgotPassword — إعادة تعيين كلمة السر
  // ---------------------------------------------------------------------------
  const handleForgotPassword = async () => {
    setError(''); setSuccess('');
    if (!form.email) return setError('Please enter your email address first.');
    setLoading(true);
    try {
      // Firebase يُرسل رابط إعادة التعيين على الإيميل
      await resetPassword(form.email);
      setSuccess('Password reset link sent to your email!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // handleGoogleSignIn — تسجيل الدخول بـ Google
  // ---------------------------------------------------------------------------
  const handleGoogleSignIn = async () => {
    setError(''); setSuccess('');
    setLoading(true);
    try {
      // Firebase يفتح popup لاختيار حساب Google
      const { user, accessToken } = await googleSignIn();
      const updatedUser = { ...user, googleAccessToken: accessToken };
      accountManager.persistSession({ user: updatedUser });
      onLogin(updatedUser);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Helper: field — يبني حقل إدخال موحّد الشكل
  // ---------------------------------------------------------------------------
  const field = (key, label, type, icon, placeholder, extra = {}) => (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
      <div className="relative">
        {icon}
        <input
          type={type}
          value={form[key]}
          onChange={e => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 text-slate-200
                     rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm"
          {...extra}
        />
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // JSX — واجهة المستخدم
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/80 p-8">

          {/* Logo + العنوان */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl mb-4 shadow-lg shadow-cyan-900/50">
              <Shield className="text-white" size={30} />
            </div>
            <h1 className="text-3xl font-bold text-white mb-1">CipherVault</h1>
            <p className="text-slate-400 text-sm">AES-256 Encryption System</p>
          </div>

          {/* تبديل بين Login و Sign Up */}
          <div className="flex gap-2 mb-6">
            {['login', 'signup'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setAuthMode(m); setError(''); }}
                className={`flex-1 py-2.5 rounded-lg font-semibold capitalize text-sm transition-all
                  ${authMode === m
                    ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {m === 'login' ? 'Login' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* رسائل الخطأ والنجاح */}
          {error   && <Notice type="error">{error}</Notice>}
          {success && <Notice type="success">{success}</Notice>}

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">

            {/* حقل الاسم (فقط عند Sign Up) */}
            {authMode === 'signup' && field(
              'name', 'Full Name', 'text',
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />,
              'Enter your name', { required: true }
            )}

            {/* حقل الإيميل */}
            {field(
              'email', 'Email', 'email',
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />,
              'Enter email', { required: true }
            )}

            {/* حقل كلمة السر + رابط نسيت كلمة السر */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Enter password"
                  className="w-full pl-10 pr-12 py-3 bg-slate-900 border border-slate-600 text-slate-200
                             rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm"
                  required
                />
                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {/* رابط "Forgot Password" يظهر فقط في وضع Login */}
              {authMode === 'login' && (
                <div className="flex justify-end mt-1.5">
                  <button type="button" onClick={handleForgotPassword} className="text-xs text-cyan-500 hover:text-cyan-400 font-semibold transition-colors">
                    Forgot Password?
                  </button>
                </div>
              )}
            </div>

            {/* History PIN (فقط عند Sign Up — اختياري) */}
            {authMode === 'signup' && (
              <div className="pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-300">History PIN (Optional)</label>
                  <span className="text-[10px] text-cyan-500 uppercase tracking-wider font-bold">Privacy Layer</span>
                </div>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="password"
                    maxLength={6}
                    value={form.historyPin || ''}
                    onChange={e => setForm({ ...form, historyPin: e.target.value.replace(/\D/g, '') })}
                    placeholder="Set 4-6 digit history PIN"
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-600 text-cyan-400
                               rounded-lg focus:ring-2 focus:ring-cyan-500 focus:outline-none text-sm font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 italic">
                  Leave empty to access history directly without a PIN.
                </p>
              </div>
            )}

            {/* زر تسجيل الدخول/الإنشاء */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg
                         hover:from-cyan-500 hover:to-blue-500 font-semibold shadow-lg transition-all text-sm mt-2 disabled:opacity-50"
            >
              {loading ? 'Processing...' : (authMode === 'login' ? 'Login' : 'Create Account')}
            </button>

            {/* فاصل OR */}
            <div className="relative flex items-center justify-center mt-6">
              <div className="border-t border-slate-700 w-full absolute"></div>
              <span className="bg-slate-800/80 px-4 text-xs text-slate-400 relative z-10">OR</span>
            </div>

            {/* زر Google Sign In */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 py-3 rounded-lg
                         hover:bg-gray-100 font-semibold shadow-lg transition-all text-sm mt-4 border border-gray-200"
            >
              {/* Google Logo SVG */}
              <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            MTI University — Secure Multi-Dimensional Encryption
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
