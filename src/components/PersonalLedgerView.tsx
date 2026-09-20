import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { collection, onSnapshot, query, orderBy, where, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { Debt, Expense } from '../types';
import { format, isToday, isThisMonth, isThisYear, parseISO } from 'date-fns';
import { 
  Plus, 
  Search, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Wallet, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Folder, 
  Info, 
  TrendingUp,
  RotateCcw,
  BookOpen
} from 'lucide-react';
import toast from 'react-hot-toast';

export function PersonalLedgerView() {
  const [activeSubTab, setActiveSubTab] = useState<'loans' | 'expenses'>('loans');
  
  // States for debts (loans given)
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtSearch, setDebtSearch] = useState('');
  const [debtFilter, setDebtFilter] = useState<'all' | 'pending' | 'paid'>('all');
  
  // Use state for new debt form
  const [borrowerName, setBorrowerName] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDesc, setDebtDesc] = useState('');
  const [isDebtSubmitting, setIsDebtSubmitting] = useState(false);

  // States for daily expenses
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('all');
  
  // Use state for new expense form
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('متفرق (Other)');
  const [isExpenseSubmitting, setIsExpenseSubmitting] = useState(false);

  // Categories lists
  const expenseCategories = [
    'راشن / گروسری (Grocery)',
    'کھانا پینا / چائے (Food/Drinks)',
    'بلز / بجلی، نیٹ، گیس (Utility Bills)',
    'پٹرول / سفری اخراجات (Fuel/Travel)',
    'اسٹاک / کاروباری لاگت (Stock/Business)',
    'بچوں کے تعلیمی اخراجات (Kids/Education)',
    'طبی / علاج معالجہ (Medical/Health)',
    'متفرق (Other)'
  ];

  // Load debts real-time subscription
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const isPrimaryAdmin = currentUser.email === 'noorullah03474763055@gmail.com' || currentUser.email === 'noorullah111111111@gmail.com';

    let qDebts;
    if (isPrimaryAdmin) {
      qDebts = query(collection(db, 'debts'), orderBy('createdAt', 'desc'));
    } else {
      qDebts = query(collection(db, 'debts'), where('userId', '==', currentUser.uid));
    }

    const unsub = onSnapshot(qDebts, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Debt));
      if (!isPrimaryAdmin) {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      } else {
        data = data.filter(d => !d.userId || d.userId === currentUser.uid);
      }
      setDebts(data);
    }, (error) => {
      console.error("Error reading debts:", error);
      toast.error("ادھار ڈیٹا لوڈ کرنے میں مسئلہ پیش آیا۔");
    });
    return () => unsub();
  }, []);

  // Load expenses real-time subscription
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const isPrimaryAdmin = currentUser.email === 'noorullah03474763055@gmail.com' || currentUser.email === 'noorullah111111111@gmail.com';

    let qExpenses;
    if (isPrimaryAdmin) {
      qExpenses = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
    } else {
      qExpenses = query(collection(db, 'expenses'), where('userId', '==', currentUser.uid));
    }

    const unsub = onSnapshot(qExpenses, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      if (!isPrimaryAdmin) {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      } else {
        data = data.filter(e => !e.userId || e.userId === currentUser.uid);
      }
      setExpenses(data);
    }, (error) => {
      console.error("Error reading expenses:", error);
      toast.error("اخراجات کا ڈیٹا لوڈ کرنے میں مسئلہ پیش آیا۔");
    });
    return () => unsub();
  }, []);

  // Auto-day and formatted date helper function (Urdu + English)
  const getFormattedDayAndDate = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      const urduDays = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
      const englishDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      const dayIndex = date.getDay();
      const urduDay = urduDays[dayIndex];
      const englishDay = englishDays[dayIndex];
      
      const formattedDate = format(date, 'dd-MMM-yyyy hh:mm a');
      return {
        urduDay,
        englishDay,
        formattedDate,
        display: `${formattedDate} (${urduDay} / ${englishDay})`
      };
    } catch (e) {
      return {
        urduDay: 'N/A',
        englishDay: 'N/A',
        formattedDate: dateStr,
        display: dateStr
      };
    }
  };

  // Add new Loan/Debt (Udhaar)
  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!borrowerName.trim()) {
      toast.error("براہ کرم ادھار لینے والے کا نام لکھیں");
      return;
    }
    const amountVal = parseFloat(debtAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error("براہ کرم درست رقم درج کریں");
      return;
    }

    setIsDebtSubmitting(true);
    try {
      await addDoc(collection(db, 'debts'), {
        borrowerName: borrowerName.trim(),
        amount: amountVal,
        description: debtDesc.trim(),
        isPaid: false,
        userId: auth.currentUser?.uid,
        createdAt: new Date().toISOString()
      });
      
      toast.success("ادھار کامیابی سے درج کر لیا گیا ہے اور دن/تاریخ خودکار سیٹ کر دی گئی ہے!");
      setBorrowerName('');
      setDebtAmount('');
      setDebtDesc('');
    } catch (err: any) {
      console.error(err);
      toast.error("ڈیٹا محفوظ کرنے میں ناکامی: " + err.message);
    } finally {
      setIsDebtSubmitting(false);
    }
  };

  // Mark debt as Paid/Unpaid toggle
  const handleTogglePaidDebt = async (debt: Debt) => {
    try {
      await updateDoc(doc(db, 'debts', debt.id), {
        isPaid: !debt.isPaid
      });
      toast.success(debt.isPaid ? "ادھار دوبارہ بقایا مارک کر دیا گیا" : "ادھار وصول شدہ (پیڈ) مارک کر دیا گیا!");
    } catch (err: any) {
      console.error(err);
      toast.error("اسٹیٹس تبدیل کرنے میں مسئلہ پیش آیا: " + err.message);
    }
  };

  // Delete debt record
  const handleDeleteDebt = async (id: string) => {
    if (!window.confirm("کیا آپ واقعی یہ ادھار ریکارڈ ڈیلیٹ کرنا چاہتے ہیں؟")) return;
    try {
      await deleteDoc(doc(db, 'debts', id));
      toast.success("ادھار ریکارڈ کامیابی سے ڈیلیٹ کر دیا گیا ہے");
    } catch (err: any) {
      console.error(err);
      toast.error("ڈیلیٹ کرنے میں مسئلہ پیش آیا");
    }
  };

  // Add new Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDesc.trim()) {
      toast.error("براہ کرم خرچ کی تفصیل یا آئٹم لکھیں");
      return;
    }
    const amountVal = parseFloat(expenseAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error("براہ کرم درست رقم درج کریں");
      return;
    }

    setIsExpenseSubmitting(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        description: expenseDesc.trim(),
        amount: amountVal,
        category: expenseCategory,
        userId: auth.currentUser?.uid,
        createdAt: new Date().toISOString()
      });

      toast.success("روزمرہ خرچہ کامیابی سے شامل کر لیا گیا!");
      setExpenseDesc('');
      setExpenseAmount('');
    } catch (err: any) {
      console.error(err);
      toast.error("خرچ درج کرنے میں مسئلہ پیش آیا: " + err.message);
    } finally {
      setIsExpenseSubmitting(false);
    }
  };

  // Delete Expense record
  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm("کیا آپ واقعی یہ خرچ کا ریکارڈ حذف کرنا چاہتے ہیں؟")) return;
    try {
      await deleteDoc(doc(db, 'expenses', id));
      toast.success("اخراجات کا ریکارڈ کامیابی سے حذف کر دیا گیا");
    } catch (err: any) {
      console.error(err);
      toast.error("حذف کرنے میں ناکامی");
    }
  };

  // Computations for Debts (Udhaar)
  const computedDebtsStats = useMemo(() => {
    let totalOutstanding = 0;
    let totalReceived = 0;
    
    debts.forEach(d => {
      if (d.isPaid) {
        totalReceived += d.amount;
      } else {
        totalOutstanding += d.amount;
      }
    });

    return {
      outstanding: totalOutstanding,
      received: totalReceived,
      total: totalOutstanding + totalReceived
    };
  }, [debts]);

  // Filtered Debts List
  const filteredDebts = useMemo(() => {
    return debts.filter(d => {
      const matchSearch = d.borrowerName.toLowerCase().includes(debtSearch.toLowerCase()) || 
                          (d.description && d.description.toLowerCase().includes(debtSearch.toLowerCase()));
      const matchFilter = debtFilter === 'all' || 
                          (debtFilter === 'paid' && d.isPaid) || 
                          (debtFilter === 'pending' && !d.isPaid);
      return matchSearch && matchFilter;
    });
  }, [debts, debtSearch, debtFilter]);

  // Computations for Expenses
  const computedExpensesStats = useMemo(() => {
    let today = 0;
    let month = 0;
    let year = 0;

    expenses.forEach(e => {
      try {
        const date = parseISO(e.createdAt);
        if (isToday(date)) today += e.amount;
        if (isThisMonth(date)) month += e.amount;
        if (isThisYear(date)) year += e.amount;
      } catch (err) {
        // Fallback calculation on date parse failures
      }
    });

    return { today, month, year };
  }, [expenses]);

  // Filtered Expenses List
  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      const matchSearch = e.description.toLowerCase().includes(expenseSearch.toLowerCase()) || 
                          e.category.toLowerCase().includes(expenseSearch.toLowerCase());
      const matchCat = expenseCategoryFilter === 'all' || e.category === expenseCategoryFilter;
      return matchSearch && matchCat;
    });
  }, [expenses, expenseSearch, expenseCategoryFilter]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-indigo-800 p-6 rounded-3xl text-white shadow-xl glow-card">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0 border border-white/20">
            <BookOpen className="w-6 h-6 text-indigo-200" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold font-sans">پرسنل کھاتہ و اخراجات</h2>
            <p className="text-xs sm:text-sm text-indigo-200 mt-1 font-medium">ذاتی لین دین، ادھار ریکارڈ اور روزمرہ گھریلو/ذاتی اخراجات محفوظ کیجیے</p>
          </div>
        </div>
        
        {/* Toggle between Loans & Expenses */}
        <div className="flex bg-indigo-950/40 p-1 rounded-2xl border border-white/10 self-start md:self-auto">
          <button
            onClick={() => setActiveSubTab('loans')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'loans' 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md' 
                : 'text-indigo-200 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            ادھار کھاتہ (Loans)
          </button>
          <button
            onClick={() => setActiveSubTab('expenses')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'expenses' 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md' 
                : 'text-indigo-200 hover:text-white'
            }`}
          >
            <Wallet className="w-4 h-4" />
            روزمرہ اخراجات (Daily Expenses)
          </button>
        </div>
      </div>

      {/* SECTION 1: DEBTS / LOANS (ادھار کھاتہ) */}
      {activeSubTab === 'loans' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Side */}
          <div className="lg:col-span-1 space-y-6">
            {/* Quick Stats overview */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm text-right">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500">بقایا ادھار (Outstanding)</span>
                  <div className="bg-amber-50 p-1.5 rounded-lg text-amber-600"><ArrowUpRight className="w-4 h-4" /></div>
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-950 mt-2 font-mono">Rs {computedDebtsStats.outstanding.toLocaleString()}</h3>
                <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full mt-1 inline-block">عوام سے لینا ہے</span>
              </div>
              <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm text-right">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500">وصول شدہ (Paid)</span>
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600"><CheckCircle2 className="w-4 h-4" /></div>
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-950 mt-2 font-mono">Rs {computedDebtsStats.received.toLocaleString()}</h3>
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full mt-1 inline-block">واپس آ چکے ہیں</span>
              </div>
            </div>

            {/* General total */}
            <div className="bg-slate-900 text-white p-4 rounded-3xl shadow-sm text-right">
              <p className="text-xs text-slate-400 font-medium">کل ادھار ریکارڈ شدہ (Total Loan Amount)</p>
              <h3 className="text-2xl font-extrabold mt-1 font-mono">Rs {computedDebtsStats.total.toLocaleString()}</h3>
            </div>

            {/* Form */}
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-md sm:text-lg font-bold text-slate-900 border-b border-slate-50 pb-3 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-600" />
                نیا ادھار شامل کریں
              </h3>
              
              <form onSubmit={handleAddDebt} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">نام (گاہک یا دوست کا نام) *</label>
                  <input
                    type="text"
                    required
                    value={borrowerName}
                    onChange={(e) => setBorrowerName(e.target.value)}
                    placeholder="مثلاً: احمد رشید"
                    className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">ادھار کی رقم (روپے میں) *</label>
                  <input
                    type="number"
                    required
                    value={debtAmount}
                    onChange={(e) => setDebtAmount(e.target.value)}
                    placeholder="رقم لکھیں"
                    className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-sm font-mono focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">وجہ / تفصیل (تفصیلی نوٹ) </label>
                  <textarea
                    rows={2}
                    value={debtDesc}
                    onChange={(e) => setDebtDesc(e.target.value)}
                    placeholder="آئٹم کا نام یا ادھار کی وجہ درج کریں (اختیاری)"
                    className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all placeholder:text-slate-400 resize-none"
                  />
                </div>

                <p className="text-[10px] text-slate-500 italic bg-slate-50 p-2.5 rounded-xl flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  تاریخ اور دن خود بخود اس لمحے کے مطابق محفوظ کر لیے جائیں گے یعنی آج کی معلومات۔
                </p>

                <button
                  type="submit"
                  disabled={isDebtSubmitting}
                  className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold py-3 px-4 rounded-2xl shadow-md hover:from-indigo-700 hover:to-indigo-800 transition-all disabled:opacity-50 active:scale-95 text-sm"
                >
                  {isDebtSubmitting ? 'رقم محفوظ ہو رہی ہے...' : 'محفوظ کریں (Save Udhaar)'}
                </button>
              </form>
            </div>
          </div>

          {/* List/Records Side */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="w-full md:w-1/2 relative">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                <input
                  type="text"
                  value={debtSearch}
                  onChange={(e) => setDebtSearch(e.target.value)}
                  placeholder="ادھار لینے والے کا نام یا تفصیل تلاش کریں..."
                  className="w-full pr-10 pl-4 py-2.5 rounded-2xl border border-slate-200 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all"
                />
              </div>

              {/* Filtering tabs */}
              <div className="flex bg-slate-50 p-1 border border-slate-100 rounded-xl w-full md:w-auto shrink-0 justify-around">
                <button
                  onClick={() => setDebtFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    debtFilter === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  کل ادھار ({debts.length})
                </button>
                <button
                  onClick={() => setDebtFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    debtFilter === 'pending' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  بقایا ({debts.filter(d => !d.isPaid).length})
                </button>
                <button
                  onClick={() => setDebtFilter('paid')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    debtFilter === 'paid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  وصول شدہ ({debts.filter(d => d.isPaid).length})
                </button>
              </div>
            </div>

            {/* List / Table */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                <h4 className="font-bold text-slate-900 text-sm">ادھار کی ہسٹری (Borrowers Ledger)</h4>
                <div className="text-xs text-slate-500 font-medium">{filteredDebts.length} ریکارڈز پائے گئے</div>
              </div>

              {filteredDebts.length === 0 ? (
                <div className="p-12 text-center text-slate-500 space-y-3">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium">کوئی ادھار کا ریکارڈ نہیں ملا۔</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right divide-y divide-slate-100">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-500 text-xs font-bold uppercase">
                        <th className="p-4">شخص کا نام</th>
                        <th className="p-4">رقم (روپے)</th>
                        <th className="p-4">وجہ / نوٹ</th>
                        <th className="p-4">تاریخ اور دن (آٹومیٹک)</th>
                        <th className="p-4 text-center">اسٹیٹس / عمل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDebts.map((item) => {
                        const { display } = getFormattedDayAndDate(item.createdAt);
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/50 transition-colors text-xs sm:text-sm">
                            <td className="p-4 font-bold text-slate-900">{item.borrowerName}</td>
                            <td className="p-4 font-mono font-bold text-slate-900">Rs {item.amount.toLocaleString()}</td>
                            <td className="p-4 text-slate-600 max-w-[160px] truncate" title={item.description}>{item.description || '—'}</td>
                            <td className="p-4 text-slate-500 text-xs">{display}</td>
                            <td className="p-4">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleTogglePaidDebt(item)}
                                  className={`px-2.5 py-1.5 rounded-xl font-bold text-[10px] sm:text-xs transition-colors flex items-center gap-1 shadow-xs border ${
                                    item.isPaid 
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/70' 
                                      : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100/70'
                                  }`}
                                  title={item.isPaid ? "پیسے دوبارہ بقایا سیٹ کریں" : "وصول شدہ مارک کریں"}
                                >
                                  {item.isPaid ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                      وصول شدہ (Paid)
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                      بقایا (Pending)
                                    </>
                                  )}
                                </button>
                                
                                <button
                                  onClick={() => handleDeleteDebt(item.id)}
                                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                  title="حذف کریں"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: DAILY EXPENSES (روزمرہ اخراجات) */}
      {activeSubTab === 'expenses' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form and info Side */}
          <div className="lg:col-span-1 space-y-6">
            {/* Quick stats categories */}
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-md sm:text-lg font-bold text-slate-900 pb-2 border-b border-slate-50 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-600" />
                اخراجات کے خلاصے (Stats)
              </h3>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3.5 bg-rose-50/50 border border-rose-100/50 rounded-2xl">
                  <div>
                    <p className="text-xs font-bold text-slate-500">آج کا خرچہ (Today)</p>
                    <h4 className="text-lg font-extrabold text-slate-900 mt-1 font-mono">Rs {computedExpensesStats.today.toLocaleString()}</h4>
                  </div>
                  <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center shrink-0 border border-rose-100"><ArrowDownLeft className="w-5 h-5" /></div>
                </div>

                <div className="flex justify-between items-center p-3.5 bg-indigo-50/50 border border-indigo-100/50 rounded-2xl">
                  <div>
                    <p className="text-xs font-bold text-slate-500">حالیہ مہینے کا خرچہ ({format(new Date(), 'MMMM')})</p>
                    <h4 className="text-lg font-extrabold text-slate-900 mt-1 font-mono">Rs {computedExpensesStats.month.toLocaleString()}</h4>
                  </div>
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100"><Calendar className="w-5 h-5" /></div>
                </div>

                <div className="flex justify-between items-center p-3.5 bg-slate-100/50 border border-slate-200/50 rounded-2xl">
                  <div>
                    <p className="text-xs font-bold text-slate-500">پورے سال کا خرچہ ({format(new Date(), 'yyyy')})</p>
                    <h4 className="text-lg font-extrabold text-slate-900 mt-1 font-mono">Rs {computedExpensesStats.year.toLocaleString()}</h4>
                  </div>
                  <div className="w-10 h-10 bg-slate-150 text-slate-600 rounded-xl flex items-center justify-center shrink-0 border border-slate-200"><TrendingUp className="w-5 h-5" /></div>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-md sm:text-lg font-bold text-slate-900 border-b border-slate-50 pb-3 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-600" />
                روزمرہ خرچہ شامل کریں
              </h3>
              
              <form onSubmit={handleAddExpense} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">خرچ کا آئٹم / تفصیل *</label>
                  <input
                    type="text"
                    required
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                    placeholder="مثلاً: دکان کیلئے بجلی بل، پھل، کار کا ایندھن"
                    className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-right">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">خرچ رقم (روپے) *</label>
                    <input
                      type="number"
                      required
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="رقم درج کریں"
                      className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-sm font-mono focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">اخراجات کا زمرہ (Category) *</label>
                    <select
                      value={expenseCategory}
                      onChange={(e) => setExpenseCategory(e.target.value)}
                      className="w-full text-right p-3 rounded-2xl border border-slate-200 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all"
                    >
                      {expenseCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 italic bg-rose-50/30 p-2.5 rounded-xl border border-rose-50 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  اس خرچ کا دن اور حقیقی ٹائم خودکار طور پر الگورڈم کے ذریعے معلوم کر لیا جائے گا۔
                </p>

                <button
                  type="submit"
                  disabled={isExpenseSubmitting}
                  className="w-full bg-gradient-to-r from-rose-600 to-rose-700 text-white font-bold py-3 px-4 rounded-2xl shadow-md hover:from-rose-700 hover:to-rose-800 transition-all disabled:opacity-50 active:scale-95 text-sm"
                >
                  {isExpenseSubmitting ? 'اندازاً رقم محفوظ ہو رہی ہے...' : 'خرچہ محفوظ کریں (Save Expense)'}
                </button>
              </form>
            </div>
          </div>

          {/* List and searches Side */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="w-full md:w-1/2 relative">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                <input
                  type="text"
                  value={expenseSearch}
                  onChange={(e) => setExpenseSearch(e.target.value)}
                  placeholder="خرچ کی نوعیت یا تفصیل تلاش کریں..."
                  className="w-full pr-10 pl-4 py-2.5 rounded-2xl border border-slate-200 text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all"
                />
              </div>

              {/* Filtering Category dropdown */}
              <div className="w-full md:w-auto shrink-0 flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 shrink-0">زمرہ فلٹر:</span>
                <select
                  value={expenseCategoryFilter}
                  onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                  className="w-full md:w-48 text-right p-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50"
                >
                  <option value="all">تمام زمرے (All Categories)</option>
                  {expenseCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* List Table of expenses */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                <h4 className="font-bold text-slate-900 text-sm">تفصیلی روزانہ خرچے ہسٹری (Daily Expense Logs)</h4>
                <div className="text-xs text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-full">{filteredExpenses.length} اخراجات درج ہیں</div>
              </div>

              {filteredExpenses.length === 0 ? (
                <div className="p-12 text-center text-slate-500 space-y-3">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
                    <Wallet className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium">کوئی اخراجات کا ریکارڈ نہیں ملا۔</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right divide-y divide-slate-100">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-500 text-xs font-bold uppercase">
                        <th className="p-4">تفصیل / آئٹم</th>
                        <th className="p-4">خرچ کی رقم</th>
                        <th className="p-4">زمرہ / کٹیگری</th>
                        <th className="p-4">تاریخ اور دن</th>
                        <th className="p-4 text-center">حمل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredExpenses.map((e) => {
                        const { display } = getFormattedDayAndDate(e.createdAt);
                        return (
                          <tr key={e.id} className="hover:bg-slate-50/50 transition-colors text-xs sm:text-sm">
                            <td className="p-4 font-bold text-slate-900">{e.description}</td>
                            <td className="p-4 font-mono font-bold text-rose-600">Rs {e.amount.toLocaleString()}</td>
                            <td className="p-4">
                              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-700 bg-slate-100 p-1 px-2.5 rounded-full">
                                <Folder className="w-3 h-3 text-slate-400" />
                                {e.category}
                              </span>
                            </td>
                            <td className="p-4 text-slate-500 text-xs">{display}</td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => handleDeleteExpense(e.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                title="حذف کریں"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
