import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileSpreadsheet, 
  Upload, 
  Download, 
  Check, 
  AlertCircle, 
  Sparkles, 
  Trash2, 
  Plus, 
  Search, 
  Loader2, 
  Layers, 
  CheckCircle2, 
  Calendar, 
  X,
  ClipboardPaste,
  PackageCheck,
  CalendarDays,
  ListOrdered
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { doc, collection, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Product, StockLog } from '../types';
import { formatCurrency, cn, normalizeUrduProductName } from '../lib/utils';
import { format, subDays, subMonths, lastDayOfMonth } from 'date-fns';
import toast from 'react-hot-toast';

interface BulkStockImportModalProps {
  products: Product[];
  onClose: () => void;
  onSuccess?: () => void;
}

export interface ParsedImportItem {
  id: string; // temporary row id
  name: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  entryDate: string; // YYYY-MM-DD
  supplierName?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  isMatched: boolean;
  currentStock: number;
  userEditedPrice?: boolean;
}

// Convert Urdu numerals (۰-۹) to standard English numbers (0-9)
export const convertUrduDigitsToEng = (str: string): string => {
  const urduDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  return (str || '').replace(/[۰-۹]/g, (char) => String(urduDigits.indexOf(char)));
};

// Check if a line is a Date header (e.g. 4/9/26, 03-09-2026, 9/8/26, ۳/۹/۲۶)
export const parseDateLine = (rawLine: string, contextMonth?: number): string | null => {
  if (!rawLine) return null;
  const line = convertUrduDigitsToEng(rawLine.trim())
    .replace(/^(تاریخ|date|dt|روز|بتاریخ|بتاریکھ)[:\s\-_]*/i, '')
    .trim();

  // Match 3/9/26, 04/09/2026, 4-9-26, 4.9.26, 4/9, 9/8/26
  const match = line.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
  if (match) {
    let part1 = parseInt(match[1], 10);
    let part2 = parseInt(match[2], 10);
    const rawYear = match[3];

    let year = new Date().getFullYear(); // e.g. 2026
    if (rawYear) {
      const yNum = parseInt(rawYear, 10);
      year = yNum < 100 ? (2000 + yNum) : yNum;
    }

    let day = part1;
    let month = part2;

    // Smart contextual month vs day resolution:
    // When contextMonth is known (e.g. 9 for September):
    // In "9/8/26", part1 is 9 (matches contextMonth) and part2 is 8 (valid day).
    // So month=9 (September) and day=8!
    if (contextMonth && contextMonth >= 1 && contextMonth <= 12) {
      if (part1 === contextMonth && part2 !== contextMonth && part2 >= 1 && part2 <= 31) {
        month = part1;
        day = part2;
      } else if (part2 === contextMonth && part1 !== contextMonth && part1 >= 1 && part1 <= 31) {
        day = part1;
        month = part2;
      }
    } else {
      if (part1 > 12 && part2 <= 12) {
        day = part1;
        month = part2;
      } else if (part2 > 12 && part1 <= 12) {
        month = part1;
        day = part2;
      }
    }

    // Check day & month validity
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  // Also support YYYY-MM-DD
  const isoMatch = line.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  return null;
};

// Parse a single product line (e.g. "معجون مقوی 4" or "جواہرات قسم اعلیٰ 6")
export const parseProductLine = (rawLine: string, contextMonth?: number): { name: string; quantity: number; costPrice?: number; sellingPrice?: number } | null => {
  const line = rawLine.trim();
  if (!line) return null;

  // Never treat a date line as a product
  if (parseDateLine(line, contextMonth)) return null;

  // If separated by Tab, Comma, or Pipe
  if (line.includes('\t') || line.includes(',') || line.includes('|')) {
    const delimiter = line.includes('\t') ? '\t' : (line.includes(',') ? ',' : '|');
    const parts = line.split(delimiter).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) {
      const name = parts[0];
      const rawQty = parts[1] ? parseInt(convertUrduDigitsToEng(parts[1]).replace(/[^0-9]/g, ''), 10) : 1;
      const cost = parts[2] ? parseFloat(convertUrduDigitsToEng(parts[2]).replace(/[^0-9.]/g, '')) : undefined;
      const selling = parts[3] ? parseFloat(convertUrduDigitsToEng(parts[3]).replace(/[^0-9.]/g, '')) : undefined;
      return { 
        name, 
        quantity: !isNaN(rawQty) && rawQty > 0 ? rawQty : 1, 
        costPrice: cost, 
        sellingPrice: selling 
      };
    }
  }

  // WhatsApp style: "معجون مقوی 4", "جواہرات قسم اعلیٰ 6", "معجون مقوی - 4", "معجون مقوی : 4"
  const engLine = convertUrduDigitsToEng(line);

  // Case A: Ends with number e.g. "معجون مقوی 4"
  const endNumMatch = engLine.match(/^(.*?)(?:[\s\-:–—=\(\)]+)(\d+)(?:\s*[\)\/pcs]*)$/);
  if (endNumMatch) {
    const qty = parseInt(endNumMatch[2], 10);
    // Get original Urdu text before the number to preserve diacritics
    const origMatch = rawLine.match(/^(.*?)(?:[\s\-:–—=\(\)]+)([0-9۰-۹]+)(?:\s*[\)\/pcs]*)$/);
    const name = (origMatch ? origMatch[1] : endNumMatch[1]).trim().replace(/^[-:–—\s]+|[-:–—\s]+$/g, '');
    if (name && !isNaN(qty) && qty > 0) {
      return { name, quantity: qty };
    }
  }

  // Case B: Starts with number e.g. "4 معجون مقوی"
  const startNumMatch = engLine.match(/^(\d+)(?:\s*x|\s*pcs)?(?:[\s\-:–—=\(\)]+)(.+)$/i);
  if (startNumMatch) {
    const qty = parseInt(startNumMatch[1], 10);
    const origMatch = rawLine.match(/^([0-9۰-۹]+)(?:\s*x|\s*pcs)?(?:[\s\-:–—=\(\)]+)(.+)$/i);
    const name = (origMatch ? origMatch[2] : startNumMatch[2]).trim().replace(/^[-:–—\s]+|[-:–—\s]+$/g, '');
    if (name && !isNaN(qty) && qty > 0) {
      return { name, quantity: qty };
    }
  }

  // Case C: Name alone, default quantity 1
  return { name: line, quantity: 1 };
};

