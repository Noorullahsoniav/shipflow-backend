import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Order, Settings, MoneyOrderConfig, FieldPosition } from '../types';
import { format } from 'date-fns';
import { cn, splitMoneyOrderAmounts, numberToWords, numberToUrduWords } from '../lib/utils';
import { 
  Lock, Unlock, RotateCcw, Save, Image as ImageIcon, Eye, EyeOff, 
  Settings2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Type, Move, Hand,
  ZoomIn, ZoomOut, Maximize2, Layers
} from 'lucide-react';

export const DEFAULT_MONEY_ORDER_CONFIG: MoneyOrderConfig = {
  showBgInPreview: true,
  isLocked: false,
  fields: {
    trackingNumberTop: { x: 80, y: 46, fontSize: 13, fontWeight: 'bold', visible: true },
    dateTop: { x: 152, y: 46, fontSize: 13, fontWeight: 'bold', visible: true },
    amountRs: { x: 38, y: 64, fontSize: 16, fontWeight: 'bold', visible: true },
    codArticleNo: { x: 125, y: 60, fontSize: 13, fontWeight: 'bold', visible: true },
    amountWordsEng: { x: 100, y: 72, fontSize: 12, fontWeight: 'bold', visible: true, maxWidth: 100 },
    amountDigitsUrdu: { x: 80, y: 110, fontSize: 14, fontWeight: 'bold', visible: true },
    amountWordsUrdu: { x: 50, y: 122, fontSize: 12, fontWeight: 'bold', visible: true, maxWidth: 135 },
    customerName: { x: 75, y: 140, fontSize: 13, fontWeight: 'bold', visible: true },
    customerAddress: { x: 45, y: 152, fontSize: 12, fontWeight: 'bold', visible: true, maxWidth: 135 },
    customerCNIC: { x: 75, y: 164, fontSize: 12, fontWeight: 'bold', visible: true },
    senderName: { x: 75, y: 195, fontSize: 13, fontWeight: 'bold', visible: true },
    senderAddress: { x: 45, y: 207, fontSize: 12, fontWeight: 'bold', visible: true, maxWidth: 135 },
    senderCNIC: { x: 75, y: 219, fontSize: 12, fontWeight: 'bold', visible: true },
    signatureDate: { x: 145, y: 242, fontSize: 13, fontWeight: 'bold', visible: true },
  }
};

export const FIELD_LABELS: Record<keyof MoneyOrderConfig['fields'], string> = {
  trackingNumberTop: 'U.M.O ٹریکنگ نمبر (اوپر)',
  dateTop: 'تاریخ (اوپر)',
  amountRs: 'قیمت Rs. (باکس)',
  codArticleNo: 'COD آرٹیکل نمبر',
  amountWordsEng: 'رقم الفاظ میں (English)',
  amountDigitsUrdu: 'رقم ہندسوں میں (اردو)',
  amountWordsUrdu: 'رقم عبارت میں (اردو)',
  customerName: 'بھیجنے والے کا نام (گاہک)',
  customerAddress: 'بھیجنے والے کا پتہ و فون',
  customerCNIC: 'بھیجنے والے کا CNIC',
  senderName: 'وصول کنندہ کا نام (سیلر)',
  senderAddress: 'وصول کنندہ کا پتہ و فون',
  senderCNIC: 'وصول کنندہ کا CNIC',
  signatureDate: 'تاریخ (دستخط کے ساتھ)'
};

const STORAGE_KEY = 'money_order_field_config_v1';

export function getSavedMoneyOrderConfig(): MoneyOrderConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_MONEY_ORDER_CONFIG,
        ...parsed,
        fields: {
          ...DEFAULT_MONEY_ORDER_CONFIG.fields,
          ...(parsed.fields || {})
        }
      };
    }
  } catch (e) {
    console.error('Failed to load Money Order config', e);
  }
  return DEFAULT_MONEY_ORDER_CONFIG;
}

interface MoneyOrderProps {
  order: Order;
  settings: Settings | null;
  dataOnly?: boolean;
  topOffset?: number;
  leftOffset?: number;
  config?: MoneyOrderConfig;
  onConfigChange?: (newConfig: MoneyOrderConfig) => void;
  isCalibrating?: boolean;
  customAmount?: number;
  partIndex?: number;
  totalParts?: number;
}

