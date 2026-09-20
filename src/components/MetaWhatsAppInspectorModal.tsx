import React, { useState } from 'react';
import { MetaSendResult } from '../lib/metaWhatsapp';
import { X, Copy, Check, ExternalLink, RefreshCw, AlertCircle, CheckCircle2, Terminal, Code2, ListFilter } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  inspectResult: MetaSendResult | null;
  logs: MetaSendResult[];
  onRetryTemplate?: (phone: string) => void;
  onOpenDirectWeb?: (phone: string) => void;
}

export const MetaWhatsAppInspectorModal: React.FC<Props> = ({
  isOpen,
  onClose,
  inspectResult,
  logs,
  onRetryTemplate,
  onOpenDirectWeb,
}) => {
  const [activeTab, setActiveTab] = useState<'latest' | 'history'>('latest');
  const [selectedLog, setSelectedLog] = useState<MetaSendResult | null>(inspectResult);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentResult = selectedLog || inspectResult || logs[logs.length - 1] || null;

  const handleCopyJson = (data: any) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      toast.success('JSON کاپی ہو گیا!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('کاپی نہیں ہو سکا');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-gray-200" dir="rtl">
        
        {/* HEADER */}
        <div className="px-5 py-4 bg-gray-900 text-white flex items-center justify-between border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                Meta WhatsApp Cloud API لائیو انسپیکٹر
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30">
                  Graph API v20.0
                </span>
              </h3>
              <p className="text-xs text-gray-400">میٹا سرورز کا حقیقی ریسپونس اور تکنیکی تفصیلات</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SUB-HEADER TABS */}
        <div className="px-5 py-2.5 bg-gray-100 border-b flex items-center justify-between text-xs font-bold">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setActiveTab('latest'); setSelectedLog(inspectResult); }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'latest' 
                  ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200 font-bold' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              حالیہ میسج ریسپونس
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'history' 
                  ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200 font-bold' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              میسجنگ ہسٹری لاگز ({logs.length})
            </button>
          </div>
          <span className="text-[11px] text-gray-500 font-normal">
            کل لاگز: {logs.length}
          </span>
        </div>

        {/* CONTENT BODY */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'latest' && (
            <>
              {!currentResult ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  کوئی ریسپونس ڈیٹا موجود نہیں ہے۔ پہلے واٹس ایپ میسج بھیجیں یا ٹیسٹ کریں۔
                </div>
              ) : (
                <div className="space-y-4">
                  {/* STATUS BANNER */}
                  <div className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
                    currentResult.success 
                      ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950' 
                      : 'bg-rose-50/90 border-rose-300 text-rose-950'
                  }`}>
                    <div className="flex items-start gap-3">
                      {currentResult.success ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm sm:text-base">
                            {currentResult.success 
                              ? 'میسج کامیابی سے واٹس ایپ سرور کو بھیج دیا گیا! 🎉' 
                              : 'میٹا واٹس ایپ سرور نے میسج مسترد کر دیا ❌'}
                          </h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            currentResult.httpStatus === 200 
                              ? 'bg-emerald-200 text-emerald-900' 
                              : 'bg-rose-200 text-rose-900'
                          }`}>
                            HTTP {currentResult.httpStatus || (currentResult.success ? 200 : 400)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed">
                          نمبر: <span className="font-mono font-bold" dir="ltr">{currentResult.recipientPhoneFormatted || 'N/A'}</span>
                          {currentResult.timestamp && <span className="mr-3 text-gray-500">| وقت: {currentResult.timestamp}</span>}
                        </p>
                      </div>
                    </div>

                    {currentResult.messageId && (
                      <div className="text-left shrink-0" dir="ltr">
                        <span className="text-[10px] text-emerald-800 font-bold block">Meta Message ID:</span>
                        <code className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-1 rounded font-mono block max-w-[180px] truncate">
                          {currentResult.messageId}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* URDU ADVICE BOX */}
                  {currentResult.urduAdvice && (
                    <div className={`p-4 rounded-xl border text-xs leading-relaxed space-y-1.5 ${
                      currentResult.success 
                        ? 'bg-emerald-100/60 border-emerald-200 text-emerald-900' 
                        : 'bg-amber-50 border-amber-300 text-amber-950'
                    }`}>
                      <p className="font-bold text-sm flex items-center gap-1.5">
                        <span>💡 آفیشل گائیڈ و تجزیہ:</span>
                      </p>
                      <p className="whitespace-pre-line text-xs">{currentResult.urduAdvice}</p>
                    </div>
                  )}

                  {/* RETRY & QUICK ACTIONS */}
                  {!currentResult.success && (
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-gray-700">متبادل حل کے اقدامات:</span>
                      <div className="flex items-center gap-2">
                        {onRetryTemplate && currentResult.recipientPhoneFormatted && (
                          <button
                            type="button"
                            onClick={() => onRetryTemplate(currentResult.recipientPhoneFormatted!)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-8 px-3 rounded-lg flex items-center transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5 ml-1" />
                            ٹیمپلیٹ موڈ (hello_world) سے دوبارہ کوشش کریں
                          </button>
                        )}
                        {onOpenDirectWeb && currentResult.recipientPhoneFormatted && (
                          <button
                            type="button"
                            onClick={() => onOpenDirectWeb(currentResult.recipientPhoneFormatted!)}
                            className="bg-white hover:bg-gray-100 text-gray-800 text-xs font-bold h-8 px-3 border border-gray-300 rounded-lg flex items-center transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 ml-1" />
                            دستی واٹس ایپ ڈائریکٹ کھولیں
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SENT REQUEST PAYLOAD */}
                  {currentResult.sentPayload && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                        <span>📤 ارسال کردہ Request Body (Payload JSON):</span>
                        <button
                          onClick={() => handleCopyJson(currentResult.sentPayload)}
                          className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          کاپ کریں
                        </button>
                      </div>
                      <pre className="bg-gray-900 text-emerald-400 p-3 rounded-xl text-[11px] font-mono overflow-x-auto text-left dir-ltr max-h-36">
                        {JSON.stringify(currentResult.sentPayload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* RECEIVED META RAW RESPONSE */}
                  {currentResult.rawResponse && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                        <span>📥 میٹا سرور سے موصول خام Response JSON:</span>
                        <button
                          onClick={() => handleCopyJson(currentResult.rawResponse)}
                          className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          کاپ کریں
                        </button>
                      </div>
                      <pre className="bg-gray-950 text-sky-300 p-3 rounded-xl text-[11px] font-mono overflow-x-auto text-left dir-ltr max-h-48 border border-gray-800">
                        {JSON.stringify(currentResult.rawResponse, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* HISTORY LOGS TAB */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              {logs.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-sm">
                  ابھی تک کوئی واٹس ایپ سیشن لاگ نہیں بنتا۔
                </div>
              ) : (
                <div className="divide-y divide-gray-200 border rounded-xl overflow-hidden bg-white">
                  {logs.slice().reverse().map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={() => { setSelectedLog(item); setActiveTab('latest'); }}
                      className={`p-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between transition-colors text-xs ${
                        selectedLog === item ? 'bg-emerald-50/80 border-r-4 border-r-emerald-600' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${item.success ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900" dir="ltr">{item.recipientPhoneFormatted}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              item.success ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {item.success ? 'SUCCESS' : `FAILED (${item.errorCode || 'ERR'})`}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-500">{item.timestamp}</span>
                        </div>
                      </div>

                      <div className="text-left flex items-center gap-2" dir="ltr">
                        {item.messageId ? (
                          <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 truncate max-w-[140px]">
                            {item.messageId}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 truncate max-w-[140px]">
                            {item.errorMessage || 'Meta Error'}
                          </span>
                        )}
                        <span className="text-indigo-600 hover:underline text-[11px] font-semibold">تفصیلات ↗</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between">
          <span className="text-xs text-gray-500">پاکستان پوسٹ واٹس ایپ ڈیش بورڈ v2.4</span>
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 text-xs font-bold rounded-lg transition-colors"
          >
            بند کریں (Close)
          </button>
        </div>

      </div>
    </div>
  );
};