export function BulkStockImportModal({ products, onClose, onSuccess }: BulkStockImportModalProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'excel' | 'manual'>('paste');
  const [rawText, setRawText] = useState('');
  const [importMode, setImportMode] = useState<'add' | 'replace'>('add');
  const [stockReason, setStockReason] = useState('خریداری (Purchase)');
  const [customReason, setCustomReason] = useState('');
  const [stockDate, setStockDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [items, setItems] = useState<ParsedImportItem[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
  const [filterPreview, setFilterPreview] = useState<'all' | 'matched' | 'new'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to normalize product names for accurate matching (Urdu aware)
  const normalize = (name: string): string => {
    return normalizeUrduProductName(name);
  };

  // Convert English/Urdu digits to numeric
  const parseQuantityNumber = (val: any): number => {
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.max(0, Math.round(val));
    if (!val) return 0;
    const str = convertUrduDigitsToEng(String(val).trim());
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : Math.max(0, Math.round(num));
  };

  // Smart matching with existing products
  const matchProduct = (name: string): Product | null => {
    if (!name || !name.trim()) return null;
    const norm = normalize(name);
    
    // 1. Exact match
    const exact = products.find(p => normalize(p.name) === norm);
    if (exact) return exact;

    // 2. Starts-with or ends-with match
    const prefix = products.find(p => {
      const pNorm = normalize(p.name);
      return pNorm.startsWith(norm) || norm.startsWith(pNorm);
    });
    if (prefix) return prefix;

    // 3. Substring match
    const substr = products.find(p => {
      const pNorm = normalize(p.name);
      return (pNorm.length > 3 && norm.includes(pNorm)) || (norm.length > 3 && pNorm.includes(norm));
    });
    if (substr) return substr;

    return null;
  };

  // Parse raw rows into structured items with smart pricing
  const buildImportItems = (rawRows: Array<{ 
    name: string; 
    quantity: number; 
    costPrice?: number; 
    sellingPrice?: number; 
    supplier?: string;
    entryDate?: string;
  }>) => {
    const list: ParsedImportItem[] = [];

    rawRows.forEach((row, index) => {
      const trimmedName = (row.name || '').trim();
      if (!trimmedName) return;

      const matched = matchProduct(trimmedName);
      const isMatched = !!matched;

      // Smart pricing logic:
      // If matched, take prices from old stock unless explicitly given in row
      // If new, take provided price or default to 0 (user can add later)
      const costPrice = row.costPrice !== undefined && row.costPrice > 0 
        ? row.costPrice 
        : (matched ? (matched.costPrice || 0) : 0);

      const sellingPrice = row.sellingPrice !== undefined && row.sellingPrice > 0 
        ? row.sellingPrice 
        : (matched ? (matched.sellingPrice || 0) : 0);

      list.push({
        id: `item-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
        name: trimmedName,
        quantity: Math.max(1, row.quantity || 1),
        costPrice,
        sellingPrice,
        entryDate: row.entryDate || stockDate,
        supplierName: row.supplier || (matched?.supplierName || ''),
        matchedProductId: matched?.id,
        matchedProductName: matched?.name,
        isMatched,
        currentStock: matched?.stock || 0,
        userEditedPrice: false
      });
    });

    setItems(list);
    if (list.length > 0) {
      toast.success(`🎉 ${list.length} مصنوعات لوڈ ہو گئیں! (${list.filter(i => i.isMatched).length} پرانے اسٹاک سے میچ ہو گئیں)`);
    } else {
      toast.error('کوئی درست پروڈکٹ نہیں مل سکی۔ براہ کرم فائل یا ٹیکسٹ چیک کریں۔');
    }
  };

  // Handle WhatsApp / Raw Text Parsing with Dates and Sequential Order
  const handleParseText = () => {
    if (!rawText.trim()) {
      toast.error('براہ کرم ٹیکسٹ باکس میں مصنوعات درج کریں!');
      return;
    }

    const lines = rawText.split(/\r?\n/);

    // Pre-scan all date-like lines in text to detect dominant month (e.g. 9 for September)
    const monthFrequency: Record<number, number> = {};
    lines.forEach((l) => {
      const clean = convertUrduDigitsToEng(l.trim())
        .replace(/^(تاریخ|date|dt|روز|بتاریخ|بتاریکھ)[:\s\-_]*/i, '')
        .trim();
      const m = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})/);
      if (m) {
        const n1 = parseInt(m[1], 10);
        const n2 = parseInt(m[2], 10);
        if (n1 >= 1 && n1 <= 12) monthFrequency[n1] = (monthFrequency[n1] || 0) + 1;
        if (n2 >= 1 && n2 <= 12) monthFrequency[n2] = (monthFrequency[n2] || 0) + 1;
      }
    });

    let detectedDominantMonth = new Date().getMonth() + 1; // default e.g. 9 for Sept
    let highestFreq = 0;
    for (const [mStr, freq] of Object.entries(monthFrequency)) {
      if (freq > highestFreq) {
        highestFreq = freq;
        detectedDominantMonth = parseInt(mStr, 10);
      }
    }

    const parsedRows: Array<{ 
      name: string; 
      quantity: number; 
      costPrice?: number; 
      sellingPrice?: number; 
      entryDate: string; 
    }> = [];

    let currentActiveDate = stockDate; // defaults to modal's date
    let detectedDatesCount = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // 1. Check if line is a Date (e.g. "3/9/26", "4/9/26", "9/8/26")
      const dateDetected = parseDateLine(trimmed, detectedDominantMonth);
      if (dateDetected) {
        currentActiveDate = dateDetected;
        detectedDatesCount++;
        return; // DO NOT add as product!
      }

      // 2. Parse product line
      const parsedProd = parseProductLine(trimmed, detectedDominantMonth);
      if (parsedProd && parsedProd.name) {
        parsedRows.push({
          name: parsedProd.name,
          quantity: parsedProd.quantity,
          costPrice: parsedProd.costPrice,
          sellingPrice: parsedProd.sellingPrice,
          entryDate: currentActiveDate
        });
      }
    });

    if (parsedRows.length === 0) {
      toast.error('کوئی درست پروڈکٹ نہیں مل سکی۔ براہ کرم ٹیکسٹ چیک کریں۔');
      return;
    }

    // Build items preserving exact sequential order
    buildImportItems(parsedRows);

    if (detectedDatesCount > 0) {
      toast.success(`📅 ${detectedDatesCount} مختلف تواریخ اور ${parsedRows.length} مصنوعات ترتیب کے ساتھ لوڈ ہو گئیں!`, {
        icon: '🗓️',
        duration: 4500
      });
    }
  };

  // Load sample text from screenshot
  const handleLoadSampleText = () => {
    const sample = `3/9/26

معجون مقوی 4

جواہرات قسم اعلیٰ 6
معجون مقوی 1

4/9/26

سفوف بامراد 1
مقوی اسپیشل 1
حب مقوی 1

5/9/26
معجون مقوی 5

7/9/26

معجون مقوی 24
مقوی اسپیشل 3
زعفرانی کیپسول 3
شوگر 5

9/8/26

معجون مقوی 12
حب مقوی 2`;
    setRawText(sample);
    toast('واٹس ایپ میسج کا نمونہ پیسٹ ہو گیا ہے۔ "ڈیٹا پراسیس کریں" پر کلک کریں!', { icon: '📋' });
  };

  // Handle Excel / CSV File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessingFile(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        
        const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!data || data.length === 0) {
          toast.error('ایکسل فائل خالی ہے!');
          setIsProcessingFile(false);
          return;
        }

        // Detect header columns
        let colNameIndex = 0;
        let colQtyIndex = 1;
        let colCostIndex = -1;
        let colSellingIndex = -1;
        let colSupplierIndex = -1;
        let colDateIndex = -1;

        const firstRow = data[0].map((c: any) => String(c).toLowerCase().trim());
        let foundHeader = false;

        firstRow.forEach((cell: string, idx: number) => {
          if (/name|product|item|آئٹم|پراڈکٹ|نام|تفصیل|description/.test(cell)) {
            colNameIndex = idx;
            foundHeader = true;
          } else if (/qty|quantity|تعداد|اسٹاک|سٹاک|stock|pieces|count|دانے/.test(cell)) {
            colQtyIndex = idx;
            foundHeader = true;
          } else if (/cost|خرید|لاگت|purchase|خریداری/.test(cell)) {
            colCostIndex = idx;
            foundHeader = true;
          } else if (/selling|sale|فروخت|قیمت|price|rate|ریٹ/.test(cell)) {
            colSellingIndex = idx;
            foundHeader = true;
          } else if (/supplier|سپلائر|دکاندار|وینڈر|vendor/.test(cell)) {
            colSupplierIndex = idx;
            foundHeader = true;
          } else if (/date|تاریخ|بتاریخ/.test(cell)) {
            colDateIndex = idx;
            foundHeader = true;
          }
        });

        const startRow = foundHeader ? 1 : 0;
        const parsedRows: Array<{ 
          name: string; 
          quantity: number; 
          costPrice?: number; 
          sellingPrice?: number; 
          supplier?: string;
          entryDate: string;
        }> = [];

        let currentActiveDate = stockDate;

        for (let r = startRow; r < data.length; r++) {
          const row = data[r];
          if (!row || row.length === 0) continue;

          const rawName = String(row[colNameIndex] || '').trim();
          if (!rawName || rawName === 'undefined') continue;

          // Check if row is a date section header
          const dateCheck = parseDateLine(rawName);
          if (dateCheck) {
            currentActiveDate = dateCheck;
            continue;
          }

          let rowDate = currentActiveDate;
          if (colDateIndex !== -1 && row[colDateIndex]) {
            const parsedCellDate = parseDateLine(String(row[colDateIndex]));
            if (parsedCellDate) rowDate = parsedCellDate;
          }

          const rawQty = parseQuantityNumber(row[colQtyIndex]);
          const rawCost = colCostIndex !== -1 ? parseFloat(String(row[colCostIndex]).replace(/[^0-9.]/g, '')) : undefined;
          const rawSelling = colSellingIndex !== -1 ? parseFloat(String(row[colSellingIndex]).replace(/[^0-9.]/g, '')) : undefined;
          const rawSupplier = colSupplierIndex !== -1 ? String(row[colSupplierIndex] || '').trim() : undefined;

          parsedRows.push({
            name: rawName,
            quantity: rawQty > 0 ? rawQty : 1,
            costPrice: !isNaN(rawCost as any) && (rawCost || 0) > 0 ? rawCost : undefined,
            sellingPrice: !isNaN(rawSelling as any) && (rawSelling || 0) > 0 ? rawSelling : undefined,
            supplier: rawSupplier,
            entryDate: rowDate
          });
        }

        buildImportItems(parsedRows);
      } catch (err: any) {
        console.error('Error parsing excel:', err);
        toast.error('ایکسل فائل پڑھنے میں خرابی ہوئی۔ براہ کرم درست فائل منتخب کریں۔');
      } finally {
        setIsProcessingFile(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Quick download of sample Excel file
  const handleDownloadSample = () => {
    try {
      const sampleData = [
        {
          "تاریخ (Date)": "03/09/2026",
          "پراڈکٹ کا نام (Product Name)": "معجون مقوی",
          "تعداد (Quantity)": 4,
          "خرید قیمت (Cost Price) - اختیاری": "",
          "فروخت قیمت (Selling Price) - اختیاری": ""
        },
        {
          "تاریخ (Date)": "03/09/2026",
          "پراڈکٹ کا نام (Product Name)": "جواہرات قسم اعلیٰ",
          "تعداد (Quantity)": 6,
          "خرید قیمت (Cost Price) - اختیاری": "",
          "فروخت قیمت (Selling Price) - اختیاری": ""
        },
        {
          "تاریخ (Date)": "04/09/2026",
          "پراڈکٹ کا نام (Product Name)": "سفوف بامراد",
          "تعداد (Quantity)": 1,
          "خرید قیمت (Cost Price) - اختیاری": "",
          "فروخت قیمت (Selling Price) - اختیاری": ""
        },
        {
          "تاریخ (Date)": "07/09/2026",
          "پراڈکٹ کا نام (Product Name)": "شوگر",
          "تعداد (Quantity)": 5,
          "خرید قیمت (Cost Price) - اختیاری": "",
          "فروخت قیمت (Selling Price) - اختیاری": ""
        }
      ];

      const ws = XLSX.utils.json_to_sheet(sampleData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sample Stock");

      ws['!cols'] = [
        { wch: 15 },
        { wch: 30 },
        { wch: 15 },
        { wch: 25 },
        { wch: 25 }
      ];

      XLSX.writeFile(wb, "ShipFlow_Bulk_Stock_Sample.xlsx");
      toast.success('نمونہ ایکسل فائل ڈاؤنلوڈ ہو گئی ہے! 📄');
    } catch (e) {
      console.error(e);
      toast.error('فائل ڈاؤنلوڈ نہیں ہو سکی۔');
    }
  };

  // Add a single manual empty row
  const handleAddManualRow = () => {
    const newItem: ParsedImportItem = {
      id: `manual-${Date.now()}`,
      name: '',
      quantity: 1,
      costPrice: 0,
      sellingPrice: 0,
      entryDate: stockDate,
      isMatched: false,
      currentStock: 0,
      userEditedPrice: true
    };
    setItems(prev => [newItem, ...prev]);
  };

  // Update item field in preview table
  const handleUpdateItem = (id: string, field: keyof ParsedImportItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      
      // If name changed, re-match
      if (field === 'name') {
        const matched = matchProduct(value);
        updated.isMatched = !!matched;
        updated.matchedProductId = matched?.id;
        updated.matchedProductName = matched?.name;
        updated.currentStock = matched?.stock || 0;
        if (matched && !item.userEditedPrice) {
          updated.costPrice = matched.costPrice || 0;
          updated.sellingPrice = matched.sellingPrice || 0;
        }
      }
      if (field === 'costPrice' || field === 'sellingPrice') {
        updated.userEditedPrice = true;
      }
      return updated;
    }));
  };

  // Remove single item from list
  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  // Summary statistics
  const stats = useMemo(() => {
    const totalItems = items.length;
    const matchedCount = items.filter(i => i.isMatched).length;
    const newCount = items.filter(i => !i.isMatched).length;
    const totalUnits = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const estimatedCost = items.reduce((sum, i) => sum + ((i.quantity || 0) * (i.costPrice || 0)), 0);
    const uniqueDates = Array.from(new Set(items.map(i => i.entryDate)));
    return { totalItems, matchedCount, newCount, totalUnits, estimatedCost, uniqueDates };
  }, [items]);

  // Filtered preview items (preserving exact sequential order)
  const displayItems = useMemo(() => {
    return items.filter(item => {
      if (filterPreview === 'matched' && !item.isMatched) return false;
      if (filterPreview === 'new' && item.isMatched) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        return item.name.toLowerCase().includes(query) || (item.matchedProductName || '').toLowerCase().includes(query);
      }
      return true;
    });
  }, [items, filterPreview, searchTerm]);

  // Quick date presets
  const handleQuickDate = (type: 'today' | 'yesterday' | 'prevMonth' | 'prevMonthEnd') => {
    const now = new Date();
    if (type === 'today') setStockDate(format(now, 'yyyy-MM-dd'));
    else if (type === 'yesterday') setStockDate(format(subDays(now, 1), 'yyyy-MM-dd'));
    else if (type === 'prevMonth') setStockDate(format(subMonths(now, 1), 'yyyy-MM-15'));
    else if (type === 'prevMonthEnd') setStockDate(format(lastDayOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'));
  };

  // Execute Batch Save to Firestore in Exact Order with respective Dates
  const handleExecuteImport = async () => {
    if (items.length === 0) {
      toast.error('کوئی پروڈکٹ موجود نہیں ہے!');
      return;
    }

    const invalidItems = items.filter(i => !i.name.trim() || i.quantity <= 0);
    if (invalidItems.length > 0) {
      toast.error('کچھ پروڈکٹس کے نام یا تعداد درست نہیں ہیں۔ براہ کرم چیک کریں۔');
      return;
    }

    setIsSaving(true);
    setSaveProgress({ current: 0, total: items.length });

    const finalReason = stockReason === 'دیگر' && customReason.trim() ? customReason.trim() : stockReason;
    const currentUserId = auth.currentUser?.uid;

    try {
      // 1. Group items by product identity to update overall inventory accurately
      // If "معجون مقوی" appears 5 times, calculate its total units to add once
      const productAggregateMap = new Map<string, {
        targetProductId?: string;
        name: string;
        totalQty: number;
        costPrice: number;
        sellingPrice: number;
        supplierName?: string;
        isMatched: boolean;
        currentStock: number;
        firstEntryDate: string;
      }>();

      items.forEach((item) => {
        const key = item.matchedProductId || normalize(item.name);
        const existing = productAggregateMap.get(key);
        if (existing) {
          existing.totalQty += item.quantity;
          if (item.costPrice > 0) existing.costPrice = item.costPrice;
          if (item.sellingPrice > 0) existing.sellingPrice = item.sellingPrice;
        } else {
          productAggregateMap.set(key, {
            targetProductId: item.matchedProductId,
            name: item.name.trim(),
            totalQty: item.quantity,
            costPrice: item.costPrice || 0,
            sellingPrice: item.sellingPrice || 0,
            supplierName: item.supplierName || '',
            isMatched: item.isMatched,
            currentStock: item.currentStock,
            firstEntryDate: item.entryDate
          });
        }
      });

      // 2. Pre-assign document IDs for any new products so individual stockLogs point to them
      const productDocIdMap = new Map<string, string>();
      const batchProductUpdates = writeBatch(db);

      for (const [key, agg] of productAggregateMap.entries()) {
        const existingMatch = (agg.isMatched && agg.targetProductId)
          ? products.find(p => p.id === agg.targetProductId)
          : products.find(p => normalize(p.name) === normalize(agg.name));

        if (existingMatch) {
          const targetId = existingMatch.id;
          productDocIdMap.set(key, targetId);
          const prevStock = existingMatch.stock || 0;
          const finalStock = importMode === 'add' ? (prevStock + agg.totalQty) : agg.totalQty;

          const prodRef = doc(db, 'products', targetId);
          batchProductUpdates.update(prodRef, {
            stock: finalStock,
            ...(agg.costPrice > 0 ? { costPrice: agg.costPrice } : {}),
            ...(agg.sellingPrice > 0 ? { sellingPrice: agg.sellingPrice } : {}),
            ...(agg.supplierName ? { supplierName: agg.supplierName } : {})
          });
        } else {
          // Truly new product doc
          const newProdRef = doc(collection(db, 'products'));
          productDocIdMap.set(key, newProdRef.id);

          batchProductUpdates.set(newProdRef, {
            name: agg.name,
            stock: agg.totalQty,
            costPrice: agg.costPrice || 0,
            sellingPrice: agg.sellingPrice || 0,
            lowStockThreshold: 5,
            supplierName: agg.supplierName || '',
            userId: currentUserId,
            createdAt: new Date(`${agg.firstEntryDate}T12:00:00`).toISOString()
          });
        }
      }

      await batchProductUpdates.commit();

      // 3. Now insert each individual stockLog in exact order and on its specific date
      const BATCH_CHUNK_SIZE = 400;
      let processed = 0;

      for (let i = 0; i < items.length; i += BATCH_CHUNK_SIZE) {
        const chunk = items.slice(i, i + BATCH_CHUNK_SIZE);
        const batchLogs = writeBatch(db);

        chunk.forEach((item, chunkIdx) => {
          const globalIndex = i + chunkIdx;
          const key = item.matchedProductId || normalize(item.name);
          const productId = productDocIdMap.get(key) || item.matchedProductId || 'unknown';

          // Precise timestamp for chronological sorting
          const baseDate = item.entryDate ? new Date(`${item.entryDate}T12:00:00`) : new Date();
          // Add seconds offset so chronological ordering matches written top-to-bottom order
          baseDate.setSeconds(baseDate.getSeconds() + globalIndex);
          const createdAt = isNaN(baseDate.getTime()) ? new Date().toISOString() : baseDate.toISOString();

          const logRef = doc(collection(db, 'stockLogs'));
          const logData: Omit<StockLog, 'id'> = {
            productId,
            productName: item.name.trim(),
            quantity: item.quantity,
            costPrice: item.costPrice || 0,
            totalCost: (item.costPrice || 0) * item.quantity,
            reason: `${finalReason} (${item.entryDate})`,
            userId: currentUserId,
            createdAt
          };
          batchLogs.set(logRef, logData);
        });

        await batchLogs.commit();
        processed += chunk.length;
        setSaveProgress({ current: processed, total: items.length });
      }

      toast.success(`🎉 مبارک ہو! ${items.length} انٹریز کا کل ${stats.totalUnits} اسٹاک تمام تاریخوں کے ساتھ ترتیب وار محفوظ ہو گیا!`, {
        duration: 5000,
        icon: '📦'
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to execute bulk stock import:', err);
      toast.error(`ایرر: ${err?.message || 'اسٹاک محفوظ کرنے میں دشواری پیش آئی'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-[100] text-right" dir="rtl">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white w-full max-w-5xl max-h-[94vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-700 via-indigo-800 to-purple-800 text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center shadow-inner">
              <FileSpreadsheet className="w-6 h-6 text-indigo-100" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black flex items-center gap-2 flex-wrap">
                <span>بلک اسٹاک امپورٹ (ایکسل / واٹس ایپ ٹیکسٹ)</span>
                <span className="text-[10px] font-bold bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  خودکار تاریخ اور ترتیب میچنگ ✨
                </span>
              </h3>
              <p className="text-xs text-indigo-100/90 font-medium mt-0.5">
                تاریخ (جیسے 4/9/26) خود بخود پہچانی جائے گی اور تمام اشیاء ترتیب وار درج ہوں گی۔
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3 sm:p-5 overflow-y-auto space-y-4 flex-1 bg-slate-50/50">
          {/* Top Options Bar */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Method Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-600" />
                  <span>طریقہ کار منتخب کریں:</span>
                </label>
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setActiveTab('paste')}
                    className={cn(
                      "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      activeTab === 'paste' ? "bg-white text-indigo-700 shadow-xs font-black" : "text-gray-600 hover:text-gray-900"
                    )}
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>واٹس ایپ ٹیکسٹ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('excel')}
                    className={cn(
                      "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      activeTab === 'excel' ? "bg-white text-indigo-700 shadow-xs font-black" : "text-gray-600 hover:text-gray-900"
                    )}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>ایکسل فائل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('manual')}
                    className={cn(
                      "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      activeTab === 'manual' ? "bg-white text-indigo-700 shadow-xs font-black" : "text-gray-600 hover:text-gray-900"
                    )}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>دستی لسٹ</span>
                  </button>
                </div>
              </div>

              {/* Import Mode */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
                  <PackageCheck className="w-3.5 h-3.5 text-indigo-600" />
                  <span>اسٹاک جمع کرنے کا طریقہ:</span>
                </label>
                <select
                  value={importMode}
                  onChange={(e: any) => setImportMode(e.target.value)}
                  className="w-full text-xs font-bold p-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="add">موجودہ اسٹاک میں جمع کریں (+ Add to Existing Stock)</option>
                  <option value="replace">کل اسٹاک تبدیل کریں (= Set New Absolute Quantity)</option>
                </select>
              </div>

              {/* Default Date */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ڈیفالٹ تاریخ (بغیر تاریخ والی اشیاء کے لیے):</span>
                  </label>
                  <div className="flex items-center gap-1 text-[10px]">
                    <button type="button" onClick={() => handleQuickDate('today')} className="text-indigo-600 hover:underline">آج</button>
                    <span>|</span>
                    <button type="button" onClick={() => handleQuickDate('yesterday')} className="text-indigo-600 hover:underline">کل</button>
                  </div>
                </div>
                <input
                  type="date"
                  value={stockDate}
                  onChange={(e) => setStockDate(e.target.value)}
                  className="w-full text-xs font-medium p-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none dir-ltr text-right"
                />
              </div>
            </div>
          </div>

          {/* Tab 1: WhatsApp / Raw Text Area */}
          {activeTab === 'paste' && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <label className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                    <ClipboardPaste className="w-4 h-4 text-indigo-600" />
                    <span>واٹس ایپ یا نوٹ پیڈ کا میسج یہاں پیسٹ کریں:</span>
                  </label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    💡 تاریخیں (مثلاً <span className="font-mono font-bold text-indigo-700">3/9/26</span> یا <span className="font-mono font-bold text-indigo-700">4/9/26</span>) خود بخود تاریخ بن جائیں گی اور پراڈکٹ میں شمار نہیں ہوں گی۔
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleLoadSampleText}
                    className="text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    نمونہ میسج پیسٹ کریں 📋
                  </button>

                  <button
                    type="button"
                    onClick={handleParseText}
                    className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-black text-xs py-1.5 px-3.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>ڈیٹا پراسیس کریں ✨</span>
                  </button>
                </div>
              </div>

              <textarea
                rows={7}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`3/9/26\n\nمعجون مقوی 4\nجواہرات قسم اعلیٰ 6\nمعجون مقوی 1\n\n4/9/26\n\nسفوف بامراد 1\nمقوی اسپیشل 1\nحب مقوی 1\n\n7/9/26\n\nمعجون مقوی 24\nشوگر 5`}
                className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50/60 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed text-right"
              />
            </div>
          )}

          {/* Tab 2: Excel File Upload */}
          {activeTab === 'excel' && (
            <div className="bg-white p-5 rounded-2xl border-2 border-dashed border-indigo-200 text-center space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
              />

              <div className="flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2 shadow-xs">
                  <Upload className="w-7 h-7 animate-bounce" />
                </div>
                <h4 className="text-sm font-black text-gray-800">
                  {fileName ? `منتخب فائل: ${fileName}` : 'اپنی ایکسل فائل (.xlsx, .xls, .csv) یہاں اپلوڈ کریں'}
                </h4>
                <p className="text-xs text-gray-500 max-w-md mt-1">
                  ایکسل میں پراڈکٹ کا نام، تعداد اور تاریخ کالم ہو سکتے ہیں۔ قیمت پرانے اسٹاک سے آٹو حاصل ہوگی!
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingFile}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 px-5 rounded-xl flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isProcessingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  <span>{fileName ? 'دوسری فائل منتخب کریں' : 'فائل منتخب کریں (Browse Excel)'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs py-2.5 px-4 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                >
                  <Download className="w-4 h-4 text-emerald-600" />
                  <span>سیمپل ایکسل ٹیمپلیٹ ڈاؤنلوڈ کریں</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Manual quick list entry */}
          {activeTab === 'manual' && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-gray-900">دستی لسٹ انٹری (Interactive Grid)</h4>
                <p className="text-[11px] text-gray-500">نیچے ٹیبل میں نئی سطر شامل کر کے براہ راست نام اور تعداد لکھیں۔</p>
              </div>
              <button
                type="button"
                onClick={handleAddManualRow}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 px-3 rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ نیا آئٹم شامل کریں</span>
              </button>
            </div>
          )}

          {/* Statistics summary badges */}
          {items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold text-gray-500 block">کل انٹریز:</span>
                <span className="text-base font-black text-indigo-900 flex items-center gap-1">
                  <ListOrdered className="w-4 h-4 text-indigo-600" />
                  {stats.totalItems}
                </span>
              </div>
              <div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-200 shadow-xs">
                <span className="text-[10px] font-bold text-indigo-800 block">مختلف تواریخ:</span>
                <span className="text-base font-black text-indigo-900 flex items-center gap-1">
                  <CalendarDays className="w-4 h-4 text-indigo-600" />
                  {stats.uniqueDates.length} دن 📅
                </span>
              </div>
              <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 shadow-xs">
                <span className="text-[10px] font-bold text-emerald-800 block">پرانے اسٹاک سے میچ:</span>
                <span className="text-base font-black text-emerald-900">{stats.matchedCount} ✅</span>
              </div>
              <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 shadow-xs">
                <span className="text-[10px] font-bold text-amber-800 block">نئے پراڈکٹس:</span>
                <span className="text-base font-black text-amber-900">{stats.newCount} 🆕</span>
              </div>
              <div className="bg-purple-50 p-2.5 rounded-xl border border-purple-200 shadow-xs">
                <span className="text-[10px] font-bold text-purple-800 block">کل نیا مال (تعداد):</span>
                <span className="text-base font-black text-purple-900">{stats.totalUnits.toLocaleString()}</span>
              </div>
              <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-200 shadow-xs">
                <span className="text-[10px] font-bold text-blue-800 block">تخمینہ لاگت:</span>
                <span className="text-base font-black text-blue-900">{formatCurrency(stats.estimatedCost)}</span>
              </div>
            </div>
          )}

          {/* Preview Table of Items */}
          {items.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden space-y-3 p-3.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                    <span>اسٹاک انٹری کا جائزہ (ترتیب وار فہرست)</span>
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {items.length} آئٹمز
                    </span>
                  </h4>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {/* Filter matched vs new */}
                  <div className="flex bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setFilterPreview('all')}
                      className={cn("px-2 py-1 rounded-md transition-colors cursor-pointer", filterPreview === 'all' ? "bg-white text-indigo-700 shadow-xs" : "text-gray-600")}
                    >
                      سب ({items.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterPreview('matched')}
                      className={cn("px-2 py-1 rounded-md transition-colors cursor-pointer", filterPreview === 'matched' ? "bg-white text-emerald-700 shadow-xs" : "text-gray-600")}
                    >
                      میچ شدہ ({stats.matchedCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterPreview('new')}
                      className={cn("px-2 py-1 rounded-md transition-colors cursor-pointer", filterPreview === 'new' ? "bg-white text-amber-700 shadow-xs" : "text-gray-600")}
                    >
                      نئے ({stats.newCount})
                    </button>
                  </div>

                  {/* Search in preview */}
                  <div className="relative flex-1 sm:w-44">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="لسٹ میں تلاش..."
                      className="w-full text-xs p-1.5 pr-7 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-2" />
                  </div>

                  <button
                    type="button"
                    onClick={handleAddManualRow}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>سطر شامل کریں</span>
                  </button>
                </div>
              </div>

              {/* Table Container */}
              <div className="overflow-x-auto max-h-80 border border-slate-100 rounded-lg">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100/90 text-gray-700 font-bold sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5 w-10 text-center">#</th>
                      <th className="p-2.5 w-32">تاریخ (Date)</th>
                      <th className="p-2.5 min-w-[140px]">پراڈکٹ کا نام</th>
                      <th className="p-2.5 w-28 whitespace-nowrap">حیثیت (Status)</th>
                      <th className="p-2.5 w-20 text-center">تعداد</th>
                      <th className="p-2.5 w-24 text-center">موجودہ اسٹاک</th>
                      <th className="p-2.5 w-24 text-center">خرید قیمت</th>
                      <th className="p-2.5 w-24 text-center">فروخت قیمت</th>
                      <th className="p-2.5 w-10 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {displayItems.map((item, idx) => (
                      <tr key={item.id} className={item.isMatched ? "hover:bg-emerald-50/40" : "hover:bg-amber-50/40"}>
                        <td className="p-2 text-gray-400 font-mono text-[11px] text-center">{idx + 1}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={item.entryDate}
                              onChange={(e) => handleUpdateItem(item.id, 'entryDate', e.target.value)}
                              className="text-[11px] font-bold p-1 rounded-md border border-indigo-200 bg-indigo-50/50 text-indigo-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 dir-ltr text-right w-full"
                            />
                          </div>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value)}
                            className="w-full text-xs p-1.5 rounded-lg border border-slate-200 bg-white font-bold text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          {item.isMatched && item.matchedProductName && item.matchedProductName !== item.name && (
                            <span className="text-[10px] text-emerald-700 block mt-0.5">
                              میچ: {item.matchedProductName}
                            </span>
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {item.isMatched ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>پرانے اسٹاک سے میچ</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-200" title="یہ نیا پروڈکٹ ہے، قیمت ابھی یا بعد میں شامل کی جا سکتی ہے">
                              <AlertCircle className="w-3 h-3 text-amber-600" />
                              <span>نیا پروڈکٹ</span>
                            </span>
                          )}
                        </td>
                        <td className="p-2 w-20">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleUpdateItem(item.id, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full text-xs p-1.5 rounded-lg border border-indigo-200 bg-indigo-50/40 text-center font-bold text-indigo-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-2 whitespace-nowrap text-center text-gray-600 text-[11px]">
                          {item.isMatched ? (
                            <span>
                              <span className="font-bold">{item.currentStock}</span>
                              <span className="text-gray-400 mx-1">→</span>
                              <span className="text-emerald-700 font-bold">
                                {importMode === 'add' ? item.currentStock + item.quantity : item.quantity}
                              </span>
                            </span>
                          ) : (
                            <span className="text-gray-400">0 → {item.quantity}</span>
                          )}
                        </td>
                        <td className="p-2 w-24">
                          <input
                            type="number"
                            min="0"
                            value={item.costPrice || ''}
                            placeholder="0 (بعد میں)"
                            onChange={(e) => handleUpdateItem(item.id, 'costPrice', parseFloat(e.target.value) || 0)}
                            className={cn(
                              "w-full text-xs p-1.5 rounded-lg border text-center font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500",
                              item.isMatched ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/50"
                            )}
                          />
                        </td>
                        <td className="p-2 w-24">
                          <input
                            type="number"
                            min="0"
                            value={item.sellingPrice || ''}
                            placeholder="0 (بعد میں)"
                            onChange={(e) => handleUpdateItem(item.id, 'sellingPrice', parseFloat(e.target.value) || 0)}
                            className={cn(
                              "w-full text-xs p-1.5 rounded-lg border text-center font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500",
                              item.isMatched ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/50"
                            )}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-gray-400 hover:text-red-600 p-1 transition-colors cursor-pointer"
                            title="سطر حذف کریں"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-gray-600 text-center sm:text-right">
            {items.length > 0 ? (
              <p>
                کل <strong>{items.length}</strong> انٹریز <strong>{stats.uniqueDates.length}</strong> مختلف تاریخوں کے ساتھ ترتیب سے محفوظ ہوں گی۔ 
                پرانے اسٹاک سے <strong>{stats.matchedCount}</strong> کی پرائس آٹو مل گئی ہے!
              </p>
            ) : (
              <p className="text-gray-500">اوپر واٹس ایپ میسج پیسٹ کریں یا ایکسل فائل اپلوڈ کریں۔</p>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-gray-700 font-bold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
            >
              منسوخ کریں
            </button>

            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={isSaving || items.length === 0}
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>اسٹاک درج ہو رہا ہے ({saveProgress.current}/{saveProgress.total})...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>اسٹاک میں شامل کریں ✨ ({items.length} اشیاء)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
