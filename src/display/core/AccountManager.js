// =============================================================================
// AccountManager.js — إدارة حسابات المستخدمين والجلسات
// =============================================================================
// هذه الـ class مسؤولة عن:
//   1. حفظ بيانات المستخدمين في localStorage (بجانب Firebase)
//   2. إدارة الجلسة النشطة (تسجيل دخول / خروج)
//   3. تغيير كلمة السر
//
// ملاحظة: المصادقة الحقيقية تتم عبر Firebase. هذه الـ class تحفظ
// بيانات الجلسة المحلية (الاسم، البريد، historyPin) فقط.
// =============================================================================

class AccountManager {

  // ---------------------------------------------------------------------------
  // مفاتيح localStorage
  // ---------------------------------------------------------------------------
  static ACCOUNTS_KEY = 'encryptionSystemAccounts'; // قائمة الحسابات
  static USER_KEY     = 'encryptionSystemLoggedInUser'; // الجلسة النشطة

  // ---------------------------------------------------------------------------
  // دوال خاصة للقراءة والكتابة في localStorage
  // ---------------------------------------------------------------------------

  /**
   * يقرأ قيمة من localStorage ويحوّلها من JSON.
   * إذا فشل أو كانت فارغة، يُعيد القيمة الافتراضية.
   * @private
   */
  static #read(key, fallback) {
    try {
      const r = localStorage.getItem(key);
      return r ? JSON.parse(r) : fallback;
    } catch {
      return fallback; // في حالة الخطأ (مثلاً JSON تالف)
    }
  }

  /**
   * يكتب قيمة في localStorage بعد تحويلها إلى JSON.
   * @private
   */
  static #write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Could not save ${key}`, e);
    }
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  constructor() {
    // عند إنشاء instance، نقرأ قائمة الحسابات المحفوظة
    this.accounts = AccountManager.#read(AccountManager.ACCOUNTS_KEY, []);
  }

  /** يحفظ قائمة الحسابات الحالية في localStorage @private */
  #save() {
    AccountManager.#write(AccountManager.ACCOUNTS_KEY, this.accounts);
  }

  // ---------------------------------------------------------------------------
  // find — البحث عن حساب بالإيميل
  // ---------------------------------------------------------------------------
  /**
   * @param {string} email
   * @returns {Object|null} الحساب أو null إذا لم يوجد
   */
  find({ email }) {
    return this.accounts.find(a => a.email === email) || null;
  }

  // ---------------------------------------------------------------------------
  // register — تسجيل حساب جديد
  // ---------------------------------------------------------------------------
  /**
   * يُضيف حساباً جديداً للقائمة المحلية.
   * (المصادقة الفعلية تتم عبر Firebase registerWithEmail)
   *
   * @param {string} name
   * @param {string} email
   * @param {string} password
   * @param {string} historyPin - PIN اختياري لقفل سجل العمليات
   * @throws إذا كانت الحقول ناقصة أو الإيميل مستخدم مسبقاً
   */
  register({ name, email, password, historyPin = '' }) {
    if (!name || !email || !password)
      throw new Error('Please fill in all fields.');
    if (this.accounts.some(a => a.email === email))
      throw new Error('An account with this email already exists.');

    const account = { name, email, password, historyPin };
    this.accounts.push(account);
    this.#save();
    return account;
  }

  // ---------------------------------------------------------------------------
  // login — التحقق من بيانات الدخول
  // ---------------------------------------------------------------------------
  /**
   * يتحقق من الإيميل وكلمة السر في القائمة المحلية.
   * (المصادقة الفعلية تتم عبر Firebase loginWithEmail)
   *
   * @throws إذا كانت البيانات خاطئة
   */
  login({ email, password }) {
    const account = this.accounts.find(
      a => a.email === email && a.password === password
    );
    if (!account) throw new Error('Invalid email or password.');
    return { email: account.email, name: account.name, historyPin: account.historyPin };
  }

  // ---------------------------------------------------------------------------
  // changePassword — تغيير كلمة السر
  // ---------------------------------------------------------------------------
  /**
   * يغيّر كلمة السر بعد التحقق من القديمة.
   * @throws إذا كانت كلمة السر القديمة خاطئة
   */
  changePassword({ email, oldPassword, newPassword }) {
    const idx = this.accounts.findIndex(a => a.email === email);
    if (idx < 0) throw new Error('User account not found.');
    if (this.accounts[idx].password !== oldPassword)
      throw new Error('Incorrect old password.');
    this.accounts[idx].password = newPassword;
    this.#save();
  }

  // ---------------------------------------------------------------------------
  // Session Management — إدارة الجلسة
  // ---------------------------------------------------------------------------

  /** يحفظ بيانات المستخدم في localStorage كجلسة نشطة */
  persistSession({ user }) {
    AccountManager.#write(AccountManager.USER_KEY, user);
  }

  /** يمسح الجلسة النشطة (عند تسجيل الخروج) */
  clearSession() {
    localStorage.removeItem(AccountManager.USER_KEY);
  }

  /** يقرأ الجلسة النشطة (لاستعادة الجلسة عند إعادة فتح التطبيق) */
  getSession() {
    return AccountManager.#read(AccountManager.USER_KEY, null);
  }
}

export default AccountManager;
