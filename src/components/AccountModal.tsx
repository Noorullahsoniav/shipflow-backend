import React from 'react';
import { User } from 'firebase/auth';
import { LogOut, RefreshCw, X, ShieldCheck, User as UserIcon, Mail, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  role: string | null;
  onLogout: () => void;
  onSwitchAccount: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  user,
  role,
  onLogout,
  onSwitchAccount,
}) => {
  if (!isOpen || !user) return null;

  const isAdmin = user.email === 'noorullah03474763055@gmail.com' || user.email === 'noorullah111111111@gmail.com' || role === 'admin';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden text-right"
          dir="rtl"
        >
          {/* HEADER */}
          <div className="bg-gradient-to-l from-indigo-600 to-indigo-700 p-5 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
                <UserIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold">اکاؤنٹ مینجمنٹ</h3>
                <p className="text-xs text-indigo-100 font-medium">اکاؤنٹ تبدیل کریں یا لاگ آؤٹ کریں</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* USER INFO BODY */}
          <div className="p-6 space-y-5">
            <div className="flex flex-col items-center text-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="relative mb-3">
                <img
                  src={user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120'}
                  alt={user.displayName || 'صارف'}
                  className="w-20 h-20 rounded-full border-4 border-white shadow-md object-cover"
                />
                <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white text-[10px]">
                  ✓
                </span>
              </div>

              <h4 className="text-lg font-bold text-gray-900 mb-0.5">
                {user.displayName || 'نامعلوم صارف'}
              </h4>

              <p className="text-xs text-gray-500 font-mono mb-2.5 flex items-center justify-center gap-1.5" dir="ltr">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                <span>{user.email}</span>
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-extrabold rounded-full border border-indigo-200">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ایڈمن اکاؤنٹ (Full Admin)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>منظور شدہ صارف (Active User)</span>
                  </span>
                )}
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="space-y-3">
              {/* SWITCH ACCOUNT BUTTON */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchAccount();
                }}
                className="w-full p-4 rounded-2xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-900 transition-all flex items-center justify-between group cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-sm">
                    <ArrowRightLeft className="w-5 h-5" />
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-indigo-950 flex items-center gap-1.5">
                      <span>دوسرا گوگل اکاؤنٹ منتخب کریں</span>
                      <span className="text-[10px] bg-indigo-200 text-indigo-800 px-1.5 py-0.2 rounded font-bold">Switch</span>
                    </div>
                    <p className="text-xs text-indigo-700/80 mt-0.5">
                      کسی دوسرے جی میل اکاؤنٹ سے لاگ ان کریں
                    </p>
                  </div>
                </div>
                <RefreshCw className="w-4 h-4 text-indigo-600 group-hover:rotate-180 transition-transform duration-500 shrink-0" />
              </button>

              {/* LOGOUT BUTTON */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full p-4 rounded-2xl bg-red-50 hover:bg-red-100 border border-red-200/80 text-red-900 transition-all flex items-center justify-between group cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-sm">
                    <LogOut className="w-5 h-5" />
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-red-950">
                      اکاؤنٹ لاگ آؤٹ کریں
                    </div>
                    <p className="text-xs text-red-700/80 mt-0.5">
                      موجودہ سیشن ختم کر کے لاگ ان اسکرین پر جائیں
                    </p>
                  </div>
                </div>
                <LogOut className="w-4 h-4 text-red-600 group-hover:-translate-x-1 transition-transform shrink-0" />
              </button>
            </div>
          </div>

          {/* FOOTER */}
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-xs cursor-pointer transition-colors shadow-2xs"
            >
              بند کریں
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
