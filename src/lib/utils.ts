import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' روپے';
}

export function generateTrackingNumber() {
  return 'SF' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export function getWhatsAppLink(phone: string, message: string) {
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

export function splitMoneyOrderAmounts(totalAmount: number, maxPerMo: number = 20000): number[] {
  const amount = Math.max(0, Math.round(totalAmount || 0));
  if (amount <= 0) return [0];
  if (amount <= maxPerMo) return [amount];
  
  const parts: number[] = [];
  let remaining = amount;
  while (remaining > 0) {
    const chunk = Math.min(remaining, maxPerMo);
    parts.push(chunk);
    remaining -= chunk;
  }
  return parts;
}

export function numberToWords(num: number): string {
  if (!num || num === 0) return 'Zero Rupees Only';
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const strNum = num.toString();
  if (strNum.length > 9) return `${num} Rupees Only`;
  const n = ('000000000' + strNum).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return '';
  let str = '';
  str += (Number(n[1]) !== 0) ? (a[Number(n[1])] || b[Number(n[1][0])] + ' ' + a[Number(n[1][1])]) + 'Crore ' : '';
  str += (Number(n[2]) !== 0) ? (a[Number(n[2])] || b[Number(n[2][0])] + ' ' + a[Number(n[2][1])]) + 'Lakh ' : '';
  str += (Number(n[3]) !== 0) ? (a[Number(n[3])] || b[Number(n[3][0])] + ' ' + a[Number(n[3][1])]) + 'Thousand ' : '';
  str += (Number(n[4]) !== 0) ? (a[Number(n[4])] || b[Number(n[4][0])] + ' ' + a[Number(n[4][1])]) + 'Hundred ' : '';
  str += (Number(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[Number(n[5][0])] + ' ' + a[Number(n[5][1])]) : '';
  return str.trim() ? str.trim() + ' Rupees Only' : '';
}

export function numberToUrduWords(num: number): string {
  if (!num || num <= 0) return 'صفر روپے فقط';
  
  const onesUrdu = [
    '', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس',
    'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس'
  ];
  
  const tensUrdu: Record<number, string> = {
    20: 'بیس', 21: 'اکیس', 22: 'بائیس', 23: 'تیئیس', 24: 'چوبیس', 25: 'پچیس', 26: 'چھبیس', 27: 'ستائیس', 28: 'اٹائیس', 29: 'انتیس',
    30: 'تیس', 31: 'اکتیس', 32: 'بتیس', 33: 'تینتیس', 34: 'چونتیس', 35: 'پینتیس', 36: 'چھتیس', 37: 'سینتیس', 38: 'اڑتیس', 39: 'انتالیس',
    40: 'چالیس', 41: 'اکتالیس', 42: 'بیالیس', 43: 'تینتالیس', 44: 'چوالیس', 45: 'پینتالیس', 46: 'چھیاستھ', 47: 'سینتالیس', 48: 'اڑتالیس', 49: 'انچاس',
    50: 'پچاس', 51: 'اکیاون', 52: 'باون', 53: 'تریپن', 54: 'چون', 55: 'پچپن', 56: 'چھپن', 57: 'ستاون', 58: 'اٹھاون', 59: 'انسٹھ',
    60: 'ساٹھ', 61: 'اکسٹھ', 62: 'باسٹھ', 63: 'تریسٹھ', 64: 'چوسٹھ', 65: 'پینسٹھ', 66: 'چھیاسٹھ', 67: 'سڑسٹھ', 68: 'اڑسٹھ', 69: 'انہتر',
    70: 'ستر', 71: 'اکہتر', 72: 'بہتر', 73: 'تہتر', 74: 'چوہتر', 75: 'پچہتر', 76: 'چھہتر', 77: 'ستتر', 78: 'اٹھتر', 79: 'اناسی',
    80: 'اسی', 81: 'اکیاسی', 82: 'بیاسی', 83: 'تراسی', 84: 'چوراسی', 85: 'پچاسی', 86: 'چھیاسی', 87: 'ستاسی', 88: 'اٹاسی', 89: 'نواسی',
    90: 'نوے', 91: 'اکیانوے', 92: 'بانوے', 93: 'ترانوے', 94: 'چورانوے', 95: 'پچانوے', 96: 'چھیانوے', 97: 'ستانوے', 98: 'اٹھانوے', 99: 'نناوے'
  };

  function getBelowHundred(n: number): string {
    if (n === 0) return '';
    if (n <= 20) return onesUrdu[n];
    return tensUrdu[n] || `${n}`;
  }

  function getBelowThousand(n: number): string {
    let result = '';
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    if (hundred > 0) {
      result += `${onesUrdu[hundred]} سو `;
    }
    if (remainder > 0) {
      result += getBelowHundred(remainder);
    }
    return result.trim();
  }

  let result = '';
  let n = num;

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  if (crore > 0) {
    result += `${getBelowHundred(crore)} کروڑ `;
  }

  const lakh = Math.floor(n / 100000);
  n %= 100000;
  if (lakh > 0) {
    result += `${getBelowHundred(lakh)} لاکھ `;
  }

  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand > 0) {
    result += `${getBelowHundred(thousand)} ہزار `;
  }

  if (n > 0) {
    result += `${getBelowThousand(n)} `;
  }

  return result.trim() ? `${result.trim()} روپے فقط` : '';
}

export function generateCustomerMessage(order: any) {
  let msg = `السلام علیکم ${order.customerName}!\n`;
  msg += `آپ کے پارسل کی تازہ ترین معلومات:\n\n`;
  msg += `🚚 ٹریکنگ نمبر: ${order.trackingNumber}\n`;

  if (order.status) {
    let statusUrdu = order.status;
    if (statusUrdu === 'Pending') statusUrdu = 'پینڈنگ (بکنگ کا انتظار)';
    if (statusUrdu === 'Shipped') statusUrdu = 'ڈسپیچ ہو گیا (روانگی)';
    if (statusUrdu === 'Delivered') statusUrdu = 'ڈیلیور ہو گیا (وصول ہو گیا)';
    if (statusUrdu === 'Returned') statusUrdu = 'واپس آ گیا (ریٹرن)';
    if (statusUrdu === 'Cancelled') statusUrdu = 'منسوخ ہو گیا (کینسل)';
    
    msg += `📦 موجودہ اسٹیٹس: ${statusUrdu}\n`;
  }

  if (order.lastTrackingEvent) {
    msg += `📍 لوکیشن: ${order.lastTrackingLocation}\n`;
    msg += `📝 تفصیل: ${order.lastTrackingEvent}\n`;

    if (order.customerCity && order.lastTrackingLocation) {
        const cityLower = order.customerCity.toLowerCase();
        const locLower = order.lastTrackingLocation.toLowerCase();
        
        let destinationCity = '';
        if (cityLower.includes('lahore')) destinationCity = 'lahore';
        else if (cityLower.includes('islamabad')) destinationCity = 'islamabad';
        else if (cityLower.includes('peshawar')) destinationCity = 'peshawar';
        else if (cityLower.includes('multan')) destinationCity = 'multan';
        else if (cityLower.includes('quetta')) destinationCity = 'quetta';
        else if (cityLower.includes('karachi')) destinationCity = 'karachi';
        else if (cityLower.includes('faisalabad')) destinationCity = 'faisalabad';
        
        // Basic match: if the primary city name matches, or if a 5-letter substring matches (to handle spelling variations)
        const isCityMatch = (destinationCity && locLower.includes(destinationCity)) || 
                           (cityLower.length >= 4 && locLower.includes(cityLower.substring(0, 4)));

        if (isCityMatch) {
            msg += `\n❗ خوشخبری: آپ کا پارسل آپ کے شہر پہنچ چکا ہے۔ اگر ڈاکیے نے آپ سے رابطہ نہ کیا ہو تو براہ کرم اپنے قریبی متعلقہ پوسٹ آفس سے خود معلومات کر لیں تاکہ پارسل واپس نہ ہو۔\n`;
        }
    }
  }

  msg += `\n📞 کسی بھی معلومات کے لیے ہم سے رابطہ کر سکتے ہیں۔ شکریہ!`;
  return msg;
}

/**
 * Normalizes Urdu & Arabic product names so minor spelling, diacritic,
 * or character variations (e.g. اعلیٰ vs اعلی, Arabic Yeh vs Urdu Yeh, etc.)
 * resolve to the exact same canonical string.
 */
export function normalizeUrduProductName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    // Strip Arabic/Urdu diacritics & Harakat (Fatha, Damma, Kasra, Shadda, Sukun, Khari Zabar U+0670, Tanween)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize Yeh variations: Arabic Yeh (ي \u064A), Alef Maksura (ى \u0649), Yeh with Hamza (ئ \u0626) -> Urdu Choti Yeh (ی \u06CC)
    .replace(/[\u064A\u0649\u0626]/g, '\u06CC')
    // Normalize Kaf: Arabic Kaf (ك \u0643), Swash Kaf (ڪ \u06AA) -> Keheh/Urdu Kaf (ک \u06A9)
    .replace(/[\u0643\u06AA]/g, '\u06A9')
    // Normalize Heh: Arabic Heh (ه \u0647), Teh Marbuta (ة \u0629), Heh with Yeh (ۂ \u06C2), Ae (ە \u06D5) -> Urdu Gol Heh (ہ \u06C1)
    .replace(/[\u0647\u0629\u06C2\u06D5]/g, '\u06C1')
    // Normalize Alif: Alif with Madda (آ \u0622), Alif with Hamza (أ \u0623, إ \u0625), Wasla (ٱ \u0671) -> Bare Alif (ا \u0627)
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    // Normalize Waw: Waw with Hamza (ؤ \u0624) -> Waw (و \u0648)
    .replace(/\u0624/g, '\u0648')
    // Remove invisible formatting and direction characters: ZWNJ, ZWJ, LTR, RTL marks, BOM, Arabic letter mark
    .replace(/[\u200B-\u200F\uFEFF\u061C]/g, '')
    // Replace punctuation, separators, brackets, slashes, dashes with single space
    .replace(/[\s\-_،,.\(\)\[\]\/\\\|:\+]+/g, ' ')
    .trim();
}

/**
 * Deduplicate an array of products by their normalized Urdu name.
 * Combines stock from duplicate items, picks the best non-zero selling & cost prices,
 * and ensures each unique product is presented exactly once.
 */
export function deduplicateProducts<T extends { id: string; name: string; stock?: number; sellingPrice?: number; costPrice?: number; supplierName?: string; createdAt?: string }>(
  productList: T[]
): T[] {
  if (!productList || productList.length === 0) return [];

  const groups = new Map<string, T[]>();
  productList.forEach(p => {
    const key = normalizeUrduProductName(p.name) || p.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  });

  const uniqueList: T[] = [];
  groups.forEach((items) => {
    if (items.length === 1) {
      uniqueList.push(items[0]);
    } else {
      // Pick primary product: prefer highest stock, non-zero selling price, standard name
      const sorted = [...items].sort((a, b) => {
        if ((b.stock || 0) !== (a.stock || 0)) return (b.stock || 0) - (a.stock || 0);
        if ((b.sellingPrice || 0) !== (a.sellingPrice || 0)) return (b.sellingPrice || 0) - (a.sellingPrice || 0);
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

      const primary = sorted[0];
      const totalStock = items.reduce((sum, item) => sum + (item.stock || 0), 0);
      const bestCostPrice = items.find(i => (i.costPrice || 0) > 0)?.costPrice || primary.costPrice || 0;
      const bestSellingPrice = items.find(i => (i.sellingPrice || 0) > 0)?.sellingPrice || primary.sellingPrice || 0;
      const bestSupplier = items.find(i => i.supplierName && i.supplierName.trim())?.supplierName || primary.supplierName || '';

      uniqueList.push({
        ...primary,
        stock: totalStock,
        costPrice: bestCostPrice,
        sellingPrice: bestSellingPrice,
        supplierName: bestSupplier
      });
    }
  });

  return uniqueList;
}
