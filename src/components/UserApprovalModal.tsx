import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { AppUser } from '../types';
import { 
  X, 
  Users, 
  UserCheck, 
  UserX, 
  Clock, 
  Search, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  ShieldCheck,
  User,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';

interface UserApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAdminEmail?: string;
}

export function UserApprovalModal({ isOpen, onClose, currentAdminEmail }: UserApprovalModalProps) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [loading, setLoading] = useState(true);

  const getUserStatus = (u: AppUser): 'approved' | 'pending' | 'rejected' => {
    const isAdminUser = u.email === 'noorullah03474763055@gmail.com' || u.email === 'noorullah111111111@gmail.com' || u.role === 'admin';
    if (isAdminUser) return 'approved';
    if (u.status === 'approved') return 'approved';
    if (u.status === 'rejected') return 'rejected';
    return 'pending';
  };

  useEffect(() => {
    if (!isOpen) return;

    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const isAdminUser = data.email === 'noorullah03474763055@gmail.com' || data.email === 'noorullah111111111@gmail.com' || data.role === 'admin';
        if (!data.status) {
          const defaultStatus = isAdminUser ? 'approved' : 'pending';
          setDoc(doc(db, 'users', docSnap.id), { status: defaultStatus }, { merge: true }).catch(console.warn);
        }
        return {
          uid: docSnap.id,
          ...data,
          status: data.status || (isAdminUser ? 'approved' : 'pending')
        } as AppUser;
      });

      // Sort pending first, then by date
      list.sort((a, b) => {
        const statusA = getUserStatus(a);
        const statusB = getUserStatus(b);
        if (statusA === 'pending' && statusB !== 'pending') return -1;
        if (statusA !== 'pending' && statusB === 'pending') return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      setUsers(list);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching users:', error);
      toast.error('صارفین کا ڈیٹا لوڈ کرنے میں ناکامی');
      setLoading(false);
    });

    return () => unsub();
  }, [isOpen]);

  const handleUpdateStatus = async (uid: string, newStatus: 'approved' | 'rejected', email: string) => {
    try {
      await setDoc(doc(db, 'users', uid), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      if (newStatus === 'approved') {
        toast.success(`صارف (${email}) کا اکاؤنٹ منظور کر دیا گیا`);
      } else {
        toast.error(`صارف (${email}) کا اکاؤنٹ مسترد کر دیا گیا`);
      }
    } catch (error) {
      console.error('Failed to update status:', error);
      toast.error('اسٹیٹس تبدیل کرنے میں مسئلہ آیا');
    }
  };

  const handleDeleteUser = async (uid: string, email: string) => {
    if (!window.confirm(`کیا آپ واقعی صارف (${email}) کی درخواست کو حذف کرنا چاہتے ہیں؟`)) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      toast.success('صارف ریکارڈ حذف کر دیا گیا');
    } catch (error) {
      console.error('Failed to delete user:', error);
      toast.error('حذف کرنے میں ناکامی');
    }
  };

  if (!isOpen) return null;

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const uStat = getUserStatus(u);
    if (filterStatus === 'all') return matchesSearch;
    if (filterStatus === 'pending') return matchesSearch && uStat === 'pending';
    if (filterStatus === 'approved') return matchesSearch && uStat === 'approved';
    if (filterStatus === 'rejected') return matchesSearch && uStat === 'rejected';
    return matchesSearch;
  });

  const pendingCount = users.filter(u => getUserStatus(u) === 'pending').length;
  const approvedCount = users.filter(u => getUserStatus(u) === 'approved').length;
  const rejectedCount = users.filter(u => getUserStatus(u) === 'rejected').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs dir-rtl text-right overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100 my-8"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 flex items-center justify-between border-b border-indigo-900/50">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-indigo-300">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">صارفین کی منظوری کا نظام</h2>
                {pendingCount > 0 && (
                  <span className="bg-amber-500 text-slate-950 text-xs font-black px-2.5 py-0.5 rounded-full animate-bounce">
                    {pendingCount} نیا
                  </span>
                )}
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">نئے صارفین کو ایپ کے استعمال کی اجازت دیں یا مسترد کریں</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 bg-slate-50/50">
          {/* Stats Bar */}
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-5">
            <button
              onClick={() => setFilterStatus('all')}
              className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                filterStatus === 'all' 
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' 
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-semibold">کل (All)</div>
              <div className="text-lg font-black mt-0.5">{users.length}</div>
            </button>

            <button
              onClick={() => setFilterStatus('pending')}
              className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                filterStatus === 'pending' 
                  ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200' 
                  : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50/50'
              }`}
            >
              <div className="text-xs font-semibold flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" />
                زیر التوا
              </div>
              <div className="text-lg font-black mt-0.5">{pendingCount}</div>
            </button>

            <button
              onClick={() => setFilterStatus('approved')}
              className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                filterStatus === 'approved' 
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200' 
                  : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50/50'
              }`}
            >
              <div className="text-xs font-semibold flex items-center justify-center gap-1">
                <UserCheck className="w-3 h-3" />
                منظور شدہ
              </div>
              <div className="text-lg font-black mt-0.5">{approvedCount}</div>
            </button>

            <button
              onClick={() => setFilterStatus('rejected')}
              className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                filterStatus === 'rejected' 
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-200' 
                  : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50/50'
              }`}
            >
              <div className="text-xs font-semibold flex items-center justify-center gap-1">
                <UserX className="w-3 h-3" />
                مسترد شدہ
              </div>
              <div className="text-lg font-black mt-0.5">{rejectedCount}</div>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative mb-5">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
            <input 
              type="text"
              placeholder="نام یا ای میل کے ذریعے تلاش کریں..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>

          {/* User List */}
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs">ڈیٹا لوڈ ہو رہا ہے...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 p-6">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-600">کوئی صارف نہیں ملا</p>
              <p className="text-xs text-slate-400 mt-1">منتخب شدہ فلٹر یا سرچ کے مطابق کوئی ریکارڑ موجود نہیں ہے۔</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pl-1">
              {filteredUsers.map((u) => {
                const isAdminUser = u.email === 'noorullah03474763055@gmail.com' || u.email === 'noorullah111111111@gmail.com' || u.role === 'admin';
                const uStat = getUserStatus(u);
                const isPending = uStat === 'pending';
                const isApproved = uStat === 'approved';
                const isRejected = uStat === 'rejected';

                return (
                  <div 
                    key={u.uid}
                    className={`bg-white p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs ${
                      isPending ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {u.photoURL ? (
                        <img src={u.photoURL} alt={u.displayName || 'User'} className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0 font-bold">
                          {u.displayName ? u.displayName.charAt(0).toUpperCase() : <User className="w-5 h-5" />}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm truncate">
                            {u.displayName || 'نامعلوم صارف'}
                          </span>
                          {isAdminUser && (
                            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" />
                              مین ایڈمن
                            </span>
                          )}
                          {isPending && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1 animate-pulse">
                              <Clock className="w-3 h-3" />
                              زیر التوا
                            </span>
                          )}
                          {isApproved && !isAdminUser && (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              منظور شدہ
                            </span>
                          )}
                          {isRejected && (
                            <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-rose-200 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              مسترد شدہ
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-500 truncate dir-ltr text-right mt-0.5 font-mono">{u.email}</p>
                        {u.createdAt && (
                          <p className="text-[10px] text-slate-400 mt-1">
                            لاگ ان کی تاریخ: {new Date(u.createdAt).toLocaleDateString('ur-PK', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {!isAdminUser && (
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                        {isPending && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(u.uid, 'approved', u.email)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              منظور کریں
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(u.uid, 'rejected', u.email)}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              مسترد کریں
                            </button>
                          </>
                        )}

                        {isApproved && (
                          <button
                            onClick={() => handleUpdateStatus(u.uid, 'rejected', u.email)}
                            className="bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                          >
                            <UserX className="w-3.5 h-3.5 text-amber-600" />
                            مسترد کریں
                          </button>
                        )}

                        {isRejected && (
                          <button
                            onClick={() => handleUpdateStatus(u.uid, 'approved', u.email)}
                            className="bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                            منظور کریں
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteUser(u.uid, u.email)}
                          title="حذف کریں"
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AlertCircle className="w-4 h-4 text-indigo-600" />
            <span>منظور شدہ صارفین اپنے گوگل اکاؤنٹ سے الگ الگ ڈیٹا استعمال کر سکیں گے۔</span>
          </div>
          <button
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors"
          >
            بند کریں
          </button>
        </div>
      </motion.div>
    </div>
  );
}
