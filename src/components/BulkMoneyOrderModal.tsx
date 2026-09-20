import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import { safeHtml2Canvas } from '../lib/html2canvasUtil';
import { Order, Settings } from '../types';
import { MoneyOrderCalibrator } from './MoneyOrderCalibrator';
import { 
  X, 
  FileText, 
  Download, 
  CheckCircle2, 
  Printer, 
  Sliders, 
  Plus, 
  Minus, 
  RefreshCw, 
  AlertCircle, 
  Check, 
  CheckSquare, 
  Square,
  Package,
  Layers
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatCurrency, splitMoneyOrderAmounts } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  selectedOrders: Set<string>;
  settings: Settings | null;
}

interface SplitMoneyOrderItem {
  order: Order;
  amount: number;
  partIndex: number;
  totalParts: number;
}

export const BulkMoneyOrderModal: React.FC<Props> = ({
  isOpen,
  onClose,
  orders,
  selectedOrders,
  settings,
}) => {
  // Mode: 'selected' (if selected exist) or 'all'
  const [targetScope, setTargetScope] = useState<'selected' | 'all'>(
    selectedOrders.size > 0 ? 'selected' : 'all'
  );
  
  // Status filter inside modal
  const [statusFilter, setStatusFilter] = useState<string>('All');
  
  // Custom selection IDs inside modal
  const [includedIds, setIncludedIds] = useState<Set<string>>(() => {
    if (selectedOrders.size > 0) {
      return new Set(selectedOrders);
    }
    return new Set(orders.map(o => o.id));
  });

  const [dataOnly, setDataOnly] = useState<boolean>(false);
  const [topOffset, setTopOffset] = useState<number>(0);
  const [leftOffset, setLeftOffset] = useState<number>(0);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // Compute filtered candidate orders
  const candidateOrders = useMemo(() => {
    let list = orders;
    if (targetScope === 'selected' && selectedOrders.size > 0) {
      list = orders.filter(o => selectedOrders.has(o.id));
    }
    if (statusFilter !== 'All') {
      list = list.filter(o => o.status === statusFilter);
    }
    return list;
  }, [orders, selectedOrders, targetScope, statusFilter]);

  // Orders that are currently checked
  const activeOrdersToDownload = useMemo(() => {
    return candidateOrders.filter(o => includedIds.has(o.id));
  }, [candidateOrders, includedIds]);

  // Split orders whose amount exceeds Rs. 20,000 into individual Money Order pages (max 20k per form)
  const allMoneyOrderPages: SplitMoneyOrderItem[] = useMemo(() => {
    const pages: SplitMoneyOrderItem[] = [];
    activeOrdersToDownload.forEach(order => {
      const parts = splitMoneyOrderAmounts(order.totalAmount, 20000);
      parts.forEach((amt, idx) => {
        pages.push({
          order,
          amount: amt,
          partIndex: idx,
          totalParts: parts.length
        });
      });
    });
    return pages;
  }, [activeOrdersToDownload]);

  if (!isOpen) return null;

  const toggleSelectAll = () => {
    if (activeOrdersToDownload.length === candidateOrders.length) {
      // Unselect all candidate orders
      setIncludedIds(prev => {
        const next = new Set(prev);
        candidateOrders.forEach(o => next.delete(o.id));
        return next;
      });
    } else {
      // Select all candidate orders
      setIncludedIds(prev => {
        const next = new Set(prev);
        candidateOrders.forEach(o => next.add(o.id));
        return next;
      });
    }
  };

  const toggleOrder = (id: string) => {
    setIncludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalAmount = activeOrdersToDownload.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const handleDownloadBulkPDF = async () => {
    if (allMoneyOrderPages.length === 0) {
      toast.error('براہ کرم منی آرڈر پرنٹ کے لیے کم از کم ایک آرڈر منتخب کریں۔');
      return;
    }

    setIsGenerating(true);
    setProgress({ current: 0, total: allMoneyOrderPages.length });
    const toastId = toast.loading(`بلک منی آرڈر PDF کی تیاری شروع ہو رہی ہے... (0 / ${allMoneyOrderPages.length})`);

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '210mm';
    container.style.height = '297mm';
    container.style.backgroundColor = '#ffffff';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-9999';
    document.body.appendChild(container);

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    try {
      for (let i = 0; i < allMoneyOrderPages.length; i++) {
        const currentNum = i + 1;
        const totalNum = allMoneyOrderPages.length;
        setProgress({ current: currentNum, total: totalNum });
        toast.loading(`منی آرڈر فارم ${currentNum} / ${totalNum} پروسیس ہو رہا ہے...`, { id: toastId });

        const pageItem = allMoneyOrderPages[i];
        
        const rootDiv = document.createElement('div');
        rootDiv.style.width = '210mm';
        rootDiv.style.height = '297mm';
        rootDiv.style.backgroundColor = '#ffffff';
        container.appendChild(rootDiv);

        const root = createRoot(rootDiv);

        await new Promise<void>((resolve) => {
          root.render(
            <MoneyOrderCalibrator
              order={pageItem.order}
              settings={settings}
              dataOnly={dataOnly}
              topOffset={topOffset}
              leftOffset={leftOffset}
              isCalibrating={false}
              customAmount={pageItem.amount}
              partIndex={pageItem.partIndex}
              totalParts={pageItem.totalParts}
            />
          );
          setTimeout(resolve, 500);
        });

        const targetEl = (rootDiv.firstElementChild as HTMLElement) || rootDiv;
        const canvas = await safeHtml2Canvas(targetEl, { 
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png', 0.95);

        if (i > 0) {
          pdf.addPage('a4', 'portrait');
        }

        pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');

        root.unmount();
        if (container.contains(rootDiv)) {
          container.removeChild(rootDiv);
        }
        canvas.width = 0;
        canvas.height = 0;

        // Yield to event loop to keep UI responsive
        await new Promise(r => setTimeout(r, 60));
      }

      const modeName = dataOnly ? 'DataOnly' : 'FullForm';
      const fileName = `PakistanPost_Bulk_MoneyOrders_${allMoneyOrderPages.length}_Forms_${activeOrdersToDownload.length}_Orders_${modeName}.pdf`;
      pdf.save(fileName);

      toast.success(`${allMoneyOrderPages.length} منی آرڈر صفحات (${activeOrdersToDownload.length} آرڈرز) کی PDF کامیابی سے ڈاؤنلوڈ ہو گئی! 🎉`, { id: toastId });
      onClose();
    } catch (error) {
      console.error('Bulk Money Order generation error:', error);
      toast.error('منی آرڈر PDF بنانے میں غلطی آئی۔ براہ کرم دوبارہ کوشش کریں۔', { id: toastId });
    } finally {
      setIsGenerating(false);
      setProgress(null);
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-200" dir="rtl">
        
        {/* HEADER */}
        <div className="px-5 py-4 bg-emerald-900 text-white flex items-center justify-between border-b border-emerald-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center shadow-inner">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                بلک منی آرڈر پرنٹ و ڈاؤنلوڈ
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 font-bold border border-emerald-400/30">
                  پاکستان پوسٹ COD
                </span>
              </h3>
              <p className="text-xs text-emerald-200/80">
                منتخب شدہ آرڈرز کے منی آرڈر ایک ساتھ A4 PDF میں پرنٹ / ڈاؤنلوڈ کریں
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            disabled={isGenerating}
            className="w-8 h-8 rounded-full bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* CONTROLS SECTION */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 bg-gray-50/50">
          
          {/* MAX LIMIT NOTICE */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-950">
            <Layers className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-emerald-900">ڈاکخانہ رول لاگو ہے (زیادہ سے زیادہ 20,000 روپے فی منی آرڈر):</span>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                کوئی بھی منی آرڈر 20,000 روپے سے اوپر پرنٹ نہیں ہوگا۔ 20,000 سے زائد رقم کے آرڈرز خودکار طریقے سے 20,000 اور بقایا رقم کے الگ الگ منی آرڈرز میں تقسیم ہو کر پرنٹ ہوں گے۔
              </p>
            </div>
          </div>

          {/* FORMAT & CALIBRATION CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            
            {/* PRINT MODE */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs space-y-2.5">
              <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-600" />
                پرنٹ کا طریقہ (Money Order Format):
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDataOnly(false)}
                  className={`p-2.5 rounded-lg border text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-1 ${
                    !dataOnly 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20' 
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-sm">📝 مکمل فارم</span>
                  <span className="text-[10px] font-normal text-gray-500">پس منظر + ڈیٹا (Blank Paper)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDataOnly(true)}
                  className={`p-2.5 rounded-lg border text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-1 ${
                    dataOnly 
                      ? 'bg-amber-50 border-amber-500 text-amber-900 ring-2 ring-amber-500/20' 
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-sm">🎯 صرف ڈیٹا</span>
                  <span className="text-[10px] font-normal text-gray-500">Pre-printed Form Alignment</span>
                </button>
              </div>
            </div>

            {/* PRINTER OFFSETS */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  پرنٹر الائنمنٹ آفسیٹ (Printer Alignment):
                </label>
                <span className="text-[10px] text-gray-400">ملی میٹر (mm)</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {/* TOP OFFSET */}
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">ٹاپ (Top):</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTopOffset(t => t - 1)}
                      className="w-6 h-6 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center justify-center font-bold text-xs"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-indigo-700 text-xs">
                      {topOffset > 0 ? `+${topOffset}` : topOffset}mm
                    </span>
                    <button
                      type="button"
                      onClick={() => setTopOffset(t => t + 1)}
                      className="w-6 h-6 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center justify-center font-bold text-xs"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* LEFT OFFSET */}
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">لیفٹ (Left):</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setLeftOffset(l => l - 1)}
                      className="w-6 h-6 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center justify-center font-bold text-xs"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-indigo-700 text-xs">
                      {leftOffset > 0 ? `+${leftOffset}` : leftOffset}mm
                    </span>
                    <button
                      type="button"
                      onClick={() => setLeftOffset(l => l + 1)}
                      className="w-6 h-6 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center justify-center font-bold text-xs"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* SCOPE & FILTER BAR */}
          <div className="bg-white p-3 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-700">آرڈرز کا انتخاب:</span>
              <button
                type="button"
                onClick={() => {
                  setTargetScope('selected');
                  if (selectedOrders.size > 0) {
                    setIncludedIds(new Set(selectedOrders));
                  }
                }}
                disabled={selectedOrders.size === 0}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  targetScope === 'selected'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40'
                }`}
              >
                صرف منتخب شدہ ({selectedOrders.size})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetScope('all');
                  setIncludedIds(new Set(orders.map(o => o.id)));
                }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  targetScope === 'all'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                تمام دکھائے گئے ({orders.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-700">اسٹیٹس فلٹر:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1 font-bold text-gray-800 text-xs focus:ring-2 focus:ring-emerald-500"
              >
                <option value="All">تمام اسٹیٹس</option>
                <option value="Packed">Packed (پیک ہو چکے)</option>
                <option value="Shipped">Shipped (ڈسپیچ)</option>
                <option value="Pending">Pending (پینڈنگ)</option>
                <option value="Delivered">Delivered (ڈیلیور)</option>
              </select>
            </div>
          </div>

          {/* ORDERS TABLE PREVIEW */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs flex flex-col">
            <div className="px-4 py-2.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between text-xs font-bold">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 transition-colors"
                >
                  {activeOrdersToDownload.length === candidateOrders.length && candidateOrders.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                  <span>سب کا انتخاب کریں ({activeOrdersToDownload.length} / {candidateOrders.length})</span>
                </button>
              </div>
              <div className="text-gray-600 font-normal">
                کل رقم: <span className="font-bold text-emerald-800 font-mono">{formatCurrency(totalAmount)}</span>
              </div>
            </div>

            {/* SCROLLABLE LIST */}
            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
              {candidateOrders.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs">
                  کوئی آرڈر اس معیار پر پورا نہیں اترتا۔
                </div>
              ) : (
                candidateOrders.map((order) => {
                  const isChecked = includedIds.has(order.id);
                  const splitParts = splitMoneyOrderAmounts(order.totalAmount, 20000);
                  const isLargeOrder = splitParts.length > 1;

                  return (
                    <div
                      key={order.id}
                      onClick={() => toggleOrder(order.id)}
                      className={`px-4 py-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                        isChecked ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by row click
                          className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300 pointer-events-none"
                        />
                        <div>
                          <div className="flex items-center gap-2 font-bold text-gray-900 flex-wrap">
                            <span>{order.customerName}</span>
                            <span className="font-mono text-[11px] text-gray-500" dir="ltr">
                              ({order.trackingNumber})
                            </span>
                            {isLargeOrder && (
                              <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] px-1.5 py-0.2 rounded font-bold">
                                {splitParts.length} منی آرڈرز ({splitParts.map(p => `Rs ${p}`).join(' + ')})
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 truncate max-w-[280px]">
                            {order.customerCity ? `${order.customerCity} - ` : ''}{order.customerAddress}
                          </p>
                        </div>
                      </div>

                      <div className="text-left flex items-center gap-3" dir="ltr">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          order.status === 'Packed' ? 'bg-indigo-100 text-indigo-800' :
                          order.status === 'Shipped' ? 'bg-blue-100 text-blue-800' :
                          order.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {order.status}
                        </span>
                        <div className="text-right">
                          <span className="font-bold font-mono text-xs text-emerald-700 block">
                            Rs {order.totalAmount}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* PROGRESS BAR WHILE GENERATING */}
          {isGenerating && progress && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-2 animate-pulse">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                  PDF تیار ہو رہی ہے... (منی آرڈر {progress.current} / {progress.total})
                </span>
                <span className="font-mono font-bold">
                  {Math.round((progress.current / progress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-emerald-200 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className="px-5 py-3.5 bg-gray-100 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-gray-700 flex items-center gap-2">
            <span>منتخب آرڈرز: <strong className="text-emerald-700 font-mono text-sm">{activeOrdersToDownload.length}</strong></span>
            <span>•</span>
            <span>کل پرنٹ شدہ صفحات: <strong className="text-emerald-700 font-mono text-sm">{allMoneyOrderPages.length}</strong></span>
            {allMoneyOrderPages.length > activeOrdersToDownload.length && (
              <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-300">
                ({allMoneyOrderPages.length - activeOrdersToDownload.length} اضافی صفحات برائے تقسیم شدہ رقوم)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              منسوخ کریں (Cancel)
            </button>

            <button
              type="button"
              onClick={handleDownloadBulkPDF}
              disabled={isGenerating || allMoneyOrderPages.length === 0}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-md transition-all disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  PDF ڈاؤنلوڈ ہو رہی ہے...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  بلک PDF ڈاؤنلوڈ کریں ({allMoneyOrderPages.length} صفحات)
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