export function MoneyOrderCalibrator({
  order,
  settings,
  dataOnly = false,
  topOffset = 0,
  leftOffset = 0,
  config: externalConfig,
  onConfigChange,
  isCalibrating = false,
  customAmount,
  partIndex,
  totalParts
}: MoneyOrderProps) {
  const [config, setConfig] = useState<MoneyOrderConfig>(() => externalConfig || getSavedMoneyOrderConfig());
  const [selectedField, setSelectedField] = useState<keyof MoneyOrderConfig['fields']>('customerName');
  const [activeTab, setActiveTab] = useState<'preview' | 'settings'>('preview');
  const [draggedField, setDraggedField] = useState<keyof MoneyOrderConfig['fields'] | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [bgImageFile, setBgImageFile] = useState<string | null>(config.bgImage || null);
  const [stepSize, setStepSize] = useState<number>(1); // 1mm or 0.1mm
  const [calibratorPartIndex, setCalibratorPartIndex] = useState<number>(0);
  const [zoomScale, setZoomScale] = useState<number>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return 0.42; // Perfect default fit for mobile screen
    }
    return 0.65;
  });

  const allOrderParts = useMemo(() => {
    return splitMoneyOrderAmounts(order.totalAmount, 20000);
  }, [order.totalAmount]);

  const effectiveTotalParts = totalParts ?? (customAmount !== undefined ? 1 : allOrderParts.length);
  const effectivePartIndex = partIndex ?? (isCalibrating ? calibratorPartIndex : 0);
  const effectiveAmount = customAmount !== undefined 
    ? customAmount 
    : (allOrderParts[effectivePartIndex] !== undefined ? allOrderParts[effectivePartIndex] : allOrderParts[0]);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number } | null>(null);

  useEffect(() => {
    if (externalConfig) {
      setConfig(externalConfig);
    }
  }, [externalConfig]);

  const updateConfig = (updater: (prev: MoneyOrderConfig) => MoneyOrderConfig) => {
    setConfig(prev => {
      const next = updater(prev);
      if (onConfigChange) onConfigChange(next);
      return next;
    });
  };

  const saveToLocalStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2500);
    } catch (e) {
      console.error('Save failed', e);
    }
  };

  const handleReset = () => {
    if (window.confirm('کیا آپ تمام پوزیشنز اور سیٹنگز کو ڈیفالٹ پر ری سیٹ کرنا چاہتے ہیں؟')) {
      setConfig(DEFAULT_MONEY_ORDER_CONFIG);
      setBgImageFile(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const updateFieldPosition = (
    fieldKey: keyof MoneyOrderConfig['fields'],
    delta: { x?: number; y?: number; fontSize?: number; visible?: boolean; maxWidth?: number }
  ) => {
    updateConfig(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldKey]: {
          ...prev.fields[fieldKey],
          x: delta.x !== undefined ? Math.max(0, Math.min(205, Math.round((prev.fields[fieldKey].x + delta.x) * 10) / 10)) : prev.fields[fieldKey].x,
          y: delta.y !== undefined ? Math.max(0, Math.min(290, Math.round((prev.fields[fieldKey].y + delta.y) * 10) / 10)) : prev.fields[fieldKey].y,
          fontSize: delta.fontSize !== undefined ? Math.max(8, Math.min(36, prev.fields[fieldKey].fontSize + delta.fontSize)) : prev.fields[fieldKey].fontSize,
          visible: delta.visible !== undefined ? delta.visible : prev.fields[fieldKey].visible,
          maxWidth: delta.maxWidth !== undefined ? Math.max(30, Math.min(200, Math.round(((prev.fields[fieldKey].maxWidth || 135) + delta.maxWidth) * 10) / 10)) : prev.fields[fieldKey].maxWidth,
        }
      }
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setBgImageFile(result);
        updateConfig(prev => ({ ...prev, bgImage: result }));
      };
      reader.readAsDataURL(file);
    }
  };

  // MOUSE & TOUCH DRAG START
  const handleStartDrag = (clientX: number, clientY: number, fieldKey: keyof MoneyOrderConfig['fields']) => {
    if (config.isLocked || !containerRef.current) return;
    setSelectedField(fieldKey);
    setDraggedField(fieldKey);

    const field = config.fields[fieldKey];
    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      initialX: field.x,
      initialY: field.y,
    };
  };

  const handleMouseDown = (e: React.MouseEvent, fieldKey: keyof MoneyOrderConfig['fields']) => {
    if (config.isLocked) return;
    e.stopPropagation();
    handleStartDrag(e.clientX, e.clientY, fieldKey);
  };

  const handleTouchStart = (e: React.TouchEvent, fieldKey: keyof MoneyOrderConfig['fields']) => {
    if (config.isLocked) return;
    e.stopPropagation();
    const touch = e.touches[0];
    if (touch) {
      handleStartDrag(touch.clientX, touch.clientY, fieldKey);
    }
  };

  // GLOBAL MOVE & END LISTENERS
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!draggedField || !dragStartRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pxPerMm = rect.width / 210; // 210mm canvas width (already scaled)

      const deltaXmm = (clientX - dragStartRef.current.mouseX) / pxPerMm;
      const deltaYmm = (clientY - dragStartRef.current.mouseY) / pxPerMm;

      const newX = Math.max(0, Math.min(205, Math.round((dragStartRef.current.initialX + deltaXmm) * 10) / 10));
      const newY = Math.max(0, Math.min(290, Math.round((dragStartRef.current.initialY + deltaYmm) * 10) / 10));

      setConfig(prev => ({
        ...prev,
        fields: {
          ...prev.fields,
          [draggedField]: {
            ...prev.fields[draggedField],
            x: newX,
            y: newY,
          }
        }
      }));
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setDraggedField(null);
      dragStartRef.current = null;
    };

    if (draggedField) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
      window.addEventListener('touchcancel', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [draggedField]);

  const today = format(new Date(), 'dd-MM-yyyy');

  const isSplit = effectiveTotalParts > 1;
  const partSuffix = isSplit ? ` (${effectivePartIndex + 1}/${effectiveTotalParts})` : '';

  const valuesMap: Record<keyof MoneyOrderConfig['fields'], string> = {
    trackingNumberTop: `${order.trackingNumber}${partSuffix}`,
    dateTop: today,
    amountRs: `${effectiveAmount}`,
    codArticleNo: `${order.trackingNumber}${partSuffix}`,
    amountWordsEng: numberToWords(effectiveAmount),
    amountDigitsUrdu: `${effectiveAmount}`,
    amountWordsUrdu: numberToUrduWords(effectiveAmount),
    customerName: order.customerName,
    customerAddress: `${order.customerAddress}, ${order.customerCity} - ${order.customerPhone}`,
    customerCNIC: order.customerCNIC || '',
    senderName: settings?.senderName || '',
    senderAddress: `${settings?.senderAddress || ''} - ${settings?.senderPhone || ''}`,
    senderCNIC: settings?.senderCNIC || '',
    signatureDate: today,
  };

  const activeFieldData = config.fields[selectedField];

  if (!isCalibrating) {
    return (
      <div 
        ref={containerRef}
        style={{
          width: '210mm',
          height: '297mm',
          position: 'relative',
          backgroundColor: '#ffffff',
          color: '#000',
          fontFamily: 'sans-serif',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
        className="money-order-print-container bg-white"
      >
        {/* BACKGROUND FORM IMAGE TEMPLATE */}
        {!dataOnly && config.showBgInPreview && (
          <div className="absolute inset-0 pointer-events-none z-0 select-none">
            {bgImageFile ? (
              <img
                src={bgImageFile}
                alt="Money Order Form Template"
                className="w-full h-full object-fill opacity-90 pointer-events-none"
              />
            ) : (
              <div className="w-full h-full border border-gray-300 relative bg-white">
                <div className="p-[10mm_15mm] h-full flex flex-col justify-between opacity-40 select-none">
                  <div className="border-b border-gray-400 pb-2 flex justify-between items-start text-[11px]">
                    <div className="w-20 h-20 border border-gray-400 flex items-center justify-center text-[10px] text-gray-500">Month Stamp</div>
                    <div className="w-64 h-20 border border-gray-400 flex items-center justify-center text-[10px] text-gray-500">Oblong M.O. Stamp</div>
                  </div>
                  <div className="text-center font-bold text-gray-400 text-sm py-4 border-t border-b border-gray-300 my-4">
                    پاکستان پوسٹ آفیشل C.O.D. منی آرڈر فارم
                  </div>
                  <div className="border border-gray-300 p-4 h-48 flex flex-col justify-around text-xs text-gray-500">
                    <div className="border-b border-gray-300 pb-1">بھیجنے والے کا نام و پتہ (Sender Details)</div>
                    <div className="border-b border-gray-300 pb-1">وصول کنندہ کا نام و پتہ (Receiver Details)</div>
                  </div>
                  <div className="border-t border-gray-400 pt-2 flex justify-between text-xs text-gray-500">
                    <div>"INTIMATION" اطلاع</div>
                    <div>Date Stamp</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PRINTABLE TEXT FIELDS FOR EACH WORD */}
        {(Object.keys(config.fields) as Array<keyof MoneyOrderConfig['fields']>).map((key) => {
          const field = config.fields[key];
          if (!field.visible) return null;
          const val = valuesMap[key];
          const isMultiLine = key.includes('Address') || key.includes('amountWords') || !!field.maxWidth;
          const effectiveMaxWidth = field.maxWidth || (isMultiLine ? 135 : undefined);

          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                left: `${field.x + leftOffset}mm`,
                top: `${field.y + topOffset}mm`,
                fontSize: `${field.fontSize}px`,
                fontWeight: field.fontWeight || 'bold',
                color: '#000',
                fontFamily: key.includes('Urdu') || key.includes('customer') || key.includes('sender') ? '"Noto Sans Arabic", "Urdu Typesetting", "Jameel Noori Nastaleeq", sans-serif' : 'sans-serif',
                zIndex: 10,
                lineHeight: '1.25',
                whiteSpace: isMultiLine ? 'normal' : 'nowrap',
                maxWidth: effectiveMaxWidth ? `${effectiveMaxWidth}mm` : undefined,
                wordBreak: isMultiLine ? 'break-word' : undefined,
              }}
            >
              {val}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-full overflow-hidden">
      {/* EDITING TOOLBAR FOR CALIBRATION */}
      {isCalibrating && (
        <div className="bg-slate-900 text-white p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-xl border border-slate-800 text-xs flex flex-col gap-2.5 w-full max-w-full" dir="rtl">
          {/* HEADER ROW */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-emerald-400 flex items-center gap-1 text-xs sm:text-sm">
                <Settings2 className="w-4 h-4" />
                منی آرڈر ورڈ ایڈیٹنگ
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* LOCK / UNLOCK TOGGLE */}
              <button
                type="button"
                onClick={() => updateConfig(p => ({ ...p, isLocked: !p.isLocked }))}
                className={cn(
                  "px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm text-xs",
                  config.isLocked
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "bg-amber-500 text-slate-950 hover:bg-amber-400"
                )}
              >
                {config.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>{config.isLocked ? 'لاک ہے' : 'ان لاک (ڈریگ چالو)'}</span>
              </button>

              {/* SAVE BUTTON */}
              <button
                type="button"
                onClick={saveToLocalStorage}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-sm text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>سیو کریں</span>
              </button>

              {/* RESET BUTTON */}
              <button
                type="button"
                onClick={handleReset}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-2 py-1 sm:py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer text-xs"
                title="ری سیٹ کریں"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* SHOW/HIDE BG IMAGE */}
              <button
                type="button"
                onClick={() => updateConfig(p => ({ ...p, showBgInPreview: !p.showBgInPreview }))}
                className={cn(
                  "px-2 py-1 sm:py-1.5 rounded-lg font-semibold flex items-center gap-1 transition-all cursor-pointer border border-slate-700 text-xs",
                  config.showBgInPreview ? "bg-slate-800 text-emerald-400" : "bg-slate-800 text-slate-400"
                )}
                title="فارم کی بیک گراؤنڈ تصویر دکھائیں یا چھپائیں"
              >
                {config.showBgInPreview ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              {/* UPLOAD BG IMAGE */}
              <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition-all border border-slate-700 text-xs">
                <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">فارم تصویر</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
          </div>

          {showSavedToast && (
            <div className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 p-2 rounded-lg text-center font-bold text-xs animate-fade-in">
              ✅ تمام الفاظ کی پوزیشنز کامیابی سے سیو ہو گئیں!
            </div>
          )}

          {/* SPLIT MONEY ORDER PARTS SELECTOR (WHEN > 20,000 RS) */}
          {allOrderParts.length > 1 && (
            <div className="bg-emerald-950/80 border border-emerald-600/40 p-2 sm:p-2.5 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>
                  کل رقم Rs {order.totalAmount} — ڈاکخانہ رول (زیادہ سے زیادہ 20,000 فی منی آرڈر) کے تحت {allOrderParts.length} منی آرڈرز بنے ہیں:
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {allOrderParts.map((amt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCalibratorPartIndex(idx)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg font-bold transition-all text-xs flex items-center gap-1 cursor-pointer",
                      calibratorPartIndex === idx
                        ? "bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-300"
                        : "bg-slate-800 text-emerald-200 hover:bg-slate-700 border border-emerald-700/40"
                    )}
                  >
                    <span>منی آرڈر {idx + 1}/{allOrderParts.length}</span>
                    <span className="font-mono text-[11px] opacity-90">(Rs {amt})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* FIELD DROPDOWN & MOBILE DIRECTIONAL TOUCH D-PAD */}
          <div className="bg-slate-950 p-2 sm:p-2.5 rounded-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-2.5">
            {/* FIELD SELECTOR DROPDOWN */}
            <div className="w-full md:w-1/2 flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
                <span>منتخب کردہ ورڈ:</span>
                <span className="text-emerald-400 font-mono text-[10px]">
                  X: {activeFieldData?.x}mm | Y: {activeFieldData?.y}mm | سائز: {activeFieldData?.fontSize}px
                </span>
              </label>
              <select
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value as keyof MoneyOrderConfig['fields'])}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-1.5 text-xs font-bold focus:ring-1 focus:ring-emerald-500 outline-none cursor-pointer"
              >
                {(Object.keys(config.fields) as Array<keyof MoneyOrderConfig['fields']>).map((key) => (
                  <option key={key} value={key}>
                    {FIELD_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {/* MOBILE TOUCH D-PAD & STEP CONTROLS */}
            <div className="w-full md:w-auto flex items-center justify-between md:justify-end gap-2 pt-1.5 md:pt-0 border-t md:border-t-0 border-slate-800">
              {/* STEP SIZE TOGGLE */}
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400 font-semibold">قدم:</span>
                <button
                  type="button"
                  onClick={() => setStepSize(prev => prev === 1 ? 0.1 : 1)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md font-mono text-emerald-400 font-bold border border-slate-700 text-[10px]"
                >
                  {stepSize}mm
                </button>
              </div>

              {/* FONT SIZE +/- */}
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400 font-semibold">سائز:</span>
                <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { fontSize: -1 })}
                    className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold rounded flex items-center justify-center text-xs"
                  >
                    -
                  </button>
                  <span className="font-mono text-xs w-5 text-center">{activeFieldData?.fontSize}</span>
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { fontSize: 1 })}
                    className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold rounded flex items-center justify-center text-xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* MAX WIDTH +/- FOR WRAPPING */}
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-slate-400 font-semibold">چوڑائی:</span>
                <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { maxWidth: -5 })}
                    className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded flex items-center justify-center text-xs"
                    title="چوڑائی (Max Width) کم کریں"
                  >
                    -
                  </button>
                  <span className="font-mono text-[11px] w-8 text-center text-amber-300">
                    {activeFieldData?.maxWidth || 135}m
                  </span>
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { maxWidth: 5 })}
                    className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded flex items-center justify-center text-xs"
                    title="چوڑائی (Max Width) بڑھائیں"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* TOUCH D-PAD ARROWS */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-slate-400 font-semibold mb-0.5">پوزیشن تیر:</span>
                <div className="grid grid-cols-3 gap-0.5">
                  <div />
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { y: -stepSize })}
                    className="w-6 h-6 bg-slate-800 hover:bg-emerald-600 text-white rounded flex items-center justify-center font-bold text-xs"
                    title="اوپر کریں"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <div />
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { x: -stepSize })}
                    className="w-6 h-6 bg-slate-800 hover:bg-emerald-600 text-white rounded flex items-center justify-center font-bold text-xs"
                    title="بائیں کریں"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { y: stepSize })}
                    className="w-6 h-6 bg-slate-800 hover:bg-emerald-600 text-white rounded flex items-center justify-center font-bold text-xs"
                    title="نیچے کریں"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateFieldPosition(selectedField, { x: stepSize })}
                    className="w-6 h-6 bg-slate-800 hover:bg-emerald-600 text-white rounded flex items-center justify-center font-bold text-xs"
                    title="دائیں کریں"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ZOOM & TAB SELECTION BAR */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
            <div className="flex gap-1.5">
              <button
                onClick={() => setActiveTab('preview')}
                className={cn("px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer", activeTab === 'preview' ? "bg-slate-800 text-emerald-400" : "text-slate-400")}
              >
                ✋ کینوس ڈریگ
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={cn("px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 cursor-pointer", activeTab === 'settings' ? "bg-slate-800 text-emerald-400" : "text-slate-400")}
              >
                <Settings2 className="w-3 h-3" />
                ورڈز لسٹ
              </button>
            </div>

            {/* ZOOM SCALE CONTROLS */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold px-1 flex items-center gap-1">
                <ZoomIn className="w-3 h-3 text-emerald-400" />
                زووم:
              </span>
              {[0.38, 0.5, 0.7, 1.0].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setZoomScale(s)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-all",
                    Math.abs(zoomScale - s) < 0.05 ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  )}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* DETAILED LIST TAB */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1.5 bg-slate-950/90 rounded-xl border border-slate-800">
              {(Object.keys(config.fields) as Array<keyof MoneyOrderConfig['fields']>).map((key) => {
                const field = config.fields[key];
                const isSelected = selectedField === key;
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedField(key)}
                    className={cn(
                      "p-2 rounded-lg border text-xs transition-all flex flex-col gap-1.5 cursor-pointer",
                      isSelected ? "bg-slate-800 border-emerald-500 shadow-xs" : "bg-slate-900 border-slate-800 hover:border-slate-700"
                    )}
                  >
                    <div className="flex items-center justify-between font-bold text-slate-200">
                      <span className="text-emerald-400 truncate">{FIELD_LABELS[key]}</span>
                      <input
                        type="checkbox"
                        checked={field.visible}
                        onChange={(e) => updateFieldPosition(key, { visible: e.target.checked })}
                        className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 cursor-pointer"
                        title="دکھائیں / چھپائیں"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[11px] items-center text-slate-300">
                      <div className="flex items-center gap-0.5 bg-slate-950 p-1 rounded border border-slate-800 justify-between">
                        <span className="text-[10px] text-slate-400">X:</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { x: -1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-emerald-400">-</button>
                        <span className="font-mono text-white text-[10px]">{field.x}m</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { x: 1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-emerald-400">+</button>
                      </div>

                      <div className="flex items-center gap-0.5 bg-slate-950 p-1 rounded border border-slate-800 justify-between">
                        <span className="text-[10px] text-slate-400">Y:</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { y: -1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-emerald-400">-</button>
                        <span className="font-mono text-white text-[10px]">{field.y}m</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { y: 1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-emerald-400">+</button>
                      </div>

                      <div className="flex items-center gap-0.5 bg-slate-950 p-1 rounded border border-slate-800 justify-between">
                        <span className="text-[10px] text-slate-400">سائز:</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { fontSize: -1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-sky-400">-</button>
                        <span className="font-mono text-white text-[10px]">{field.fontSize}p</span>
                        <button type="button" onClick={() => updateFieldPosition(key, { fontSize: 1 })} className="px-1 hover:bg-slate-800 rounded font-bold text-sky-400">+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DYNAMIC RESPONSIVE CANVAS CONTAINER (EXACT FIT FOR MOBILE) */}
      <div className="w-full overflow-x-auto overflow-y-auto py-2 flex justify-center bg-slate-100/60 rounded-xl border border-gray-200">
        <div 
          style={{
            width: `${210 * zoomScale}mm`,
            height: `${297 * zoomScale}mm`,
            position: 'relative',
            flexShrink: 0,
            transition: 'width 0.15s ease, height 0.15s ease',
          }}
        >
          <div 
            ref={containerRef}
            style={{
              width: '210mm',
              height: '297mm',
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `scale(${zoomScale}) translate(${leftOffset}mm, ${topOffset}mm)`,
              transformOrigin: 'top left',
              backgroundColor: '#ffffff',
              color: '#000',
              fontFamily: 'sans-serif',
              boxSizing: 'border-box',
              overflow: 'hidden',
              boxShadow: isCalibrating ? '0 10px 30px rgba(0,0,0,0.15)' : 'none'
            }}
            className="money-order-print-container rounded-sm border border-gray-300 bg-white"
          >
            {/* BACKGROUND FORM IMAGE TEMPLATE */}
            {!dataOnly && config.showBgInPreview && (
              <div className="absolute inset-0 pointer-events-none z-0 print:hidden select-none">
                {bgImageFile ? (
                  <img
                    src={bgImageFile}
                    alt="Money Order Form Template"
                    className="w-full h-full object-fill opacity-90 pointer-events-none"
                  />
                ) : (
                  <div className="w-full h-full border border-gray-300 relative bg-white">
                    <div className="p-[10mm_15mm] h-full flex flex-col justify-between opacity-40 select-none">
                      <div className="border-b border-gray-400 pb-2 flex justify-between items-start text-[11px]">
                        <div className="w-20 h-20 border border-gray-400 flex items-center justify-center text-[10px] text-gray-500">Month Stamp</div>
                        <div className="w-64 h-20 border border-gray-400 flex items-center justify-center text-[10px] text-gray-500">Oblong M.O. Stamp</div>
                      </div>
                      <div className="text-center font-bold text-gray-400 text-sm py-4 border-t border-b border-gray-300 my-4">
                        پاکستان پوسٹ آفیشل C.O.D. منی آرڈر فارم
                      </div>
                      <div className="border border-gray-300 p-4 h-48 flex flex-col justify-around text-xs text-gray-500">
                        <div className="border-b border-gray-300 pb-1">بھیجنے والے کا نام و پتہ (Sender Details)</div>
                        <div className="border-b border-gray-300 pb-1">وصول کنندہ کا نام و پتہ (Receiver Details)</div>
                      </div>
                      <div className="border-t border-gray-400 pt-2 flex justify-between text-xs text-gray-500">
                        <div>"INTIMATION" اطلاع</div>
                        <div>Date Stamp</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* DRAGGABLE TEXT FIELDS FOR EACH WORD */}
            {(Object.keys(config.fields) as Array<keyof MoneyOrderConfig['fields']>).map((key) => {
              const field = config.fields[key];
              if (!field.visible) return null;

              const isSelected = selectedField === key;
              const isDragging = draggedField === key;
              const val = valuesMap[key];
              const isMultiLine = key.includes('Address') || key.includes('amountWords') || !!field.maxWidth;
              const effectiveMaxWidth = field.maxWidth || (isMultiLine ? 135 : undefined);

              return (
                <div
                  key={key}
                  onMouseDown={(e) => handleMouseDown(e, key)}
                  onTouchStart={(e) => handleTouchStart(e, key)}
                  onClick={() => setSelectedField(key)}
                  style={{
                    position: 'absolute',
                    left: `${field.x}mm`,
                    top: `${field.y}mm`,
                    fontSize: `${field.fontSize}px`,
                    fontWeight: field.fontWeight || 'bold',
                    color: '#000',
                    fontFamily: key.includes('Urdu') || key.includes('customer') || key.includes('sender') ? '"Noto Sans Arabic", "Urdu Typesetting", "Jameel Noori Nastaleeq", sans-serif' : 'sans-serif',
                    zIndex: isSelected ? 30 : 10,
                    cursor: config.isLocked ? 'default' : 'grab',
                    userSelect: 'none',
                    touchAction: config.isLocked ? 'auto' : 'none',
                    lineHeight: '1.25',
                    whiteSpace: isMultiLine ? 'normal' : 'nowrap',
                    maxWidth: effectiveMaxWidth ? `${effectiveMaxWidth}mm` : undefined,
                    wordBreak: isMultiLine ? 'break-word' : undefined,
                  }}
                  className={cn(
                    "transition-all duration-75 select-none",
                    !config.isLocked && "hover:outline hover:outline-1 hover:outline-indigo-500 rounded px-0.5 cursor-grab",
                    !config.isLocked && isSelected && "outline outline-2 outline-emerald-500 bg-emerald-100/90 shadow-lg rounded px-1.5 py-0.5",
                    !config.isLocked && isDragging && "opacity-80 scale-105 outline-2 outline-amber-500 cursor-grabbing bg-amber-100/90 shadow-xl"
                  )}
                >
                  {val}

                  {/* TOOLTIP BADGE ON SELECTION */}
                  {!config.isLocked && isSelected && isCalibrating && (
                    <div 
                      className="absolute -top-7 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow pointer-events-none z-40 whitespace-nowrap flex items-center gap-1"
                      dir="ltr"
                    >
                      <Hand className="w-3 h-3" />
                      <span>{FIELD_LABELS[key]} ({field.x}mm, {field.y}mm)</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
