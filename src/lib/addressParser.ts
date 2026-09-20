// Address & Order Parser for Pakistani Ecommerce (Urdu & English)
export interface ParsedAddressResult {
  transcription?: string;
  customerName?: string;
  customerPhone?: string;
  customerPhone2?: string;
  customerCity?: string;
  customerAddress?: string;
  customerCNIC?: string;
  detectedItems?: Array<{ name: string; quantity: number; price?: number }>;
  totalAmount?: number;
  deliveryInstructions?: string;
  summary?: string;
}

export const PAKISTANI_CITY_MAP: { [key: string]: string } = {
  "کراچی": "Karachi", "لاہور": "Lahore", "اسلام آباد": "Islamabad", "راولپنڈی": "Rawalpindi",
  "فیصل آباد": "Faisalabad", "ملتان": "Multan", "پشاور": "Peshawar", "کوئٹہ": "Quetta",
  "حیدرآباد": "Hyderabad", "گوجرانوالہ": "Gujranwala", "سیالکوٹ": "Sialkot", "ایبٹ آباد": "Abbottabad",
  "بہاولپور": "Bahawalpur", "سرگودھا": "Sargodha", "سکھر": "Sukkur", "سوات": "Swat",
  "مردان": "Mardan", "گجرات": "Gujrat", "جھنگ": "Jhang", "ساہیوال": "Sahiwal",
  "نوابشاہ": "Nawabshah", "میانوالی": "Mianwali", "میرپور": "Mirpur", "مظفرآباد": "Muzaffarabad",
  "گلگت": "Gilgit", "اسکردو": "Skardu", "سکردو": "Skardu", "ہنزہ": "Hunza",
  "صوابی": "Swabi", "کوہاٹ": "Kohat", "نوشہرہ": "Nowshera", "چارسدہ": "Charsadda",
  "بنوں": "Bannu", "شیخوپورہ": "Sheikhupura", "قصور": "Kasur", "اوکاڑہ": "Okara",
  "رحیم یار خان": "Rahim Yar Khan", "رحیمیار خان": "Rahim Yar Khan", "چنیوٹ": "Chiniot",
  "کامونکی": "Kamoke", "صادق آباد": "Sadiqabad", "تربت": "Turbat", "شکارپور": "Shikarpur",
  "حافظ آباد": "Hafizabad", "جہلم": "Jhelum", "خانیوال": "Khanewal", "خیرپور": "Khairpur",
  "دادو": "Dadu", "گوجرہ": "Gojra", "مریدکے": "Muridke", "بہاولنگر": "Bahawalnagar",
  "پاکپتن": "Pakpattan", "ٹوبہ ٹیک سنگھ": "Toba Tek Singh", "وہاڑی": "Vehari", "شورکوٹ": "Shorkot",
  "پتوکی": "Pattoki", "وزیرآباد": "Wazirabad", "گوادر": "Gwadar", "اٹک": "Attock",
  "بھکر": "Bhakkar", "لیہ": "Layyah", "راجن پور": "Rajanpur", "مظفرگڑھ": "Muzaffargarh",
  "گھوٹکی": "Ghotki", "جیکب آباد": "Jacobabad", "کشمور": "Kashmore", "لاڑکانہ": "Larkana",
  "قمبر": "Qambar", "جامشورو": "Jamshoro", "مٹیاری": "Matiari", "ٹنڈو الہ یار": "Tando Allahyar",
  "ٹنڈو محمد خان": "Tando Muhammad Khan", "بدین": "Badin", "سجاول": "Sujawal", "ٹھٹھہ": "Thatta",
  "ملیر": "Malir", "کورنگی": "Korangi", "کیماڑی": "Keamari", "ہری پور": "Haripur", "کرک": "Karak",
  "karachi": "Karachi", "lahore": "Lahore", "islamabad": "Islamabad", "rawalpindi": "Rawalpindi",
  "faisalabad": "Faisalabad", "multan": "Multan", "peshawar": "Peshawar", "quetta": "Quetta",
  "hyderabad": "Hyderabad", "gujranwala": "Gujranwala", "sialkot": "Sialkot", "abbottabad": "Abbottabad",
  "bahawalpur": "Bahawalpur", "sargodha": "Sargodha", "sukkur": "Sukkur", "swat": "Swat",
  "mardan": "Mardan", "gujrat": "Gujrat", "jhang": "Jhang", "sahiwal": "Sahiwal",
  "nawabshah": "Nawabshah", "mianwali": "Mianwali", "mirpur": "Mirpur", "muzaffarabad": "Muzaffarabad",
  "gilgit": "Gilgit", "skardu": "Skardu", "hunza": "Hunza", "swabi": "Swabi", "kohat": "Kohat",
  "nowshera": "Nowshera", "charsadda": "Charsadda", "bannu": "Bannu", "sheikhupura": "Sheikhupura",
  "kasur": "Kasur", "okara": "Okara", "rahim yar khan": "Rahim Yar Khan", "rahimyar khan": "Rahim Yar Khan",
  "chiniot": "Chiniot", "kamoke": "Kamoke", "sadiqabad": "Sadiqabad", "turbat": "Turbat",
  "shikarpur": "Shikarpur", "hafizabad": "Hafizabad", "jhelum": "Jhelum", "khanewal": "Khanewal",
  "khairpur": "Khairpur", "dadu": "Dadu", "gojra": "Gojra", "muridke": "Muridke",
  "bahawalnagar": "Bahawalnagar", "pakpattan": "Pakpattan", "toba tek singh": "Toba Tek Singh",
  "tobatek singh": "Toba Tek Singh", "tts": "Toba Tek Singh", "vehari": "Vehari",
  "shorkot": "Shorkot", "pattoki": "Pattoki", "wazirabad": "Wazirabad", "gwadar": "Gwadar",
  "attock": "Attock", "bhakkar": "Bhakkar", "layyah": "Layyah", "rajanpur": "Rajanpur",
  "muzaffargarh": "Muzaffargarh", "ghotki": "Ghotki", "jacobabad": "Jacobabad", "kashmore": "Kashmore",
  "larkana": "Larkana", "qambar": "Qambar", "jamshoro": "Jamshoro", "matiari": "Matiari",
  "tando allahyar": "Tando Allahyar", "tando muhammad khan": "Tando Muhammad Khan", "badin": "Badin",
  "sujawal": "Sujawal", "thatta": "Thatta", "malir": "Malir", "korangi": "Korangi", "keamari": "Keamari",
  "haripur": "Haripur", "karak": "Karak"
};

const COMMON_URDU_NAMES = [
  "محمد", "علی", "احمد", "خان", "عمران", "بلال", "حمزہ", "عثمان", "حذیفہ", "طلحہ", 
  "انس", "جنید", "عمر", "ابوبکر", "زبیر", "یاسر", "عرفان", "فیصل", "نعمان", "رضوان", 
  "عدنان", "کامران", "سلمان", "شہزاد", "کاشف", "شاہد", "آصف", "وقار", "طارق", "ساجد", 
  "ماجد", "امجد", "اسد", "حسن", "حسین", "طاہر", "ظفر", "اقبال", "ثاقب", "وقاص", 
  "نوید", "جواد", "شفیق", "خالد", "فیاض", "اصغر", "اکرم", "ارسلان", "ہارون", "ذیشان", 
  "زیشان", "آفتاب", "فراز", "عمیر", "سفیان", "سعد", "معاذ", "عامر", "شعیب", "بابر", 
  "طہ", "طٰہٰ", "بشارت", "امتیاز", "ممتاز", "ریاض", "فہیم", "عاطف", "ندیم", "وسیم", 
  "سہیل", "مظہر", "تنویر", "منیر", "نواز", "شہباز", "رحمان", "شریف", "لطیف", "جمیل", 
  "حبیب", "بشیر", "شاکر", "صابر", "ظاہر", "قاسم", "رحیم", "کریم", "حاجی", "چوہدری",
  "ملک", "سید", "شاہ", "رانا", "شیخ", "میر", "میاں", "ڈاکٹر", "انجینئر", "فاطمہ", "عائشہ",
  "زینب", "مریم", "خدیجہ", "سارہ", "حنا", "صائمہ", "عالیہ", "بشریٰ", "اقصیٰ", "نور"
];

const COMMON_ENG_NAMES = [
  "muhammad", "ali", "ahmad", "ahmed", "khan", "imran", "bilal", "hamza", "usman", "huzaifa",
  "talha", "anas", "junaid", "umer", "umar", "abubakar", "zubair", "yasir", "irfan", "faisal",
  "noman", "nouman", "rizwan", "adnan", "kamran", "salman", "shahzad", "kashif", "shahid", "asif",
  "waqar", "tariq", "sajid", "majid", "amjad", "asad", "hassan", "hasan", "hussain", "tahir",
  "zafar", "iqbal", "saqib", "waqas", "naveed", "jawad", "shafiq", "khalid", "fayyaz", "asghar",
  "akram", "arslan", "haroon", "zeeshan", "aftab", "faraz", "umair", "sufyan", "saad", "muaz",
  "aamir", "shoaib", "babar", "imtiaz", "mumtaz", "riaz", "faheem", "atif", "nadeem", "waseem",
  "sohail", "mazhar", "tanveer", "muneer", "nawaz", "shahbaz", "rehman", "sharif", "latif",
  "jameel", "habib", "basheer", "shakir", "sabir", "qasim", "fatima", "ayesha", "zainab", "maryam"
];

/**
 * Parse unformatted text or live speech transcription into structured Pakistani customer order details
 */
export function parseRawAddressDetails(text: string, availableProducts: any[] = []): ParsedAddressResult {
  if (!text || !text.trim()) {
    return {};
  }

  let extractedName = '';
  let extractedPhone = '';
  let extractedPhone2 = '';
  let extractedCity = '';
  let totalAmount: number | undefined = undefined;
  let detectedItems: Array<{ name: string; quantity: number; price?: number }> = [];
  let cleanedAddress = text;

  // 1. Extract phone numbers first (starts with 03, +923, 923, 10 to 12 digits)
  const phoneRegex = /(?:03|\+?92\s*3)[0-9\-\s]{9,12}/g;
  const foundPhones = (text.match(phoneRegex) || []) as string[];
  const normalizedPhones: string[] = [];

  foundPhones.forEach(ph => {
    let ext = ph.replace(/[\-\s\+]/g, '');
    if (ext.startsWith('92')) {
      ext = '0' + ext.substring(2);
    }
    if (ext.length >= 11 && ext.length <= 13) {
      normalizedPhones.push(ext);
      cleanedAddress = cleanedAddress.replace(ph, ' ');
    }
  });

  if (normalizedPhones.length > 0) {
    extractedPhone = normalizedPhones[0];
    if (normalizedPhones.length > 1) {
      extractedPhone2 = normalizedPhones[1];
    }
  }

  // 2. Extract city using common Pakistani cities dictionary
  const pakCities = Object.keys(PAKISTANI_CITY_MAP);
  pakCities.sort((a, b) => b.length - a.length);

  const getBoundarySafeRegex = (word: string) => {
    if (/[\u0600-\u06FF]/.test(word)) {
      return new RegExp("(?:^|[^\\u0600-\\u06FF])(" + word + ")(?:$|[^\\u0600-\\u06FF])", "i");
    } else {
      return new RegExp("\\b(" + word + ")\\b", "i");
    }
  };

  for (const city of pakCities) {
    const regex = getBoundarySafeRegex(city);
    const match = cleanedAddress.match(regex);
    if (match && match.index !== undefined) {
      const matchedCityName = match[1];
      extractedCity = PAKISTANI_CITY_MAP[city.toLowerCase()] || city;
      const wordIndex = match.index + match[0].indexOf(matchedCityName);
      cleanedAddress = cleanedAddress.substring(0, wordIndex) + ' ' + cleanedAddress.substring(wordIndex + matchedCityName.length);
      break;
    }
  }

  if (extractedCity && /^[a-zA-Z\s]+$/.test(extractedCity)) {
    extractedCity = extractedCity.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());
  }

  // 3. Extract Name using explicit labels (نام:, Name:, کسٹمر:, etc.)
  const nameLabelRegex = /(?:Name|نام|گاہک کا نام|کسٹمر|موصول کنندہ|Receiver|Customer|Client|بھجوانے والا)\s*[:\-\.۔]*\s*([A-Za-z\u0600-\u06FF\s]+?)(?:[,\n\r\t]|$)/i;
  const nameMatch = cleanedAddress.match(nameLabelRegex);
  if (nameMatch && nameMatch[1].trim().length > 2) {
    extractedName = nameMatch[1].trim();
    cleanedAddress = cleanedAddress.replace(nameMatch[0], ' ').trim();
  } else {
    // Contextual Pakistani name search
    const words = cleanedAddress.split(/[\s,،\-:\n\r]+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i].trim().toLowerCase();
      const rawW = words[i].trim();
      const isUrduMatch = COMMON_URDU_NAMES.includes(rawW);
      const isEngMatch = COMMON_ENG_NAMES.includes(w);

      if (isUrduMatch || isEngMatch) {
        let fullName = rawW;
        if (i + 1 < words.length) {
          const nextW = words[i + 1].trim();
          const nextLower = nextW.toLowerCase();
          if (COMMON_URDU_NAMES.includes(nextW) || COMMON_ENG_NAMES.includes(nextLower) || 
              /^[A-Z][a-z]+$/.test(nextW) || /^[\u0600-\u06FF]{3,10}$/.test(nextW)) {
            fullName += ' ' + nextW;
            if (i + 2 < words.length) {
              const thirdW = words[i + 2].trim();
              if (['خان', 'khan', 'احمد', 'ahmed', 'علی', 'ali', 'سید', 'syed'].includes(thirdW.toLowerCase())) {
                fullName += ' ' + thirdW;
              }
            }
          }
        }
        if (fullName.length > 2) {
          extractedName = fullName;
          cleanedAddress = cleanedAddress.replace(fullName, ' ').trim();
          break;
        }
      }
    }
  }

  // 4. Extract COD / Total Amount if stated (e.g., Rs 2500, 2500 روپے, COD: 3000)
  const amountRegex = /(?:rs\.?|pkr|روپے|رقم|cod|amount|total)\s*[:\-\s]*([0-9]{3,6})/i;
  const amountMatch = cleanedAddress.match(amountRegex);
  if (amountMatch && amountMatch[1]) {
    totalAmount = parseInt(amountMatch[1], 10);
    cleanedAddress = cleanedAddress.replace(amountMatch[0], ' ');
  } else {
    // Reverse pattern: 2500 روپے
    const reverseAmountRegex = /([0-9]{3,6})\s*(?:روپے|rs\.?|pkr|cod)/i;
    const revMatch = cleanedAddress.match(reverseAmountRegex);
    if (revMatch && revMatch[1]) {
      totalAmount = parseInt(revMatch[1], 10);
      cleanedAddress = cleanedAddress.replace(revMatch[0], ' ');
    }
  }

  // 5. Match store products if available
  if (availableProducts && availableProducts.length > 0) {
    availableProducts.forEach((p: any) => {
      if (!p.name) return;
      const pNameLower = p.name.toLowerCase();
      if (text.toLowerCase().includes(pNameLower)) {
        // Look for quantity preceding or following the product name
        const qtyRegex = new RegExp(`([0-9]+)\\s*(?:عدد|piece|pcs|دانے)?\\s*${p.name}`, 'i');
        const qtyMatch = text.match(qtyRegex);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        detectedItems.push({
          name: p.name,
          quantity: qty > 0 ? qty : 1,
          price: p.sellingPrice || 0
        });
      }
    });
  }

  // 6. Clean up residual labels from the address string
  cleanedAddress = cleanedAddress
    .replace(/(?:Address|پتہ|ایڈریس|مکمل پتہ|مکان نمبر|گھر کا پتہ|City|شہر|Phone|Mobile|فون|موبائل|رابطہ نمبر|نمبر)\s*[:\-\.۔]*/gi, ' ')
    .replace(/[\r\n\t]+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,،\s\.\-]+|[,،\s\.\-]+$/g, '')
    .trim();

  // If name wasn't extracted from dictionary, take the first short line if it looks like a name
  if (!extractedName && text.includes('\n')) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[0].length <= 25 && !lines[0].match(/[0-9]{4,}/)) {
      extractedName = lines[0].replace(/^(?:نام|Name)\s*[:\-]?\s*/i, '');
    }
  }

  const summary = `گاہک: ${extractedName || 'نامعلوم'} | فون: ${extractedPhone || 'نامعلوم'} | شہر: ${extractedCity || 'نامعلوم'}`;

  return {
    transcription: text,
    customerName: extractedName,
    customerPhone: extractedPhone,
    customerPhone2: extractedPhone2,
    customerCity: extractedCity,
    customerAddress: cleanedAddress,
    totalAmount,
    detectedItems: detectedItems.length > 0 ? detectedItems : undefined,
    summary
  };
}

/**
 * Open WhatsApp directly on Mobile (App link) or Web WhatsApp on Desktop
 * Using https://api.whatsapp.com/send ensures Android Chrome opens WhatsApp native app
 * without throwing the "Couldn't open link" custom protocol error.
 */
export function openWhatsAppDirectly(phone?: string): void {
  const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
  const url = cleanPhone 
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}` 
    : 'https://api.whatsapp.com/send';
  
  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Safely read clipboard text
 */
export async function readClipboardText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.readText) {
    return null;
  }
  try {
    const text = await navigator.clipboard.readText();
    return text && text.trim() ? text.trim() : null;
  } catch (err) {
    console.warn('Clipboard read error:', err);
    return null;
  }
}
